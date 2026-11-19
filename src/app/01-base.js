/**
 * Painel das prestações de contas do Edifício Filadelfia.
 *
 * Nenhum dado financeiro vem embutido no HTML. Localmente (com server.mjs),
 * os PDFs são lidos da pasta prestacao-de-contas/ e processados no navegador.
 * Pela web (GitHub Pages) ou aberto direto do disco, os PDFs escolhidos na
 * tela são processados exclusivamente na memória do navegador.
 */
(function () {
  'use strict';

  var Base = {
    condominio: 'Condomínio do Edifício Residencial Filadelfia',
    cnpj: '03.582.250/0001-75',
    endereco: 'Rua José Augusto Trindade, 549 - Tambaú, CEP 58039-021 - João Pessoa/PB',
    administradora: 'USE Administradora de Condomínios',
    unidades: { total: 26, pagantes: 25 },
    anoBase: new Date().getFullYear(),
    meses: []
  };
  var CHAVE_LOCAL = 'filadelfia:extras:v1';
  var CHAVE_CACHE_PASTA = 'filadelfia:pasta-cache:v1';

  var PAGANTES = (Base.unidades && Base.unidades.pagantes) || 25;
  var TOTAL_UNID = (Base.unidades && Base.unidades.total) || 26;
  var ANO_ORC = (Base.anoBase || new Date().getFullYear()) + 1;

  /**
   * Grupos do plano de contas com o slot de cor fixo por NOME.
   * A cor nunca segue a posição no ranking nem a ordem do filtro, então isolar
   * um grupo não repinta os outros. A ordem da lista é também a ordem das
   * fatias na pilha — é a sequência de slots validada para daltonismo.
   */
  var GRUPOS = [
    { nome: 'Pessoal',                        rot: 'Pessoal',              slot: 1 },
    { nome: 'Concessionarios',                rot: 'Concessionárias',      slot: 2 },
    { nome: 'Operacional e de Funcionamento', rot: 'Operacional',          slot: 3 },
    { nome: 'Administrativas',                rot: 'Administrativas',      slot: 4 },
    { nome: 'Obras e Reparos',                rot: 'Obras e Reparos',      slot: 5 },
    { nome: 'Compra de Bens e Equipamentos',  rot: 'Bens e Equipamentos',  slot: 6 },
    { nome: 'Bancarias',                      rot: 'Bancárias',            slot: 7 }
  ];

  var P = window.ParserPrestacao;

  // ------------------------------------------------------------------ formatos

  var fBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var fNum = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var fInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

  function brl(v) { return (v === null || v === undefined) ? '—' : fBRL.format(v); }
  function num(v) { return (v === null || v === undefined) ? '—' : fNum.format(v); }

  /** Rótulo curto para eixo: 12345 vira "12 mil". */
  function compacto(v) {
    var a = Math.abs(v);
    if (a >= 1000000) return fInt.format(v / 1000000) + ' mi';
    if (a >= 1000) return fInt.format(v / 1000) + ' mil';
    return fInt.format(v);
  }

  function pct(v) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    var s = Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    return (v < 0 ? '−' : '') + s + '%';
  }

  function tok(nome) {
    return getComputedStyle(document.documentElement).getPropertyValue('--' + nome).trim();
  }
  function cor(slot) { return tok('s' + slot); }

  function el(tag, attrs, texto) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    // textContent: nomes de conta vêm do PDF, nunca entram como HTML.
    if (texto !== undefined && texto !== null) n.textContent = String(texto);
    return n;
  }
  function limpa(no) { while (no.firstChild) no.removeChild(no.firstChild); }
  function $(id) { return document.getElementById(id); }

  // -------------------------------------------------------------------- estado

  var estado = {
    meses: [],       // daPasta + extras, ordenados por competência
    daPasta: [],     // lidos da pasta prestacao-de-contas/ via servidor local
    extras: [],      // lidos neste navegador (modo manual / sem servidor)
    temServidor: false,
    pastaLabel: 'prestacao-de-contas/',
    processando: false,
    iDe: 0,
    iAte: 0,
    oculto: {},      // grupos desligados na legenda de composição
    tabelas: false,
    reajuste: 0,
    fundo: 0
  };

  function carregaExtras() {
    try {
      var lista = JSON.parse(localStorage.getItem(CHAVE_LOCAL) || '[]');
      return Array.isArray(lista) ? lista : [];
    } catch (e) { return []; }
  }

  function salvaExtras() {
    try { localStorage.setItem(CHAVE_LOCAL, JSON.stringify(estado.extras)); }
    catch (e) { /* cota cheia: o painel segue funcionando nesta sessão */ }
  }

  function carregaCachePasta() {
    try {
      var obj = JSON.parse(localStorage.getItem(CHAVE_CACHE_PASTA) || '{}');
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) { return {}; }
  }

  function salvaCachePasta(obj) {
    try { localStorage.setItem(CHAVE_CACHE_PASTA, JSON.stringify(obj)); }
    catch (e) { /* cota cheia */ }
  }

  /** Junta os PDFs da pasta e os extras manuais; em conflito de competência, o extra vence. */
  function consolida() {
    var mapa = new Map();
    (Base.meses || []).forEach(function (m) { mapa.set(m.ano + '-' + m.mes, m); });
    (estado.daPasta || []).forEach(function (m) {
      m.origem = 'pasta';
      mapa.set(m.ano + '-' + m.mes, m);
    });
    estado.extras.forEach(function (m) {
      m.novo = true;
      m.origem = 'manual';
      mapa.set(m.ano + '-' + m.mes, m);
    });
    estado.meses = Array.from(mapa.values()).sort(function (a, b) {
      return (a.ano - b.ano) || (a.mes - b.mes);
    });
    if (estado.meses.length) {
      Base.anoBase = estado.meses[estado.meses.length - 1].ano;
      ANO_ORC = Base.anoBase + 1;
    }
  }

  function periodo() { return estado.meses.slice(estado.iDe, estado.iAte + 1); }

  // --------------------------------------------------------------- agregações

  function grupoDe(nome) {
    var alvo = P.normaliza(nome);
    for (var i = 0; i < GRUPOS.length; i++) {
      if (P.normaliza(GRUPOS[i].nome) === alvo) return GRUPOS[i];
    }
    return null;
  }

  /** Valor de um grupo de despesa num mês (0 quando o grupo não aparece). */
  function valorGrupo(mes, nomeGrupo) {
    var no = P.acha(mes.despesas, nomeGrupo);
    return no ? no.valor : 0;
  }

  /** Soma por grupo no período, na ordem de slot. */
  function porGrupo(meses) {
    return GRUPOS.map(function (g) {
      var total = meses.reduce(function (s, m) { return s + valorGrupo(m, g.nome); }, 0);
      return { grupo: g, total: P.arredonda(total) };
    });
  }

  /**
   * Folhas de despesa agregadas no período, para o ranking de maiores contas.
   * Só folhas: somar grupo e subgrupo juntos contaria o mesmo real duas vezes.
   */
  function folhas(meses) {
    var mapa = new Map();
    meses.forEach(function (m) {
      (m.despesas || []).forEach(function (g) {
        var info = grupoDe(g.nome);
        var slot = info ? info.slot : 7;
        var rotGrupo = info ? info.rot : g.nome;
        (function desce(no, caminho) {
          if (!no.filhos || !no.filhos.length) {
            var chave = caminho.join(' › ');
            var atual = mapa.get(chave) || {
              nome: no.nome, caminho: chave, grupo: rotGrupo,
              slot: slot, total: 0, meses: 0
            };
            atual.total = P.arredonda(atual.total + no.valor);
            if (no.valor) atual.meses += 1;
            mapa.set(chave, atual);
            return;
          }
          no.filhos.forEach(function (f) { desce(f, caminho.concat(f.nome)); });
        })(g, [g.nome]);
      });
    });
    return Array.from(mapa.values())
      .filter(function (f) { return f.total > 0; })
      .sort(function (a, b) { return b.total - a.total; });
  }

  /** Números do período que alimentam tiles, orçamento e rodapé. */
  function resumo(meses) {
    var n = meses.length || 1;
    function soma(campo) {
      return meses.reduce(function (s, m) { return s + (m[campo] || 0); }, 0);
    }
    var somaRec = soma('totalReceitas');
    var somaDesp = soma('totalDespesas');
    var somaTaxa = soma('taxaCondominio');
    var ultimo = meses[meses.length - 1] || null;
    var primeiro = meses[0] || null;
    var comInad = meses.filter(function (m) {
      return m.inadimplencia && m.inadimplencia.valor !== null;
    });
    return {
      n: n,
      receitas: P.arredonda(somaRec),
      despesas: P.arredonda(somaDesp),
      resultado: P.arredonda(somaRec - somaDesp),
      mediaDespesa: P.arredonda(somaDesp / n),
      mediaReceita: P.arredonda(somaRec / n),
      mediaTaxa: P.arredonda(somaTaxa / n),
      mediaExtra: P.arredonda(soma('taxaExtra') / n),
      taxaPorUnidade: P.arredonda(somaTaxa / n / PAGANTES),
      custoPorUnidade: P.arredonda(somaDesp / n / PAGANTES),
      saldoInicial: primeiro ? primeiro.saldoInicial : null,
      saldoFinal: ultimo ? ultimo.saldoFinal : null,
      ultimo: ultimo,
      inadUltima: comInad.length ? comInad[comInad.length - 1] : null,
      mesesPositivos: meses.filter(function (m) { return (m.resultado || 0) >= 0; }).length
    };
  }

  // ------------------------------------------------------------------ gráficos

  var graficos = {};
  var GAP = 2;   // separação entre marcas, na cor da superfície

  /**
   * Arredonda só a ponta da barra que fecha a pilha: as fatias do meio não têm
   * ponta livre, e arredondar todas faria a coluna parecer costurada.
   */
  function raioDoTopo(ctx) {
    var ds = ctx.chart.data.datasets;
    var i = ctx.dataIndex;
    for (var k = ds.length - 1; k >= 0; k--) {
      var meta = ctx.chart.getDatasetMeta(k);
      if (meta.hidden) continue;
      var v = ds[k].data[i];
      if (v) return k === ctx.datasetIndex ? 4 : 0;
    }
    return 0;
  }

  function eixoValor(extra) {
    var base = {
      border: { color: tok('eixo'), width: 1 },
      grid: { color: tok('grade'), lineWidth: 1, drawTicks: false, tickLength: 0 },
      ticks: {
        color: tok('ink-mudo'), font: { size: 11 }, padding: 7,
        callback: function (v) { return compacto(v); }
      }
    };
    if (extra) for (var k in extra) base[k] = extra[k];
    return base;
  }

  function eixoCategoria(extra) {
    var base = {
      border: { color: tok('eixo'), width: 1 },
      grid: { display: false },
      ticks: { color: tok('ink-mudo'), font: { size: 11 }, padding: 5 }
    };
    if (extra) for (var k in extra) base[k] = extra[k];
    return base;
  }

  /** Tooltip em HTML: valor primeiro, nome da série em segundo plano. */
  function tooltipExterno(contexto) {
    var tt = $('tt');
    var tip = contexto.tooltip;
    if (!tip || !tip.opacity) { tt.classList.remove('on'); tt.setAttribute('aria-hidden', 'true'); return; }

    limpa(tt);
    var titulo = (tip.title && tip.title[0]) || '';
    if (titulo) tt.appendChild(el('div', { class: 'tt-tit' }, titulo));

    var pontos = tip.dataPoints || [];
    var total = 0;
    // Só somar onde a soma significa algo: pilha do mesmo eixo. Receita + despesa
    // lado a lado não formam total nenhum.
    var somavel = pontos.length > 1 &&
      pontos.every(function (p) { return p.dataset.somavel; });

    pontos.forEach(function (p) {
      var meta = (p.dataset && p.dataset.meta) || {};
      var linha = el('div', { class: 'tt-lin' });
      var chave = el('span', { class: 'tt-k' });
      chave.style.background = p.dataset.borderColor && p.dataset.type === 'line'
        ? p.dataset.borderColor : p.dataset.backgroundColor;
      linha.appendChild(chave);
      linha.appendChild(el('span', { class: 'tt-n' }, p.dataset.label || ''));
      var bruto = (p.raw === null || p.raw === undefined) ? null : Number(p.raw);
      linha.appendChild(el('span', { class: 'tt-v' },
        meta.contagem ? fInt.format(bruto) + (bruto === 1 ? ' unidade' : ' unidades') : brl(bruto)));
      tt.appendChild(linha);
      if (bruto) total += bruto;
    });

    // O detalhe extra que o mês carrega (unidades em atraso, % do mês).
    var nota = pontos.length && pontos[0].dataset.notas
      ? pontos[0].dataset.notas[pontos[0].dataIndex] : null;
    if (nota) {
      var l = el('div', { class: 'tt-lin tt-tot' });
      l.appendChild(el('span', { class: 'tt-n' }, nota.rot));
      l.appendChild(el('span', { class: 'tt-v' }, nota.val));
      tt.appendChild(l);
    } else if (somavel) {
      var t = el('div', { class: 'tt-lin tt-tot' });
      t.appendChild(el('span', { class: 'tt-n' }, 'Total'));
      t.appendChild(el('span', { class: 'tt-v' }, brl(P.arredonda(total))));
      tt.appendChild(t);
    }

    var caixa = contexto.chart.canvas.getBoundingClientRect();
    tt.classList.add('on');
    tt.setAttribute('aria-hidden', 'false');
    var largura = tt.offsetWidth;
    var x = caixa.left + tip.caretX + 14;
    if (x + largura > window.innerWidth - 8) x = caixa.left + tip.caretX - largura - 14;
    var y = caixa.top + tip.caretY - tt.offsetHeight / 2;
    y = Math.max(8, Math.min(y, window.innerHeight - tt.offsetHeight - 8));
    tt.style.left = Math.max(8, x) + 'px';
    tt.style.top = y + 'px';
  }

  var COMUM = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 220 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },        // a legenda é HTML, fora do canvas
      tooltip: { enabled: false, external: tooltipExterno }
    }
  };

  function opcoes(extra) {
    var o = JSON.parse(JSON.stringify(COMUM));
    o.plugins.tooltip = { enabled: false, external: tooltipExterno };
    for (var k in extra) o[k] = extra[k];
    return o;
  }

  /**
   * Rótulo direto sobre a última coluna. Vale como reforço de identidade nas
   * séries de cor clara, que ficam abaixo de 3:1 no tema claro.
   */
  var rotuloUltima = {
    id: 'rotuloUltima',
    afterDatasetsDraw: function (chart) {
      var ds = chart.data.datasets[0];
      if (!ds || !ds.rotularUltima) return;
      var meta = chart.getDatasetMeta(0);
      var i = ds.data.length - 1;
      var barra = meta.data[i];
      if (!barra || ds.data[i] === null) return;
      var g = chart.ctx;
      g.save();
      g.font = '650 11.5px ' + tok('sans');
      g.fillStyle = tok('ink');
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      var texto = brl(ds.data[i]);
      var x = Math.min(Math.max(barra.x, chart.chartArea.left + g.measureText(texto).width / 2),
        chart.chartArea.right - g.measureText(texto).width / 2);
      g.fillText(texto, x, barra.y - 6);
      g.restore();
    }
  };

  /** Valor na ponta das barras horizontais, na folga reservada à direita. */
  var rotuloPonta = {
    id: 'rotuloPonta',
    afterDatasetsDraw: function (chart) {
      var ds = chart.data.datasets[0];
      if (!ds || !ds.rotularPonta || chart.data.datasets.length > 1) return;
      var meta = chart.getDatasetMeta(0);
      var g = chart.ctx;
      g.save();
      g.font = '11.5px ' + tok('sans');
      g.fillStyle = tok('ink-2');
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      meta.data.forEach(function (barra, i) {
        if (!ds.data[i]) return;
        g.fillText(brl(ds.data[i]), barra.x + 7, barra.y);
      });
      g.restore();
    }
  };

  Chart.register(rotuloUltima, rotuloPonta);

  function desenha(id, cfg) {
    if (graficos[id]) graficos[id].destroy();
    var canvas = $(id);
    if (!canvas) return;
    graficos[id] = new Chart(canvas.getContext('2d'), cfg);
  }

  // ------------------------------------------------------------------ legendas

  /**
   * Legenda em HTML. Com aoAlternar vira botão de isolar série; sem, é só chave
   * de identidade (a leitura nunca depende de casar cores de cabeça).
   */
  function montaLegenda(alvo, itens, aoAlternar) {
    var ul = $(alvo);
    if (!ul) return;
    limpa(ul);
    itens.forEach(function (it) {
      var li = el('li');
      var chave = el('span', { class: 'chave' + (it.linha ? ' linha' : ''), 'aria-hidden': 'true' });
      chave.style.background = it.cor;
      if (aoAlternar) {
        var b = el('button', { type: 'button', 'aria-pressed': it.on === false ? 'false' : 'true' });
        b.appendChild(chave);
        b.appendChild(el('span', null, it.rot));
        b.addEventListener('click', function () { aoAlternar(it); });
        li.appendChild(b);
      } else {
        li.appendChild(chave);
        li.appendChild(el('span', null, it.rot));
      }
      ul.appendChild(li);
    });
  }

  // ------------------------------------------------------------------- tabelas

  /**
   * Tabela equivalente ao gráfico. É o caminho sem cor nem hover para o mesmo
   * dado, e o que sai na impressão.
   */
  function montaTabela(alvo, colunas, linhas, rodape, legendaTexto) {
    var area = $(alvo);
    if (!area) return;
    limpa(area);
    var tab = el('table');
    if (legendaTexto) tab.appendChild(el('caption', { class: 'sr-only' }, legendaTexto));

    var thead = el('thead');
    var trh = el('tr');
    colunas.forEach(function (c) {
      trh.appendChild(el('th', { scope: 'col' }, typeof c === 'string' ? c : c.rot));
    });
    thead.appendChild(trh);
    tab.appendChild(thead);

    var tbody = el('tbody');
    linhas.forEach(function (linha) {
      var tr = el('tr');
      linha.forEach(function (celula, i) {
        var conf = (celula && typeof celula === 'object') ? celula : { txt: celula };
        var td = el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : null);
        if (conf.class) td.className = conf.class;
        if (conf.slot) {
          var ponto = el('span', { class: 'pt', 'aria-hidden': 'true' });
          ponto.style.background = cor(conf.slot);
          td.appendChild(ponto);
        }
        td.appendChild(document.createTextNode(conf.txt === undefined || conf.txt === null ? '—' : String(conf.txt)));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tab.appendChild(tbody);

    if (rodape) {
      var tfoot = el('tfoot');
      var trf = el('tr');
      rodape.forEach(function (c, i) {
        trf.appendChild(el(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : null,
          c === undefined || c === null ? '' : c));
      });
      tfoot.appendChild(trf);
      tab.appendChild(tfoot);
    }
    area.appendChild(tab);
  }
