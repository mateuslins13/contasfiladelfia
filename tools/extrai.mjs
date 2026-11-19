/**
 * Lê os PDFs de prestação de contas da pasta e grava src/dados.json.
 *
 * Roda no Node com o pdf.js legacy. É o mesmo parser que o navegador usa
 * quando um PDF novo é solto na tela, então o resultado é idêntico nos dois
 * caminhos. Uso: node tools/extrai.mjs [pasta]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// O parser é UMD. Como o pacote é "type": "module", o Node o carrega como ESM
// e o registro cai em globalThis em vez de module.exports — daí o fallback.
const carregado = require(path.join(ROOT, 'src/parser-prestacao.js'));
const Parser = (carregado && carregado.lePdf) ? carregado : globalThis.ParserPrestacao;
if (!Parser || !Parser.lePdf) {
  console.error('Não foi possível carregar src/parser-prestacao.js');
  process.exit(1);
}

// O build legacy do pdf.js funciona sem canvas nem DOM.
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

const PASTA = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'prestacao-de-contas');
const SAIDA = path.join(ROOT, 'src/dados.json');
const UNIDADES_PAGANTES = 25;
const UNIDADES_TOTAL = 26;

const pdfs = fs.readdirSync(PASTA)
  .filter(f => /\.pdf$/i.test(f))
  .map(f => path.join(PASTA, f));

if (!pdfs.length) {
  console.error(`Nenhum PDF encontrado em ${PASTA}`);
  process.exit(1);
}

console.log(`Lendo ${pdfs.length} PDF(s) de ${PASTA}\n`);

const meses = [];
const problemas = [];

for (const arquivo of pdfs) {
  const nome = path.basename(arquivo);
  try {
    const dados = new Uint8Array(fs.readFileSync(arquivo));
    const res = await Parser.lePdf(pdfjsLib, dados, { maxPaginas: 40 });
    if (!res) {
      problemas.push(`${nome}: demonstrativo (W015A) não localizado`);
      console.log(`  ✗ ${nome} — sem demonstrativo`);
      continue;
    }
    res.arquivo = nome;
    res.bytes = fs.statSync(arquivo).size;
    meses.push(res);

    const conf = res.conferencia;
    const alerta = (Math.abs(conf.difDespesas) > 0.05 || Math.abs(conf.difReceitas) > 0.05)
      ? `  ⚠ dif R:${conf.difReceitas} D:${conf.difDespesas}` : '';
    console.log(
      `  ✓ ${res.rotulo}  rec ${brl(res.totalReceitas)}  desp ${brl(res.totalDespesas)}` +
      `  res ${brl(res.resultado)}` +
      `  [en ${brl(res.concessionarias.energia)} ag ${brl(res.concessionarias.agua)}` +
      ` gas ${brl(res.concessionarias.gas)}]${alerta}  (${nome})`);
    if (alerta) problemas.push(`${nome} (${res.rotulo}):${alerta.trim()}`);
  } catch (erro) {
    problemas.push(`${nome}: ${erro.message}`);
    console.log(`  ✗ ${nome} — ${erro.message}`);
  }
}

if (!meses.length) {
  console.error('\nNenhuma prestação pôde ser lida.');
  process.exit(1);
}

meses.sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes));

// Duas pastas do mesmo mês: fica a mais recente lida.
const porCompetencia = new Map();
for (const m of meses) porCompetencia.set(`${m.ano}-${m.mes}`, m);
const finais = [...porCompetencia.values()].sort((a, b) => (a.ano - b.ano) || (a.mes - b.mes));

const saida = {
  geradoEm: new Date().toISOString(),
  condominio: 'Condomínio do Edifício Residencial Filadelfia',
  cnpj: '03.582.250/0001-75',
  endereco: 'Rua José Augusto Trindade, 549 - Tambaú, CEP 58039-021 - João Pessoa/PB',
  administradora: 'USE Administradora de Condomínios',
  unidades: { total: UNIDADES_TOTAL, pagantes: UNIDADES_PAGANTES },
  anoBase: finais[finais.length - 1].ano,
  meses: finais,
  problemas
};

fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
fs.writeFileSync(SAIDA, JSON.stringify(saida, null, 1), 'utf8');

const desp = finais.map(m => m.totalDespesas);
const media = desp.reduce((a, b) => a + b, 0) / desp.length;
console.log(`\n${finais.length} mês(es): ${finais.map(m => m.rotulo).join(', ')}`);
console.log(`Despesa média mensal: ${brl(media)}  |  projeção 12 meses: ${brl(media * 12)}`);
console.log(`Rateio por unidade pagante (${UNIDADES_PAGANTES}): ${brl(media / UNIDADES_PAGANTES)}/mês`);
if (problemas.length) console.log(`\nAvisos:\n  ${problemas.join('\n  ')}`);
console.log(`\ndados.json gravado (${(fs.statSync(SAIDA).size / 1024).toFixed(0)} KB)`);

function brl(v) {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
