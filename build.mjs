/**
 * Gera o index.html: um arquivo único, sem dependência de rede e sem dados
 * financeiros embutidos.
 *
 * Chart.js, o pdf.js, o worker (em base64) e o parser entram embutidos. As
 * prestações de contas são lidas em tempo de execução a partir da pasta
 * prestacao-de-contas/ (via server.mjs) ou dos PDFs escolhidos na tela.
 *
 * Uso: node build.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const p = (...t) => path.join(ROOT, ...t);

const SAIDA = p('index.html');
const VENDOR = {
  chart: p('node_modules/chart.js/dist/chart.umd.js'),
  // Build legacy: roda em navegador antigo e não depende de módulos ES.
  pdf: p('node_modules/pdfjs-dist-umd/legacy/build/pdf.min.js'),
  worker: p('node_modules/pdfjs-dist-umd/legacy/build/pdf.worker.min.js')
};

for (const [nome, arq] of Object.entries(VENDOR)) {
  if (!fs.existsSync(arq)) {
    console.error(`Falta ${nome}: ${path.relative(ROOT, arq)}\nRode: npm install`);
    process.exit(1);
  }
}

const le = (arq) => fs.readFileSync(arq, 'utf8');

// As partes do app são concatenadas na ordem do nome do arquivo: todas vivem
// dentro da mesma IIFE, aberta em 01-base.js e fechada em 05-pdf-eventos.js.
const partes = fs.readdirSync(p('src/app')).filter(f => f.endsWith('.js')).sort();
const app = partes.map(f => le(p('src/app', f))).join('\n');
console.log(`app.js montado de ${partes.length} parte(s): ${partes.join(', ')}`);

const workerB64 = fs.readFileSync(VENDOR.worker).toString('base64');

/** Fecha </script> dentro de string/JSON para o navegador não cortar o bloco. */
const seguro = (s) => s.replace(/<\/script>/gi, '<\\/script>');

const inline = (js) => `<script>\n${seguro(js)}\n</script>`;

let html = le(p('src/template.html'))
  .replace('<script src="__CHARTJS__"></script>', () => inline(le(VENDOR.chart)))
  .replace('<script src="__PDFJS__"></script>', () => inline(le(VENDOR.pdf)))
  .replace('<script src="__PARSER__"></script>', () => inline(le(p('src/parser-prestacao.js'))))
  .replace('__WORKER_B64__', () => workerB64)
  .replace('<script src="__APP__"></script>', () => inline(app));

const pendentes = html.match(/__[A-Z_]+__/g);
if (pendentes) {
  console.error(`Marcador não substituído no template: ${[...new Set(pendentes)].join(', ')}`);
  process.exit(1);
}

fs.writeFileSync(SAIDA, html, 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';
console.log(`\nindex.html gerado (${(fs.statSync(SAIDA).size / 1024 / 1024).toFixed(2)} MB, sem dados embutidos)`);
console.log(`  chart.js ${kb(fs.statSync(VENDOR.chart).size)} · pdf.js ${kb(fs.statSync(VENDOR.pdf).size)}` +
  ` · worker b64 ${kb(workerB64.length)}`);
console.log('\nInicie localmente com: npm start');
