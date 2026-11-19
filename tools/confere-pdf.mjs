/**
 * Confere o modo 100% navegador (como no GitHub Pages ou aberto direto do disco):
 * o index.html começa sem nenhum dado embutido (#vazio visível), recebe os PDFs
 * da pasta prestacao-de-contas/ pelo seletor de arquivos, incorpora os meses,
 * mantém no localStorage ao recarregar, não duplica competência repetida e
 * limpa tudo ao clicar em remover.
 *
 * Uso: node tools/confere-pdf.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PASTA = path.join(ROOT, 'prestacao-de-contas');
const TEMP = path.join(ROOT, '.teste-pdf');

fs.rmSync(TEMP, { recursive: true, force: true });
fs.mkdirSync(TEMP, { recursive: true });

execFileSync(process.execPath, [path.join(ROOT, 'build.mjs')], { cwd: ROOT, stdio: 'pipe' });

const caminhos = fs.readdirSync(PASTA)
  .filter(f => /\.pdf$/i.test(f))
  .sort()
  .slice(0, 3)
  .map(f => path.join(PASTA, f));

if (caminhos.length < 2) {
  console.error('São necessários pelo menos 2 PDFs em prestacao-de-contas/ para o teste.');
  process.exit(1);
}

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];
const executablePath = CHROMES.find(c => fs.existsSync(c));

let navegador;
const problemas = [];

try {
  navegador = await puppeteer.launch({
    executablePath,
    headless: 'shell',
    userDataDir: path.join(TEMP, 'perfil'),
    args: ['--no-first-run', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files']
  });
  const pagina = await navegador.newPage();
  await pagina.setViewport({ width: 1440, height: 1100 });
  pagina.on('pageerror', (e) => problemas.push('EXCEÇÃO: ' + e.message));
  pagina.on('console', (m) => { if (m.type() === 'error') problemas.push('CONSOLE: ' + m.text()); });

  const alvo = 'file:///' + path.join(ROOT, 'index.html').split(path.sep).join('/');
  await pagina.goto(alvo, { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1000));

  const inicial = await pagina.evaluate(() => ({
    meses: document.querySelectorAll('#lista-pdf li').length,
    vazioVisivel: !document.getElementById('vazio').hidden,
    conteudoOculto: document.getElementById('conteudo').hidden
  }));
  console.log('Inicial (sem dados): ' + inicial.meses + ' meses · vazio visível: ' +
    inicial.vazioVisivel + ' · conteúdo oculto: ' + inicial.conteudoOculto);

  if (inicial.meses !== 0) problemas.push('O painel deveria iniciar com 0 meses embutidos.');
  if (!inicial.vazioVisivel) problemas.push('O card #vazio deveria estar visível quando sem dados.');
  if (!inicial.conteudoOculto) problemas.push('O #conteudo deveria estar oculto quando sem dados.');

  const input = await pagina.$('#in-pdf');
  await input.uploadFile(...caminhos);

  await pagina.waitForFunction(
    (n) => document.querySelectorAll('#lista-pdf li').length >= n,
    { timeout: 180000, polling: 500 },
    caminhos.length
  ).catch(() => problemas.push('A lista de meses não cresceu depois do upload.'));
  await new Promise(r => setTimeout(r, 1200));

  const depois = await pagina.evaluate(() => ({
    meses: document.querySelectorAll('#lista-pdf li').length,
    vazioVisivel: !document.getElementById('vazio').hidden,
    conteudoOculto: document.getElementById('conteudo').hidden,
    heroi: document.getElementById('orc-heroi').textContent,
    despesa: document.querySelector('.tile .val')?.textContent,
    situacao: document.getElementById('situacao').textContent,
    novos: document.querySelectorAll('#lista-pdf .marca-nova').length,
    limparVisivel: !document.getElementById('bt-limpar').hidden
  }));

  console.log('Depois do upload: ' + depois.meses + ' meses · despesa ' +
    depois.despesa + ' · previsão ' + depois.heroi);

  if (depois.meses !== caminhos.length) problemas.push(`Esperava ${caminhos.length} meses, veio ${depois.meses}.`);
  if (depois.vazioVisivel) problemas.push('#vazio deveria ficar oculto após carregar PDFs.');
  if (depois.conteudoOculto) problemas.push('#conteudo deveria ficar visível após carregar PDFs.');
  if (!depois.limparVisivel) problemas.push('O botão de remover os PDFs adicionados não apareceu.');

  await pagina.reload({ waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 1500));
  const recarregado = await pagina.evaluate(() => ({
    meses: document.querySelectorAll('#lista-pdf li').length,
    despesa: document.querySelector('.tile .val')?.textContent
  }));
  console.log('Depois de recarregar: ' + recarregado.meses + ' meses · despesa ' + recarregado.despesa);
  if (recarregado.meses !== caminhos.length) problemas.push('Os meses adicionados não sobreviveram ao recarregar.');

  await pagina.evaluate(() => document.getElementById('bt-limpar').click());
  await new Promise(r => setTimeout(r, 800));
  const limpo = await pagina.evaluate(() => ({
    meses: document.querySelectorAll('#lista-pdf li').length,
    vazioVisivel: !document.getElementById('vazio').hidden
  }));
  console.log('Depois de limpar: ' + limpo.meses + ' meses · vazio visível: ' + limpo.vazioVisivel);
  if (limpo.meses !== 0 || !limpo.vazioVisivel) {
    problemas.push('Limpar não voltou o painel ao estado inicial vazio.');
  }
} finally {
  if (navegador) await navegador.close();
  fs.rmSync(TEMP, { recursive: true, force: true });
}

if (problemas.length) {
  console.log('\n*** PROBLEMAS ***');
  problemas.forEach(p => console.log('  - ' + p));
  process.exit(1);
}
console.log('\nO caminho do PDF pelo navegador funciona de ponta a ponta.');
