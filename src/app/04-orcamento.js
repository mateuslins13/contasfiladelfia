  // ---------------------------------------------------- média e previsão anual

  /**
   * A previsão parte da média mensal de cada grupo no período filtrado,
   * projeta 12 meses, aplica o reajuste e o fundo de reserva informados e
   * rateia entre as unidades que pagam taxa.
   *
   * Grupo eventual (Obras e Reparos, por exemplo) puxa a média para cima num
   * período curto: a tabela mostra a média grupo a grupo justamente para o
   * conselho decidir o que repetir no orçamento.
   */
  function calculaOrcamento(meses) {
    var n = meses.length || 1;
    var reaj = 1 + (estado.reajuste || 0) / 100;
    var linhas = porGrupo(meses).map(function (x) {
      var media = P.arredonda(x.total / n);
      return {
        grupo: x.grupo,
        total: x.total,
        media: media,
        anual: P.arredonda(media * 12),
        projetado: P.arredonda(media * 12 * reaj)
      };
    });
    var mediaMes = P.arredonda(linhas.reduce(function (s, l) { return s + l.media; }, 0));
    var anual = P.arredonda(linhas.reduce(function (s, l) { return s + l.projetado; }, 0));
    var fundo = P.arredonda(anual * (estado.fundo || 0) / 100);
    var necessario = P.arredonda(anual + fundo);
    return {
      linhas: linhas,
      n: n,
      mediaMes: mediaMes,
      anual: anual,
      fundo: fundo,
      necessario: necessario,
      mensalPorUnidade: P.arredonda(necessario / 12 / PAGANTES),
      anualPorUnidade: P.arredonda(necessario / PAGANTES)
    };
  }

  function pintaOrcamento(meses, r) {
    var o = calculaOrcamento(meses);

    $('orc-heroi').textContent = brl(o.mensalPorUnidade);
    $('orc-heroi-sub').textContent =
      'Base: média de ' + o.n + (o.n === 1 ? ' mês' : ' meses') + ' (' +
      meses[0].rotulo + ' a ' + meses[meses.length - 1].rotulo + ') · ' +
      brl(o.necessario) + ' no ano ÷ 12 ÷ ' + PAGANTES + ' unidades';

    // Comparação com o que se arrecada hoje de taxa por unidade.
    var hoje = r.taxaPorUnidade;
    var lista = $('orc-lista');
    limpa(lista);
    [
      ['Despesa média mensal', brl(o.mediaMes)],
      ['Projeção de 12 meses' + (estado.reajuste ? ' com ' + pct(estado.reajuste) : ''), brl(o.anual)],
      estado.fundo ? ['Fundo de reserva (' + pct(estado.fundo) + ')', brl(o.fundo)] : null,
      ['Necessidade total ' + ANO_ORC, brl(o.necessario)],
      ['Taxa média arrecadada hoje', brl(hoje) + '/unidade'],
      ['Diferença vs. hoje', (o.mensalPorUnidade - hoje >= 0 ? '+' : '−') +
        brl(Math.abs(P.arredonda(o.mensalPorUnidade - hoje))) +
        (hoje ? ' (' + pct((o.mensalPorUnidade - hoje) / hoje * 100) + ')' : '')],
      ['Arrecadação anual necessária', brl(P.arredonda(o.necessario))]
    ].filter(Boolean).forEach(function (par) {
      var d = el('div');
      d.appendChild(el('dt', null, par[0]));
      d.appendChild(el('dd', null, par[1]));
      lista.appendChild(d);
    });

    // Média mensal por grupo, ordenada pelo peso, com a cor fixa de cada grupo.
    var ordenadas = o.linhas.slice().sort(function (a, b) { return b.media - a.media; })
      .filter(function (l) { return l.media > 0; });

    desenha('c-orc', {
      type: 'bar',
      data: {
        labels: ordenadas.map(function (l) { return l.grupo.rot; }),
        datasets: [{
          label: 'Média mensal do grupo',
          data: ordenadas.map(function (l) { return l.media; }),
          backgroundColor: ordenadas.map(function (l) { return cor(l.grupo.slot); }),
          maxBarThickness: 20,
          borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: 'left',
          rotularPonta: true,
          notas: ordenadas.map(function (l) {
            return { rot: 'Projeção 12 meses', val: brl(l.projetado) };
          })
        }]
      },
      options: opcoes({
        indexAxis: 'y',
        interaction: { mode: 'nearest', axis: 'y', intersect: false },
        layout: { padding: { right: 96 } },
        scales: {
          x: eixoValor({ beginAtZero: true }),
          y: eixoCategoria({ ticks: { color: tok('ink-2'), font: { size: 11.5 }, padding: 5, autoSkip: false } })
        }
      })
    });

    montaLegenda('l-orc', [{ rot: 'Média mensal por grupo no período filtrado', cor: cor(1) }]);

    montaTabela('t-orc',
      ['Grupo', 'Acumulado no período', 'Média mensal', 'Projeção 12 meses',
        'Projeção ' + ANO_ORC, 'Por unidade/mês'],
      o.linhas.map(function (l) {
        return [{ txt: l.grupo.rot, slot: l.grupo.slot }, num(l.total), num(l.media),
          num(l.anual), num(l.projetado), num(P.arredonda(l.projetado / 12 / PAGANTES))];
      }),
      ['Total', num(P.arredonda(o.linhas.reduce(function (s, l) { return s + l.total; }, 0))),
        num(o.mediaMes), num(P.arredonda(o.mediaMes * 12)), num(o.anual),
        num(P.arredonda(o.anual / 12 / PAGANTES))],
      'Média mensal e projeção anual por grupo de conta');
  }

  // -------------------------------------------------------------- período (UI)

  function montaFiltros() {
    var de = $('f-de'), ate = $('f-ate');
    limpa(de); limpa(ate);
    estado.meses.forEach(function (m, i) {
      de.appendChild(el('option', { value: String(i) }, m.rotuloLongo));
      ate.appendChild(el('option', { value: String(i) }, m.rotuloLongo));
    });
    de.value = String(estado.iDe);
    ate.value = String(estado.iAte);
  }

  function aplicaPreset(valor) {
    var ultimo = estado.meses.length - 1;
    if (valor === 'tudo') { estado.iDe = 0; estado.iAte = ultimo; return; }
    var qtd = Number(valor);
    estado.iAte = ultimo;
    estado.iDe = Math.max(0, ultimo - qtd + 1);
  }

  // ------------------------------------------------------------------ desenho

  function pinta() {
    $('sub-marca').textContent = Base.condominio + ' · ' + TOTAL_UNID +
      ' unidades, ' + PAGANTES + ' pagantes · ' + Base.administradora;

    $('rod-1').textContent = Base.condominio + ' · CNPJ ' + Base.cnpj + ' · ' + Base.endereco;
    $('rod-2').textContent = 'Valores extraídos dos demonstrativos de receitas e despesas da ' +
      Base.administradora + ' · confira sempre com a pasta original.';

    var vazio = estado.meses.length === 0;
    if ($('vazio')) $('vazio').hidden = !vazio;
    if ($('conteudo')) $('conteudo').hidden = vazio;
    if ($('bt-csv')) $('bt-csv').disabled = vazio;
    if ($('bt-tabelas')) $('bt-tabelas').disabled = vazio;
    if ($('bt-print')) $('bt-print').disabled = vazio;

    if (vazio) {
      for (var id in graficos) {
        if (graficos[id]) graficos[id].destroy();
        delete graficos[id];
      }
      pintaFontes();
      return;
    }

    var meses = periodo();
    if (!meses.length) { estado.iDe = 0; estado.iAte = estado.meses.length - 1; meses = periodo(); }
    var r = resumo(meses);

    $('f-nota').textContent = meses.length === estado.meses.length
      ? 'Todos os ' + estado.meses.length + ' meses disponíveis estão no cálculo.'
      : meses.length + ' de ' + estado.meses.length + ' meses no cálculo (' +
        meses[0].rotulo + ' a ' + meses[meses.length - 1].rotulo + ').';

    $('orc-pagantes').textContent = String(PAGANTES);
    document.querySelectorAll('[data-ano-orc]').forEach(function (n) {
      n.textContent = String(ANO_ORC);
    });

    pintaKpis(meses, r);
    pintaFluxo(meses);
    pintaComposicao(meses);
    pintaConcessionarias(meses);
    pintaMaiores(meses);
    pintaInadimplencia(meses);
    pintaOrcamento(meses, r);
    pintaFontes();
  }
