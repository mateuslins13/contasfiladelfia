/**
 * Extração das prestações de contas da USE Administradora (relatório W015A).
 *
 * O PDF monta o demonstrativo em três colunas independentes: rótulo à esquerda,
 * percentual no meio e valor à direita. Extrair o texto de forma linear embaralha
 * essas colunas (o total de receitas sai grudado no rótulo errado), então tudo
 * aqui trabalha com a coordenada x de cada fragmento.
 *
 * A indentação do rótulo dá a hierarquia do plano de contas:
 *   x ~31 -> nível 0  Receitas / Despesas / Total de Despesas / Saldo em ...
 *   x ~47 -> nível 1  Pessoal, Concessionarios, Operacional e de Funcionamento...
 *   x ~60 -> nível 2  Salarios, Energia, Elevadores, Manutenções...
 *   x ~73 -> nível 3  Ajuda de Custo, Contrato de Manutenção do Elevador...
 *
 * O mesmo arquivo roda no Node (geração do painel) e no navegador (PDF que o
 * síndico solta na tela), por isso nada de sintaxe exclusiva de módulo.
 */
(function (raiz) {
  'use strict';

  var MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  var MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  // Limites das colunas, em pontos. Medidos nos PDFs de 2026 da USE.
  var X_FIM_ROTULO = 400;
  var X_FIM_PCT = 520;

  // ----------------------------------------------------------------- utilidades

  /** Converte "1.234,56", "(127,55)" ou "8,71%" em número. Parênteses = negativo. */
  function numero(txt) {
    if (txt === null || txt === undefined) return null;
    var s = String(txt).trim();
    if (!s) return null;
    var negativo = /^\(/.test(s) || /^-/.test(s) || /-\s*$/.test(s);
    s = s.replace(/[()]/g, '').replace(/R\$/g, '').replace(/\s/g, '');
    s = s.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    var m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return null;
    var v = parseFloat(m[0]);
    if (isNaN(v)) return null;
    if (negativo && v > 0) v = -v;
    return v;
  }

  function normaliza(s) {
    return String(s === null || s === undefined ? '' : s)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .toLowerCase().trim();
  }

  function arredonda(v) {
    return Math.round(v * 100) / 100;
  }

  /**
   * Agrupa os fragmentos de texto de uma página em linhas e separa cada linha
   * nas três colunas. Fragmentos com y próximo pertencem à mesma linha.
   */
  function linhasDaPagina(itens) {
    var mapa = Object.create(null);
    for (var i = 0; i < itens.length; i++) {
      var it = itens[i];
      if (!it.str || !it.str.trim()) continue;
      var x = it.transform[4];
      var y = it.transform[5];
      var chave = Math.round(y / 3);
      if (!mapa[chave]) mapa[chave] = [];
      mapa[chave].push({ x: x, y: y, s: it.str });
    }

    return Object.keys(mapa)
      .map(function (k) { return { y: Number(k), itens: mapa[k] }; })
      .sort(function (a, b) { return b.y - a.y; })
      .map(function (linha) {
        linha.itens.sort(function (a, b) { return a.x - b.x; });
        var rotulo = [];
        var pct = null;
        var valor = null;
        for (var j = 0; j < linha.itens.length; j++) {
          var f = linha.itens[j];
          if (f.x < X_FIM_ROTULO) rotulo.push(f);
          else if (f.x < X_FIM_PCT) { if (pct === null) pct = f.s.trim(); }
          else valor = (valor === null ? '' : valor) + f.s.trim();
        }
        return {
          x: rotulo.length ? rotulo[0].x : (linha.itens[0] ? linha.itens[0].x : 0),
          texto: rotulo.map(function (f) { return f.s; }).join(' ').replace(/\s+/g, ' ').trim(),
          pct: numero(pct),
          valor: numero(valor),
          direita: valor,
          itens: linha.itens
        };
      });
  }

  function nivelPorX(x) {
    if (x < 40) return 0;
    if (x < 55) return 1;
    if (x < 68) return 2;
    return 3;
  }

  // ------------------------------------------------------ árvore de lançamentos

  function novoNo(nome, nivel) {
    return { nome: nome, nivel: nivel, valor: 0, proprio: null, filhos: [] };
  }

  /**
   * Monta a árvore de um bloco (Receitas ou Despesas).
   *
   * As linhas "Total de X" repetem o valor do grupo X; são ignoradas na estrutura
   * e reaproveitadas depois só para conferir a soma. O valor de um grupo é a soma
   * das folhas; grupos cujos filhos vieram sem valor caem no valor próprio.
   */
  function montaArvore(linhas) {
    var raizNo = novoNo('__raiz__', -1);
    var pilha = [raizNo];
    var totais = Object.create(null);

    for (var i = 0; i < linhas.length; i++) {
      var l = linhas[i];
      if (!l.texto) continue;
      var n = normaliza(l.texto);

      if (/^total de /.test(n)) {
        if (l.valor !== null) totais[n.replace(/^total de /, '')] = l.valor;
        continue;
      }
      // Rodapé da administradora e numeração de página não fazem parte do plano.
      if (/^(use administradora|58030-061|www\.useadministradora|\d+ de \d+)/.test(n)) continue;
      if (/^(saldo em|mov\. liquido|receitas|despesas)$/.test(n)) continue;
      if (/^saldo em /.test(n)) continue;

      var nivel = Math.max(1, nivelPorX(l.x));
      while (pilha.length > nivel) pilha.pop();
      while (pilha.length < nivel) pilha.push(pilha[pilha.length - 1]);

      var no = novoNo(l.texto.trim(), nivel);
      if (l.valor !== null) no.proprio = l.valor;
      if (l.pct !== null) no.pct = l.pct;
      pilha[pilha.length - 1].filhos.push(no);
      pilha.push(no);
    }

    (function consolida(no) {
      if (!no.filhos.length) {
        no.valor = arredonda(no.proprio || 0);
        return no.valor;
      }
      var somaFilhos = 0;
      for (var i = 0; i < no.filhos.length; i++) somaFilhos += consolida(no.filhos[i]);
      somaFilhos = arredonda(somaFilhos);
      no.valor = somaFilhos !== 0 ? somaFilhos : arredonda(no.proprio || 0);
      return no.valor;
    })(raizNo);

    raizNo.filhos.totais = totais;
    return raizNo.filhos;
  }

  /** Procura um nó pelo nome, em qualquer profundidade. */
  function acha(nos, nome) {
    var alvo = normaliza(nome);
    for (var i = 0; i < nos.length; i++) {
      if (normaliza(nos[i].nome) === alvo) return nos[i];
      var dentro = acha(nos[i].filhos, nome);
      if (dentro) return dentro;
    }
    return null;
  }

  function valorDe(nos, nome) {
    var no = acha(nos, nome);
    return no ? no.valor : 0;
  }

  function soma(nos) {
    var t = 0;
    for (var i = 0; i < nos.length; i++) t += nos[i].valor;
    return arredonda(t);
  }

  // ------------------------------------------------------------- páginas-chave

  function competenciaDoTexto(txt) {
    var m = String(txt).match(/\b(Jan|Fev|Mar|Abr|Mai|Jun|Jul|Ago|Set|Out|Nov|Dez)\/(\d{4})\b/i);
    if (m) {
      var idx = -1;
      for (var i = 0; i < MESES.length; i++) {
        if (normaliza(MESES[i]) === normaliza(m[1])) { idx = i; break; }
      }
      if (idx >= 0) return { mes: idx + 1, ano: Number(m[2]) };
    }
    var m2 = String(txt).match(/\b(Janeiro|Fevereiro|Março|Abril|Maio|Junho|Julho|Agosto|Setembro|Outubro|Novembro|Dezembro)\/(\d{4})\b/i);
    if (m2) {
      for (var j = 0; j < MESES_LONGOS.length; j++) {
        if (normaliza(MESES_LONGOS[j]) === normaliza(m2[1])) {
          return { mes: j + 1, ano: Number(m2[2]) };
        }
      }
    }
    return null;
  }

  /**
   * Localiza o demonstrativo (W015A) e a inadimplência (W073A) entre as páginas
   * já lidas. A pasta repete o demonstrativo no fim, por isso vale a primeira
   * ocorrência; e ele transborda para a página seguinte, então as próximas
   * páginas são anexadas até aparecer o "Saldo em" final.
   */
  function extraiDePaginas(paginas) {
    var competencia = null;
    var demonstrativo = null;
    var inadimplencia = null;

    for (var p = 0; p < paginas.length; p++) {
      var linhas = paginas[p];
      if (!linhas || !linhas.length) continue;
      var texto = linhas.map(function (l) { return l.texto; }).join(' ¶ ');

      if (!competencia) competencia = competenciaDoTexto(texto);

      if (!demonstrativo && /Demonstrativo de Receitas e Despesas/i.test(texto)) {
        var c = competenciaDoTexto(texto);
        if (c) competencia = c;
        var acumulado = linhas.slice();
        for (var q = p + 1; q < paginas.length; q++) {
          var proxTexto = paginas[q].map(function (l) { return l.texto; }).join(' ¶ ');
          if (/Demonstrativo de Receitas e Despesas/i.test(proxTexto)) break;
          acumulado = acumulado.concat(paginas[q]);
          if (/Mov\. L[í i]quido/i.test(proxTexto)) break;
        }
        demonstrativo = acumulado;
      }

      if (!inadimplencia && /Saldo da inadimpl[ê e]ncia/i.test(texto)) {
        inadimplencia = linhas;
      }
    }

    if (!demonstrativo) return null;
    return montaResultado(demonstrativo, inadimplencia, competencia);
  }

  function montaResultado(linhas, linhasInad, competencia) {
    var iRec = -1, iTotRec = -1, iDesp = -1, iTotDesp = -1;
    for (var i = 0; i < linhas.length; i++) {
      var n = normaliza(linhas[i].texto);
      if (iRec < 0 && n === 'receitas') { iRec = i; continue; }
      if (iRec >= 0 && iTotRec < 0 && n === 'total de receitas') { iTotRec = i; continue; }
      if (iTotRec >= 0 && iDesp < 0 && n === 'despesas') { iDesp = i; continue; }
      if (iDesp >= 0 && iTotDesp < 0 && n === 'total de despesas') { iTotDesp = i; continue; }
    }
    if (iRec < 0 || iTotRec < 0 || iDesp < 0) return null;

    var blocoRec = linhas.slice(iRec + 1, iTotRec);
    var blocoDesp = linhas.slice(iDesp + 1, iTotDesp > iDesp ? iTotDesp : linhas.length);

    var receitas = montaArvore(blocoRec);
    var despesas = montaArvore(blocoDesp);

    function primeiroValor(re) {
      for (var i = 0; i < linhas.length; i++) {
        if (re.test(normaliza(linhas[i].texto)) && linhas[i].valor !== null) return linhas[i].valor;
      }
      return null;
    }

    var totalReceitas = linhas[iTotRec].valor !== null ? linhas[iTotRec].valor : soma(receitas);
    var totalDespesas = (iTotDesp >= 0 && linhas[iTotDesp].valor !== null)
      ? linhas[iTotDesp].valor : soma(despesas);

    var saldos = [];
    for (var k = 0; k < linhas.length; k++) {
      if (/^saldo em /.test(normaliza(linhas[k].texto)) && linhas[k].valor !== null) {
        saldos.push(linhas[k].valor);
      }
    }

    var movLiquido = primeiroValor(/^mov\. liquido/);

    return {
      competencia: competencia,
      mes: competencia ? competencia.mes : null,
      ano: competencia ? competencia.ano : null,
      rotulo: competencia ? MESES[competencia.mes - 1] + '/' + competencia.ano : '—',
      rotuloLongo: competencia ? MESES_LONGOS[competencia.mes - 1] + '/' + competencia.ano : '—',
      saldoInicial: saldos.length ? saldos[0] : null,
      saldoFinal: saldos.length > 1 ? saldos[saldos.length - 1] : null,
      totalReceitas: totalReceitas,
      totalDespesas: totalDespesas,
      resultado: movLiquido !== null ? movLiquido : arredonda(totalReceitas - totalDespesas),
      taxaCondominio: valorDe(receitas, 'Taxa de Condomínio'),
      taxaExtra: valorDe(receitas, 'Taxa Extra'),
      concessionarias: {
        energia: valorDe(despesas, 'Energia'),
        agua: valorDe(despesas, 'Agua'),
        gas: valorDe(despesas, 'Gas')
      },
      receitas: receitas,
      despesas: despesas,
      inadimplencia: linhasInad ? leInadimplencia(linhasInad) : null,
      conferencia: {
        somaReceitas: soma(receitas),
        somaDespesas: soma(despesas),
        difReceitas: arredonda(soma(receitas) - totalReceitas),
        difDespesas: arredonda(soma(despesas) - totalDespesas)
      }
    };
  }

  /**
   * Bloco W073A. Cada linha traz a sequência "anterior - regularizadas + novas
   * = atual"; o número da coluna da direita é a posição do mês corrente.
   */
  function leInadimplencia(linhas) {
    var res = { boletos: null, unidades: null, percentual: null, valor: null };
    for (var i = 0; i < linhas.length; i++) {
      var l = linhas[i];
      var n = normaliza(l.texto);
      var direita = l.itens.filter(function (f) { return f.x >= 500; })
        .map(function (f) { return f.s.trim(); }).join(' ');
      if (!direita) continue;
      if (res.boletos === null && /^boletos/.test(n)) {
        res.boletos = numero(direita);
      } else if (res.unidades === null && /^unidades/.test(n)) {
        // A célula junta contagem e percentual: "2(8%)" = 2 unidades, 8% do total.
        // Ler o conjunto como número daria 28, então os dois vêm separados.
        var comPct = direita.match(/(\d+)\s*\(\s*(\d+(?:[.,]\d+)?)\s*%\s*\)/);
        if (comPct) {
          res.unidades = numero(comPct[1]);
          res.percentual = numero(comPct[2]);
        } else {
          res.unidades = numero(direita.replace(/\(.*?\)/g, ''));
        }
      } else if (res.valor === null && /^valor/.test(n)) {
        res.valor = numero(direita);
      }
    }
    return res;
  }

  // ---------------------------------------------------------------- via pdf.js

  /**
   * Lê um PDF com pdf.js e devolve a prestação extraída.
   * Só as primeiras páginas interessam; as ~200 restantes são comprovantes
   * digitalizados, então a varredura para assim que o demonstrativo fecha.
   */
  async function lePdf(pdfjsLib, dados, opcoes) {
    var op = opcoes || {};
    var doc = await pdfjsLib.getDocument({
      data: dados,
      useSystemFonts: true,
      isEvalSupported: false
    }).promise;

    var limite = Math.min(doc.numPages, op.maxPaginas || 40);
    var paginas = [];
    var resultado = null;

    for (var p = 1; p <= limite; p++) {
      var page = await doc.getPage(p);
      var tc = await page.getTextContent();
      paginas.push(linhasDaPagina(tc.items));
      if (page.cleanup) page.cleanup();

      // A inadimplência vem depois do demonstrativo; para quando as duas saíram.
      resultado = extraiDePaginas(paginas);
      if (resultado && resultado.inadimplencia && resultado.inadimplencia.valor !== null) break;
    }

    if (!resultado) resultado = extraiDePaginas(paginas);
    if (resultado) resultado.paginas = doc.numPages;
    try { await doc.destroy(); } catch (e) { /* nada a fazer */ }
    return resultado;
  }

  var api = {
    MESES: MESES,
    MESES_LONGOS: MESES_LONGOS,
    numero: numero,
    normaliza: normaliza,
    arredonda: arredonda,
    linhasDaPagina: linhasDaPagina,
    extraiDePaginas: extraiDePaginas,
    lePdf: lePdf,
    acha: acha,
    valorDe: valorDe,
    soma: soma
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else raiz.ParserPrestacao = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
