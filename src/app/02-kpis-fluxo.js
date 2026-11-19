  // ---------------------------------------------------------------- stat tiles

  function pintaKpis(meses, r) {
    var alvo = $('kpis');
    limpa(alvo);

    // Comparação com o mês anterior ao do fim do período, quando existe.
    var ant = estado.iAte > 0 ? estado.meses[estado.iAte - 1] : null;
    var ult = r.ultimo;

    function tile(rot, val, sub, delta) {
      var d = el('div', { class: 'tile' });
      d.appendChild(el('div', { class: 'rot' }, rot));
      d.appendChild(el('div', { class: 'val' }, val));
      if (sub) d.appendChild(el('div', { class: 'sub' }, sub));
      if (delta) {
        var linha = el('div', { class: 'delta ' + (delta.bom ? 'up' : 'down') });
        linha.appendChild(el('span', { 'aria-hidden': 'true' }, delta.bom ? '▲' : '▼'));
        linha.appendChild(el('span', null, delta.txt));
        d.appendChild(linha);
      }
      alvo.appendChild(d);
    }

    tile('Despesa no período', brl(r.despesas),
      r.n + (r.n === 1 ? ' mês' : ' meses') + ' · média ' + brl(r.mediaDespesa));
    tile('Receita no período', brl(r.receitas),
      'Taxas ' + brl(r.mediaTaxa) + '/mês' +
      (r.mediaExtra ? ' + extra ' + brl(r.mediaExtra) : ''));
    tile('Resultado acumulado', brl(r.resultado),
      r.mesesPositivos + ' de ' + r.n + (r.n === 1 ? ' mês positivo' : ' meses positivos'),
      { bom: r.resultado >= 0, txt: r.resultado >= 0 ? 'Superávit' : 'Déficit' });
    tile('Saldo em caixa', brl(r.saldoFinal),
      ult ? 'Fechamento de ' + ult.rotuloLongo : '');
    tile('Custo médio por unidade', brl(r.custoPorUnidade),
      'Despesa média ÷ ' + PAGANTES + ' pagantes');

    if (ant && ult && ant.totalDespesas) {
      var v = (ult.totalDespesas - ant.totalDespesas) / ant.totalDespesas * 100;
      tile('Despesa de ' + ult.rotulo, brl(ult.totalDespesas), 'Último mês do período',
        { bom: v <= 0, txt: pct(v) + ' vs ' + ant.rotulo });
    }
    if (r.inadUltima && r.inadUltima.inadimplencia) {
      var ina = r.inadUltima.inadimplencia;
      tile('Inadimplência', brl(ina.valor),
        (ina.unidades || 0) + (ina.unidades === 1 ? ' unidade' : ' unidades') +
        ' em atraso · ' + r.inadUltima.rotulo);
    }
  }

  // ------------------------------------------------- receitas, despesas, saldo

  function pintaFluxo(meses) {
    var rot = meses.map(function (m) { return m.rotulo; });
    var cReceita = cor(1), cDespesa = cor(2), cLinha = cor(7);

    desenha('c-fluxo', {
      type: 'bar',
      data: {
        labels: rot,
        datasets: [
          {
            label: 'Receitas', backgroundColor: cReceita, maxBarThickness: 22,
            borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom',
            data: meses.map(function (m) { return m.totalReceitas; }), order: 2
          },
          {
            label: 'Despesas', backgroundColor: cDespesa, maxBarThickness: 22,
            borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom',
            data: meses.map(function (m) { return m.totalDespesas; }), order: 2
          },
          {
            label: 'Resultado do mês', type: 'line', borderColor: cLinha,
            backgroundColor: cLinha, borderWidth: 2, tension: .25,
            pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: cLinha,
            pointBorderColor: tok('surface'), pointBorderWidth: 2,
            data: meses.map(function (m) { return m.resultado; }), order: 1
          }
        ]
      },
      options: opcoes({
        // Um eixo só: receita, despesa e resultado estão todos em reais.
        scales: { x: eixoCategoria(), y: eixoValor({ beginAtZero: true }) }
      })
    });

    montaLegenda('l-fluxo', [
      { rot: 'Receitas', cor: cReceita },
      { rot: 'Despesas', cor: cDespesa },
      { rot: 'Resultado do mês', cor: cLinha, linha: true }
    ]);

    function somaDe(campo) {
      return P.arredonda(meses.reduce(function (s, m) { return s + (m[campo] || 0); }, 0));
    }
    montaTabela('t-fluxo',
      ['Mês', 'Receitas', 'Despesas', 'Resultado', 'Saldo final'],
      meses.map(function (m) {
        return [m.rotuloLongo, num(m.totalReceitas), num(m.totalDespesas),
          num(m.resultado), num(m.saldoFinal)];
      }),
      ['Total', num(somaDe('totalReceitas')), num(somaDe('totalDespesas')),
        num(somaDe('resultado')), ''],
      'Receitas, despesas e resultado de cada mês do período');
  }

  // ------------------------------------------------------ composição por grupo

  function pintaComposicao(meses) {
    var rot = meses.map(function (m) { return m.rotulo; });
    var visiveis = GRUPOS.filter(function (g) { return !estado.oculto[g.nome]; });

    desenha('c-comp', {
      type: 'bar',
      data: {
        labels: rot,
        datasets: visiveis.map(function (g) {
          return {
            label: g.rot,
            backgroundColor: cor(g.slot),
            data: meses.map(function (m) { return valorGrupo(m, g.nome); }),
            somavel: true,          // pilha do mesmo eixo: o total faz sentido
            maxBarThickness: 30,
            // Gap de 2px na cor da superfície separando as fatias da pilha.
            borderColor: tok('surface'), borderWidth: { top: GAP },
            borderRadius: raioDoTopo, borderSkipped: false
          };
        })
      },
      options: opcoes({
        scales: {
          x: eixoCategoria({ stacked: true }),
          y: eixoValor({ stacked: true, beginAtZero: true })
        }
      })
    });

    // A legenda lista sempre os sete grupos: a cor é fixa por nome, então
    // desligar um não repinta os que ficam.
    montaLegenda('l-comp', GRUPOS.map(function (g) {
      return { rot: g.rot, cor: cor(g.slot), on: !estado.oculto[g.nome], nome: g.nome };
    }), function (item) {
      estado.oculto[item.nome] = !estado.oculto[item.nome];
      pintaComposicao(periodo());
    });

    var somas = porGrupo(meses);
    var total = somas.reduce(function (s, x) { return s + x.total; }, 0);
    montaTabela('t-comp',
      ['Grupo'].concat(rot).concat(['Total', 'Média/mês', '% do total']),
      somas.map(function (x) {
        return [{ txt: x.grupo.rot, slot: x.grupo.slot }]
          .concat(meses.map(function (m) { return num(valorGrupo(m, x.grupo.nome)); }))
          .concat([num(x.total), num(P.arredonda(x.total / (meses.length || 1))),
            pct(total ? x.total / total * 100 : 0)]);
      }),
      ['Total'].concat(meses.map(function (m) { return num(m.totalDespesas); }))
        .concat([num(P.arredonda(total)), num(P.arredonda(total / (meses.length || 1))), '100%']),
      'Despesas por grupo de conta em cada mês do período');
  }
