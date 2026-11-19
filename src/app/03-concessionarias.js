  // ----------------------------------------------------------- concessionárias

  var CONTAS = [
    { id: 'c-agua',    campo: 'agua',    rot: 'Água · Cagepa',      slot: 1 },
    { id: 'c-energia', campo: 'energia', rot: 'Energia · Energisa', slot: 2 },
    { id: 'c-gas',     campo: 'gas',     rot: 'Gás · PB Gás',       slot: 3 }
  ];

  function serieConta(meses, campo) {
    return meses.map(function (m) {
      return (m.concessionarias && m.concessionarias[campo]) || 0;
    });
  }

  /**
   * Um gráfico por concessionária, cada um na sua escala. Água, energia e gás
   * ficam em patamares muito diferentes; num eixo comum a variação do gás
   * desapareceria contra a conta de água.
   */
  function pintaConcessionarias(meses) {
    var rot = meses.map(function (m) { return m.rotulo; });

    CONTAS.forEach(function (c) {
      var serie = serieConta(meses, c.campo);
      var media = P.arredonda(serie.reduce(function (a, b) { return a + b; }, 0) / (serie.length || 1));
      var maior = Math.max.apply(null, serie.concat([0]));

      desenha(c.id, {
        type: 'bar',
        data: {
          labels: rot,
          datasets: [{
            label: c.rot, data: serie, backgroundColor: cor(c.slot),
            maxBarThickness: 22, borderRadius: { topLeft: 4, topRight: 4 },
            borderSkipped: 'bottom',
            // Rótulo direto na última coluna: reforça a identidade destas
            // séries claras, que ficam abaixo de 3:1 no tema claro.
            rotularUltima: true,
            notas: meses.map(function (m) {
              return {
                rot: 'Média do período',
                val: brl(media) + (maior === (m.concessionarias || {})[c.campo] ? ' · maior mês' : '')
              };
            })
          }]
        },
        options: opcoes({
          layout: { padding: { top: 24 } },   // folga para o rótulo da última coluna
          scales: { x: eixoCategoria(), y: eixoValor({ beginAtZero: true }) }
        })
      });

      var mini = $('m-' + c.campo);
      if (mini) {
        limpa(mini);
        mini.appendChild(el('span', null, 'Média ' + brl(media) + '/mês'));
        mini.appendChild(el('span', null, 'Total ' + brl(P.arredonda(media * serie.length))));
      }
    });

    var totalMes = meses.map(function (m) {
      var c = m.concessionarias || {};
      return P.arredonda((c.agua || 0) + (c.energia || 0) + (c.gas || 0));
    });
    var somaTotal = P.arredonda(totalMes.reduce(function (a, b) { return a + b; }, 0));

    montaTabela('t-conc',
      ['Concessionária'].concat(rot).concat(['Total', 'Média/mês']),
      CONTAS.map(function (c) {
        var serie = serieConta(meses, c.campo);
        var soma = P.arredonda(serie.reduce(function (a, b) { return a + b; }, 0));
        return [{ txt: c.rot, slot: c.slot }].concat(serie.map(num))
          .concat([num(soma), num(P.arredonda(soma / (serie.length || 1)))]);
      }),
      ['Soma das três'].concat(totalMes.map(num))
        .concat([num(somaTotal), num(P.arredonda(somaTotal / (meses.length || 1)))]),
      'Gasto mensal com água, energia e gás em cada mês do período');
  }

  // ------------------------------------------------------- maiores contas

  /**
   * Ranking horizontal das folhas de despesa. Barras horizontais porque os
   * nomes de conta são longos; na vertical eles virariam texto girado.
   */
  function pintaMaiores(meses) {
    var lista = folhas(meses).slice(0, 12);
    var total = meses.reduce(function (s, m) { return s + (m.totalDespesas || 0); }, 0);

    desenha('c-top', {
      type: 'bar',
      data: {
        labels: lista.map(function (f) { return f.nome; }),
        datasets: [{
          label: 'Acumulado no período',
          data: lista.map(function (f) { return f.total; }),
          backgroundColor: lista.map(function (f) { return cor(f.slot); }),
          maxBarThickness: 18,
          borderRadius: { topRight: 4, bottomRight: 4 }, borderSkipped: 'left',
          rotularPonta: true,
          notas: lista.map(function (f) {
            return { rot: f.grupo + ' · ' + f.meses + (f.meses === 1 ? ' mês' : ' meses'),
              val: pct(total ? f.total / total * 100 : 0) + ' da despesa' };
          })
        }]
      },
      options: opcoes({
        indexAxis: 'y',
        interaction: { mode: 'nearest', axis: 'y', intersect: false },
        // Folga à direita para o valor na ponta da barra não ser cortado.
        layout: { padding: { right: 96 } },
        scales: {
          x: eixoValor({ beginAtZero: true }),
          y: eixoCategoria({
            ticks: {
              color: tok('ink-2'), font: { size: 11.5 }, padding: 5, autoSkip: false,
              callback: function (v) {
                var t = String(this.getLabelForValue(v));
                return t.length > 30 ? t.slice(0, 29) + '…' : t;
              }
            }
          })
        }
      })
    });

    montaTabela('t-top',
      ['Conta', 'Grupo', 'Acumulado', 'Média/mês', 'Meses com lançamento', '% da despesa'],
      lista.map(function (f) {
        return [{ txt: f.nome, slot: f.slot }, f.grupo, num(f.total),
          num(P.arredonda(f.total / (meses.length || 1))), f.meses,
          pct(total ? f.total / total * 100 : 0)];
      }), null,
      'Contas com maior peso no acumulado do período');
  }

  // ------------------------------------------------------------ inadimplência

  function pintaInadimplencia(meses) {
    var rot = meses.map(function (m) { return m.rotulo; });
    var valores = meses.map(function (m) {
      return m.inadimplencia && m.inadimplencia.valor !== null ? m.inadimplencia.valor : null;
    });
    var cSaldo = cor(5);

    desenha('c-inad', {
      type: 'bar',
      data: {
        labels: rot,
        datasets: [{
          label: 'Saldo inadimplente', data: valores, backgroundColor: cSaldo,
          maxBarThickness: 22, borderRadius: { topLeft: 4, topRight: 4 },
          borderSkipped: 'bottom', rotularUltima: true,
          notas: meses.map(function (m) {
            var i = m.inadimplencia;
            if (!i) return null;
            return {
              rot: 'Unidades em atraso',
              val: (i.unidades || 0) + ' de ' + TOTAL_UNID +
                (i.percentual !== null && i.percentual !== undefined ? ' (' + pct(i.percentual) + ')' : '')
            };
          })
        }]
      },
      options: opcoes({
        layout: { padding: { top: 24 } },
        scales: { x: eixoCategoria(), y: eixoValor({ beginAtZero: true }) }
      })
    });

    montaLegenda('l-inad', [{ rot: 'Saldo inadimplente ao fim do mês', cor: cSaldo }]);

    montaTabela('t-inad',
      ['Mês', 'Saldo inadimplente', 'Unidades em atraso', '% das unidades', 'Boletos'],
      meses.map(function (m) {
        var i = m.inadimplencia || {};
        return [m.rotuloLongo, num(i.valor), i.unidades === null || i.unidades === undefined ? '—' : i.unidades,
          i.percentual === null || i.percentual === undefined ? '—' : pct(i.percentual),
          i.boletos === null || i.boletos === undefined ? '—' : i.boletos];
      }), null,
      'Saldo inadimplente e unidades em atraso por mês');
  }
