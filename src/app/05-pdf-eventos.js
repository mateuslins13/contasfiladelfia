  // ------------------------------------------------------ lista de fontes/PDFs

  function pintaFontes() {
    var ul = $('lista-pdf');
    limpa(ul);
    estado.meses.forEach(function (m) {
      var li = el('li');
      li.appendChild(el('span', { class: 'mes' }, m.rotuloLongo));
      li.appendChild(el('span', { class: 'arq' }, m.arquivo || 'PDF sem nome'));
      if (m.novo) li.appendChild(el('span', { class: 'marca-nova' }, 'adicionado aqui'));
      li.appendChild(el('span', { class: 'val-mes' },
        'desp. ' + brl(m.totalDespesas) + ' · rec. ' + brl(m.totalReceitas)));
      var btnRm = el('button', {
        type: 'button',
        class: 'btn-rm',
        'data-rm-mes': m.ano + '-' + m.mes,
        'data-rm-arq': m.arquivo || '',
        'data-rm-origem': m.origem || (m.novo ? 'manual' : 'pasta'),
        title: m.origem === 'pasta'
          ? 'Mover para a lixeira da pasta prestacao-de-contas/'
          : 'Remover da análise'
      }, m.origem === 'pasta' ? 'remover' : 'tirar');
      li.appendChild(btnRm);
      ul.appendChild(li);
    });

    $('fontes-cont').textContent = estado.meses.length +
      (estado.meses.length === 1 ? ' mês carregado' : ' meses carregados') +
      (estado.extras.length ? ' · ' + estado.extras.length + ' neste navegador' : '');
    $('bt-limpar').hidden = !estado.extras.length;

    if ($('pasta-info')) {
      $('pasta-info').textContent = estado.temServidor
        ? '(' + estado.pastaLabel + ')'
        : '(modo navegador — sem servidor local)';
    }
    if ($('vazio-pasta')) {
      $('vazio-pasta').textContent = estado.pastaLabel || 'prestacao-de-contas/';
    }
  }

  function avisa(txt, erro) {
    var s = $('situacao');
    s.textContent = txt || '';
    s.style.color = erro ? tok('critico') : '';
  }

  function atualizaBotoesProcessamento() {
    if ($('bt-reload')) $('bt-reload').disabled = estado.processando;
    if ($('bt-reprocessar')) $('bt-reprocessar').disabled = estado.processando;
    if ($('bt-add')) $('bt-add').disabled = estado.processando;
  }

  // ---------------------------------------------------------------- leitura PDF

  var pdfjsPronto = false;

  /**
   * O worker do pdf.js vem embutido em base64 e é registrado como blob, para o
   * painel funcionar como arquivo único, inclusive aberto direto do disco.
   */
  function preparaPdfjs() {
    if (pdfjsPronto) return true;
    var lib = window.pdfjsLib;
    if (!lib) return false;
    if (window.__PDF_WORKER_B64__ && window.__PDF_WORKER_B64__.indexOf('__') !== 0) {
      try {
        var bin = atob(window.__PDF_WORKER_B64__);
        var buf = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        var url = URL.createObjectURL(new Blob([buf], { type: 'text/javascript' }));
        lib.GlobalWorkerOptions.workerSrc = url;
      } catch (e) {
        // Sem worker o pdf.js ainda lê, só mais devagar, na thread principal.
        lib.GlobalWorkerOptions.workerSrc = '';
      }
    }
    pdfjsPronto = true;
    return true;
  }

  /**
   * Sincroniza com a pasta prestacao-de-contas/ via servidor local (server.mjs).
   * Usa cache por assinatura (nome:tamanho:mtime) no localStorage para não
   * precisar reler dezenas de megabytes a cada F5, exceto quando o usuário
   * pede explicitamente para reprocessar.
   */
  async function sincronizarPasta(forcarReleitura) {
    if (estado.processando) return false;
    if (location.protocol === 'file:' || /\.github\.io$/i.test(location.hostname)) {
      estado.temServidor = false;
      return false;
    }
    var data;
    try {
      var r = await fetch('api/prestacoes', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      data = await r.json();
    } catch (e) {
      estado.temServidor = false;
      return false;
    }

    estado.temServidor = true;
    estado.pastaLabel = data.pasta || 'prestacao-de-contas/';
    var arquivos = Array.isArray(data.arquivos) ? data.arquivos : [];

    if (!arquivos.length) {
      estado.daPasta = [];
      salvaCachePasta({});
      consolida();
      estado.iDe = 0;
      estado.iAte = Math.max(0, estado.meses.length - 1);
      montaFiltros();
      pinta();
      avisa('A pasta prestacao-de-contas/ está vazia. Coloque os PDFs nela ou clique em "+ Adicionar PDF".');
      return true;
    }

    if (!preparaPdfjs()) {
      avisa('O leitor de PDF não carregou nesta página.', true);
      return true;
    }

    estado.processando = true;
    atualizaBotoesProcessamento();

    var cacheAntigo = forcarReleitura ? {} : carregaCachePasta();
    var cacheNovo = {};
    var lidos = [];
    var falhas = [];
    var lidosDoDisco = 0;

    for (var i = 0; i < arquivos.length; i++) {
      var arq = arquivos[i];
      var sig = arq.nome + ':' + arq.tamanho + ':' + arq.mtime;
      if (cacheAntigo[sig] && cacheAntigo[sig].mes) {
        var cached = cacheAntigo[sig];
        cached.arquivo = arq.nome;
        cached.bytes = arq.tamanho;
        cached.origem = 'pasta';
        delete cached.novo;
        cacheNovo[sig] = cached;
        lidos.push(cached);
        continue;
      }

      avisa('Lendo da pasta: ' + arq.nome + ' (' + (i + 1) + ' de ' + arquivos.length + ')…');
      await new Promise(function (resolve) { setTimeout(resolve, 0); });

      try {
        var resp = await fetch('api/pdf?nome=' + encodeURIComponent(arq.nome), { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        var buf = new Uint8Array(await resp.arrayBuffer());
        var res = await window.ParserPrestacao.lePdf(window.pdfjsLib, buf, { maxPaginas: 40 });
        if (!res || !res.mes) {
          falhas.push(arq.nome + ': demonstrativo (W015A) não localizado');
          continue;
        }
        res.arquivo = arq.nome;
        res.bytes = arq.tamanho;
        res.origem = 'pasta';
        cacheNovo[sig] = res;
        lidos.push(res);
        lidosDoDisco++;
      } catch (err) {
        falhas.push(arq.nome + ': ' + (err && err.message ? err.message : 'falha na leitura'));
      }
    }

    salvaCachePasta(cacheNovo);
    estado.daPasta = lidos;
    estado.processando = false;
    atualizaBotoesProcessamento();

    consolida();
    estado.iDe = 0;
    estado.iAte = Math.max(0, estado.meses.length - 1);
    montaFiltros();
    pinta();

    if (falhas.length) {
      avisa(lidos.length + ' mês(es) carregado(s) da pasta. Avisos: ' + falhas.join('; '), !lidos.length);
    } else if (lidosDoDisco > 0 || forcarReleitura) {
      avisa(lidos.length + (lidos.length === 1
        ? ' prestação carregada da pasta prestacao-de-contas/.'
        : ' prestações carregadas da pasta prestacao-de-contas/.'));
    } else {
      avisa('');
    }
    return true;
  }

  async function processaArquivos(arquivos) {
    var lista = Array.from(arquivos || []).filter(function (f) {
      return /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
    });
    if (!lista.length) { avisa('Nenhum PDF reconhecido nos arquivos selecionados.', true); return; }

    // Com servidor local rodando: grava os PDFs direto em prestacao-de-contas/.
    if (estado.temServidor) {
      estado.processando = true;
      atualizaBotoesProcessamento();
      avisa('Salvando ' + lista.length + ' arquivo(s) em prestacao-de-contas/…');
      var errosUpload = [];
      for (var u = 0; u < lista.length; u++) {
        var arqUp = lista[u];
        try {
          var r = await fetch('api/upload?nome=' + encodeURIComponent(arqUp.name), {
            method: 'POST',
            headers: { 'Content-Type': 'application/pdf' },
            body: await arqUp.arrayBuffer()
          });
          if (!r.ok) {
            var j = await r.json().catch(function () { return {}; });
            errosUpload.push(arqUp.name + ': ' + (j.erro || ('HTTP ' + r.status)));
          }
        } catch (errUp) {
          errosUpload.push(arqUp.name + ': ' + errUp.message);
        }
      }
      estado.processando = false;
      atualizaBotoesProcessamento();
      await sincronizarPasta(false);
      if (errosUpload.length) {
        avisa('Alguns arquivos não puderam ser salvos: ' + errosUpload.join('; '), true);
      }
      return;
    }

    if (!preparaPdfjs()) { avisa('O leitor de PDF não carregou nesta página.', true); return; }

    estado.processando = true;
    atualizaBotoesProcessamento();

    var novos = 0, falhas = [];
    for (var i = 0; i < lista.length; i++) {
      var f = lista[i];
      avisa('Lendo ' + f.name + ' (' + (i + 1) + ' de ' + lista.length + ')…');
      try {
        var buf = new Uint8Array(await f.arrayBuffer());
        var res = await window.ParserPrestacao.lePdf(window.pdfjsLib, buf, { maxPaginas: 40 });
        if (!res || !res.mes) { falhas.push(f.name + ': demonstrativo não localizado'); continue; }
        res.arquivo = f.name;
        res.bytes = f.size;
        res.novo = true;
        res.origem = 'manual';
        estado.extras = estado.extras.filter(function (m) {
          return !(m.ano === res.ano && m.mes === res.mes);
        });
        estado.extras.push(res);
        novos++;
      } catch (e) {
        falhas.push(f.name + ': ' + (e && e.message ? e.message : 'falha na leitura'));
      }
    }

    estado.processando = false;
    atualizaBotoesProcessamento();

    if (novos) {
      salvaExtras();
      var antes = estado.meses.length;
      consolida();
      if (antes === 0) {
        estado.iDe = 0;
        estado.iAte = estado.meses.length - 1;
      } else if (estado.iAte >= antes - 1) {
        estado.iAte = estado.meses.length - 1;
      }
      montaFiltros();
      $('f-de').value = String(estado.iDe);
      $('f-ate').value = String(estado.iAte);
      pinta();
    }

    avisa(novos
      ? novos + (novos === 1 ? ' prestação lida e somada ao painel.' : ' prestações lidas e somadas ao painel.') +
        (falhas.length ? ' Falhas: ' + falhas.join('; ') : '')
      : 'Nada foi somado. ' + falhas.join('; '), !novos);
  }

  async function removerItem(arquivo, chaveMes, origem) {
    if (origem === 'pasta' && estado.temServidor) {
      if (!confirm('Mover "' + arquivo + '" para a lixeira da pasta?\n\nO arquivo não é apagado: ele vai para prestacao-de-contas/.lixeira e pode ser restaurado à mão.')) {
        return;
      }
      try {
        var r = await fetch('api/pdf?nome=' + encodeURIComponent(arquivo), { method: 'DELETE' });
        if (!r.ok) {
          var j = await r.json().catch(function () { return {}; });
          avisa('Não foi possível remover: ' + (j.erro || ('HTTP ' + r.status)), true);
          return;
        }
      } catch (e) {
        avisa('Não foi possível remover: ' + e.message, true);
        return;
      }
      await sincronizarPasta(false);
      avisa('"' + arquivo + '" foi movido para prestacao-de-contas/.lixeira.');
      return;
    }

    estado.extras = estado.extras.filter(function (m) {
      return (m.ano + '-' + m.mes) !== chaveMes;
    });
    salvaExtras();
    consolida();
    estado.iDe = 0;
    estado.iAte = Math.max(0, estado.meses.length - 1);
    montaFiltros();
    pinta();
    avisa('"' + (arquivo || chaveMes) + '" saiu da análise.');
  }

  async function reprocessar() {
    if (estado.processando) return;
    var ok = await sincronizarPasta(true);
    if (!ok) {
      consolida();
      montaFiltros();
      pinta();
      avisa(estado.meses.length
        ? 'Painel atualizado com os PDFs carregados neste navegador.'
        : 'Sem servidor local — use "+ Adicionar PDF" ou rode "npm start" para ler a pasta prestacao-de-contas/.');
    }
  }

  // ------------------------------------------------------------------------ CSV

  function baixaCsv() {
    var meses = periodo();
    if (!meses.length) return;
    var sep = ';';
    var linhas = [['Mês', 'Arquivo', 'Receitas', 'Despesas', 'Resultado',
      'Saldo inicial', 'Saldo final', 'Taxa de condomínio', 'Taxa extra',
      'Água (Cagepa)', 'Energia (Energisa)', 'Gás (PB Gás)', 'Inadimplência',
      'Unidades em atraso'].concat(GRUPOS.map(function (g) { return g.rot; }))];

    meses.forEach(function (m) {
      var c = m.concessionarias || {};
      var i = m.inadimplencia || {};
      linhas.push([m.rotuloLongo, m.arquivo || '', m.totalReceitas, m.totalDespesas,
        m.resultado, m.saldoInicial, m.saldoFinal, m.taxaCondominio, m.taxaExtra,
        c.agua || 0, c.energia || 0, c.gas || 0,
        i.valor === null || i.valor === undefined ? '' : i.valor,
        i.unidades === null || i.unidades === undefined ? '' : i.unidades]
        .concat(GRUPOS.map(function (g) { return valorGrupo(m, g.nome); })));
    });

    var texto = linhas.map(function (l) {
      return l.map(function (v) {
        if (typeof v === 'number') return String(v).replace('.', ',');
        return /[";\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
      }).join(sep);
    }).join('\r\n');

    // BOM para o Excel em pt-BR abrir com acento correto.
    var blob = new Blob(['\uFEFF' + texto], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: 'prestacao-filadelfia-' + Base.anoBase + '.csv' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // -------------------------------------------------------------------- eventos

  function alternaTabelas(ligado) {
    estado.tabelas = ligado;
    document.querySelectorAll('.tab-area').forEach(function (a) { a.hidden = !ligado; });
    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.setAttribute('aria-expanded', String(ligado));
      b.textContent = ligado ? 'Ocultar tabela' : 'Tabela';
    });
    var bt = $('bt-tabelas');
    bt.setAttribute('aria-pressed', String(ligado));
    bt.textContent = ligado ? '▦ Ocultar tabelas' : '▦ Mostrar tabelas';
  }

  function ligaEventos() {
    $('f-de').addEventListener('change', function (e) {
      estado.iDe = Number(e.target.value);
      if (estado.iDe > estado.iAte) { estado.iAte = estado.iDe; $('f-ate').value = String(estado.iAte); }
      pinta();
    });
    $('f-ate').addEventListener('change', function (e) {
      estado.iAte = Number(e.target.value);
      if (estado.iAte < estado.iDe) { estado.iDe = estado.iAte; $('f-de').value = String(estado.iDe); }
      pinta();
    });
    $('f-preset').addEventListener('change', function (e) {
      aplicaPreset(e.target.value);
      $('f-de').value = String(estado.iDe);
      $('f-ate').value = String(estado.iAte);
      pinta();
    });

    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        var area = $(b.getAttribute('data-tab'));
        var abrir = area.hidden;
        area.hidden = !abrir;
        b.setAttribute('aria-expanded', String(abrir));
        b.textContent = abrir ? 'Ocultar tabela' : 'Tabela';
      });
    });

    $('bt-tabelas').addEventListener('click', function () { alternaTabelas(!estado.tabelas); });

    $('bt-tema').addEventListener('click', function () {
      var claroAgora = document.documentElement.getAttribute('data-theme') === 'light' ||
        (!document.documentElement.getAttribute('data-theme') &&
          !window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.setAttribute('data-theme', claroAgora ? 'dark' : 'light');
      try { localStorage.setItem('filadelfia:tema', claroAgora ? 'dark' : 'light'); } catch (e) {}
      pinta();   // os gráficos leem os tokens de cor no momento do desenho
    });

    $('bt-csv').addEventListener('click', baixaCsv);
    $('bt-print').addEventListener('click', function () { window.print(); });
    if ($('bt-reload')) $('bt-reload').addEventListener('click', reprocessar);
    if ($('bt-reprocessar')) $('bt-reprocessar').addEventListener('click', reprocessar);

    ['orc-reajuste', 'orc-fundo'].forEach(function (id) {
      $(id).addEventListener('input', function (e) {
        var v = Number(e.target.value);
        estado[id === 'orc-reajuste' ? 'reajuste' : 'fundo'] = isFinite(v) ? v : 0;
        if (estado.meses.length) pintaOrcamento(periodo(), resumo(periodo()));
      });
    });

    $('bt-add').addEventListener('click', function () { $('in-pdf').click(); });
    $('in-pdf').addEventListener('change', function (e) {
      processaArquivos(e.target.files);
      e.target.value = '';
    });

    $('lista-pdf').addEventListener('click', function (e) {
      var bt = e.target.closest('[data-rm-mes]');
      if (!bt) return;
      removerItem(
        bt.getAttribute('data-rm-arq'),
        bt.getAttribute('data-rm-mes'),
        bt.getAttribute('data-rm-origem')
      );
    });

    $('bt-limpar').addEventListener('click', function () {
      estado.extras = [];
      salvaExtras();
      consolida();
      estado.iDe = 0;
      estado.iAte = Math.max(0, estado.meses.length - 1);
      montaFiltros();
      pinta();
      avisa('Os PDFs adicionados neste navegador foram removidos.');
    });

    // Soltar o PDF em qualquer ponto da página.
    var area = $('fontes');
    ['dragenter', 'dragover'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        e.preventDefault();
        area.classList.add('sobre');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      document.addEventListener(ev, function (e) {
        e.preventDefault();
        if (ev === 'dragleave' && e.relatedTarget) return;
        area.classList.remove('sobre');
      });
    });
    document.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        processaArquivos(e.dataTransfer.files);
      }
    });

    // Redesenha quando o tema do sistema muda, para os tokens acompanharem.
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', function () {
      if (!document.documentElement.getAttribute('data-theme')) pinta();
    });

    window.addEventListener('beforeprint', function () {
      if (estado.meses.length) alternaTabelas(true);
    });
  }

  // --------------------------------------------------------------------- início

  async function inicia() {
    try {
      var tema = localStorage.getItem('filadelfia:tema');
      if (tema) document.documentElement.setAttribute('data-theme', tema);
    } catch (e) { /* navegador sem storage: fica no tema do sistema */ }

    ligaEventos();

    estado.extras = carregaExtras();
    consolida();
    estado.iDe = 0;
    estado.iAte = Math.max(0, estado.meses.length - 1);
    montaFiltros();
    pinta();

    var comServidor = await sincronizarPasta(false);
    if (!comServidor && !estado.meses.length) {
      if (location.protocol === 'file:') {
        avisa('Aberto como arquivo local: use "+ Adicionar PDF" ou rode "npm start" para ler a pasta prestacao-de-contas/.');
      } else {
        avisa('Processamento 100% local no navegador — clique em "+ Adicionar PDF" ou arraste os arquivos para começar.');
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicia);
  } else {
    inicia();
  }
})();
