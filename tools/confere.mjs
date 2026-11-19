/**
 * Sobe o server.mjs numa porta livre, abre o painel num Chrome headless e
 * confere o que só aparece em execução: leitura da pasta prestacao-de-contas/,
 * gráficos desenhados, tabelas, filtro, legenda, reajuste e tooltips.
 *
 * Uso: node tools/confere.mjs [--tema dark] [--largura 1440]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execFileSync } from 'child_process';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const TEMA = arg('tema', 'light');
const LARGURA = Number(arg('largura', 1440));
const PORT = 7892;

execFileSync(process.execPath, [path.join(ROOT, 'build.mjs')], { cwd: ROOT, stdio: 'pipe' });

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];
const executablePath = CHROMES.find(c => fs.existsSync(c));
if (!executablePath) { console.error('Chrome/Edge não encontrado.'); process.exit(1); }

const srv = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), String(PORT)], {
  cwd: ROOT,
  stdio: 'pipe'
});

await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('Timeout aguardando server.mjs')), 8000);
  srv.stdout.on('data', (d) => {
    if (String(d).includes('http://')) { clearTimeout(t); resolve(); }
  });
  srv.on('exit', (code) => { clearTimeout(t); reject(new Error('server.mjs saiu com código ' + code)); });
});

const perfil = path.join(ROOT, '.chrome-conferencia');
let navegador;
const problemas = [];

try {
  navegador = await puppeteer.launch({
    executablePath,
    headless: 'shell',
    userDataDir: perfil,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars']
  });

  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: LARGURA, height: 1200, deviceScaleFactor: 1 });
  await pagina.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: TEMA }]);

  pagina.on('pageerror', (e) => problemas.push('EXCEÇÃO: ' + e.message));
  pagina.on('console', (m) => {
    if (m.type() === 'error') problemas.push('CONSOLE: ' + m.text());
  });
  pagina.on('requestfailed', (r) => {
    problemas.push('REQUISIÇÃO FALHOU: ' + r.url().slice(0, 120));
  });

  const alvo = `http://127.0.0.1:${PORT}/`;
  await pagina.goto(alvo, { waitUntil: 'load', timeout: 60000 });
  await pagina.evaluate(() => { try { localStorage.removeItem('filadelfia:tema'); } catch (e) {} });
  await pagina.reload({ waitUntil: 'load', timeout: 60000 });

  const qtdPdfs = fs.readdirSync(path.join(ROOT, 'prestacao-de-contas'))
    .filter(f => /\.pdf$/i.test(f)).length;

  await pagina.waitForFunction(
    (esperado) => document.querySelectorAll('#lista-pdf li').length >= esperado,
    { timeout: 180000, polling: 500 },
    qtdPdfs
  );
  await new Promise(r => setTimeout(r, 1500));

  const relatorio = await pagina.evaluate(() => {
    const r = { graficos: [], vazios: [], kpis: [], scrollInterno: [], orc: [], cortados: [] };

    document.querySelectorAll('canvas').forEach(c => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let tinta = 0;
      for (let i = 3; i < d.length; i += 40) if (d[i] > 8) tinta++;
      r.graficos.push({ id: c.id, w: c.width, h: c.height, tinta });
      if (tinta < 30) r.vazios.push(c.id);
    });

    document.querySelectorAll('.tile').forEach(t => r.kpis.push({
      rot: t.querySelector('.rot')?.textContent,
      val: t.querySelector('.val')?.textContent,
      sub: t.querySelector('.sub')?.textContent,
      delta: t.querySelector('.delta')?.textContent
    }));

    document.querySelectorAll('.card, .plot').forEach(n => {
      if (n.scrollHeight > n.clientHeight + 2) {
        r.scrollInterno.push((n.id || n.className) + ' ' + n.scrollHeight + '>' + n.clientHeight);
      }
    });

    document.querySelectorAll('.tile .val, .heroi, .mini, .lista-def dd, .sub-tit').forEach(n => {
      if (n.scrollWidth > n.clientWidth + 2) r.cortados.push(n.className + ': ' + n.textContent);
    });

    r.heroi = document.getElementById('orc-heroi')?.textContent;
    r.heroiSub = document.getElementById('orc-heroi-sub')?.textContent;
    document.querySelectorAll('#orc-lista div').forEach(d => r.orc.push(
      d.querySelector('dt').textContent + ' = ' + d.querySelector('dd').textContent));
    r.minis = [...document.querySelectorAll('.mini')].map(n => n.id + ': ' + n.textContent);
    r.legendas = [...document.querySelectorAll('.legenda')].map(l => l.id + ':' + l.children.length);
    r.subMarca = document.getElementById('sub-marca')?.textContent;
    r.nota = document.getElementById('f-nota')?.textContent;
    r.situacao = document.getElementById('situacao')?.textContent;
    r.fontes = document.getElementById('fontes-cont')?.textContent;
    r.listaPdf = document.querySelectorAll('#lista-pdf li').length;
    r.docAltura = document.documentElement.scrollHeight;
    r.overflowX = document.documentElement.scrollWidth > window.innerWidth + 1
      ? document.documentElement.scrollWidth + ' > ' + window.innerWidth : null;
    r.tema = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim();
    return r;
  });

  if (relatorio.vazios.length) problemas.push('GRÁFICO SEM DESENHO: ' + relatorio.vazios.join(', '));
  if (relatorio.scrollInterno.length) problemas.push('SCROLL INTERNO: ' + relatorio.scrollInterno.join(' | '));
  if (relatorio.overflowX) problemas.push('OVERFLOW HORIZONTAL: ' + relatorio.overflowX);
  if (relatorio.cortados.length) problemas.push('TEXTO CORTADO: ' + relatorio.cortados.join(' | '));
  if (!relatorio.heroi || relatorio.heroi === '—') problemas.push('Número-herói do orçamento vazio.');
  if (relatorio.listaPdf < 1) problemas.push('Lista de pastas vazia.');

  const tabelas = await pagina.evaluate(() => {
    document.getElementById('bt-tabelas').click();
    const r = {};
    document.querySelectorAll('.tab-area').forEach(a => {
      const t = a.querySelector('table');
      r[a.id] = t
        ? { linhas: t.tBodies[0].rows.length, colunas: t.tHead.rows[0].cells.length, rodape: !!t.tFoot }
        : null;
    });
    document.getElementById('bt-tabelas').click();
    return r;
  });
  for (const [id, t] of Object.entries(tabelas)) {
    if (!t) problemas.push('TABELA AUSENTE: ' + id);
    else if (!t.linhas) problemas.push('TABELA VAZIA: ' + id);
  }

  const filtro = await pagina.evaluate(() => {
    const s = document.getElementById('f-preset');
    s.value = '3'; s.dispatchEvent(new Event('change'));
    const r = {
      kpi3: document.querySelector('.tile .val')?.textContent,
      nota3: document.getElementById('f-nota')?.textContent,
      heroi3: document.getElementById('orc-heroi')?.textContent
    };
    s.value = 'tudo'; s.dispatchEvent(new Event('change'));
    r.kpiTudo = document.querySelector('.tile .val')?.textContent;
    r.heroiTudo = document.getElementById('orc-heroi')?.textContent;
    return r;
  });
  if (filtro.kpi3 === filtro.kpiTudo) problemas.push('O filtro de período não mudou os KPIs.');
  if (filtro.heroi3 === filtro.heroiTudo) problemas.push('O filtro de período não mudou a previsão.');

  const legenda = await pagina.evaluate(() => {
    const antes = document.querySelector('#l-comp button').getAttribute('aria-pressed');
    const cores = () => [...document.querySelectorAll('#l-comp .chave')]
      .map(c => getComputedStyle(c).backgroundColor).join('|');
    const coresAntes = cores();
    document.querySelector('#l-comp button').click();
    const depois = document.querySelector('#l-comp button').getAttribute('aria-pressed');
    const coresDepois = cores();
    document.querySelector('#l-comp button').click();
    return { antes, depois, itens: document.querySelectorAll('#l-comp button').length,
      corEstavel: coresAntes === coresDepois };
  });
  if (legenda.antes === legenda.depois) problemas.push('A legenda de composição não alterna o grupo.');
  if (!legenda.corEstavel) problemas.push('As cores mudaram ao filtrar um grupo (recolorir no filtro).');

  const orcCtrl = await pagina.evaluate(() => {
    const base = document.getElementById('orc-heroi').textContent;
    const i = document.getElementById('orc-reajuste');
    i.value = '10'; i.dispatchEvent(new Event('input'));
    const comReajuste = document.getElementById('orc-heroi').textContent;
    i.value = '0'; i.dispatchEvent(new Event('input'));
    const f = document.getElementById('orc-fundo');
    f.value = '5'; f.dispatchEvent(new Event('input'));
    const comFundo = document.getElementById('orc-heroi').textContent;
    f.value = '0'; f.dispatchEvent(new Event('input'));
    return { base, comReajuste, comFundo, volta: document.getElementById('orc-heroi').textContent };
  });
  if (orcCtrl.base === orcCtrl.comReajuste) problemas.push('O reajuste não altera a previsão.');
  if (orcCtrl.base === orcCtrl.comFundo) problemas.push('O fundo de reserva não altera a previsão.');
  if (orcCtrl.base !== orcCtrl.volta) problemas.push('A previsão não voltou ao valor base.');

  console.log(`\n=== ${TEMA.toUpperCase()} · ${LARGURA}px · superfície ${relatorio.tema} ===`);
  console.log('sub-marca:', relatorio.subMarca);
  console.log('nota do filtro:', relatorio.nota);
  console.log('fontes:', relatorio.fontes, '·', relatorio.listaPdf, 'itens na lista');
  console.log('situação:', relatorio.situacao || '(vazia)');
  console.log('Gráficos:', relatorio.graficos.map(g => `${g.id}(${g.tinta})`).join(' '));
  console.log('Herói:', relatorio.heroi);

  if (problemas.length) {
    console.log('\n*** PROBLEMAS ***');
    problemas.forEach(p => console.log('  - ' + p));
  } else {
    console.log('\nSem problemas detectados.');
  }
} finally {
  if (navegador) await navegador.close();
  srv.kill();
  try { fs.rmSync(perfil, { recursive: true, force: true }); } catch (e) {}
}

process.exit(problemas.length ? 1 : 0);
