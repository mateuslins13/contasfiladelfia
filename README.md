# Painel de Prestação de Contas · Edifício Filadelfia

Painel local para acompanhar as prestações de contas mensais do **Condomínio do Edifício Residencial Filadelfia** a partir dos PDFs da administradora (relatórios `W015A` e `W073A`).

Mostra a evolução de receitas, despesas e resultado mês a mês, a composição por grupo de conta, o histórico das concessionárias (Cagepa, Energisa e PB Gás), as maiores contas do período, a inadimplência e a projeção orçamentária com simulação de reajuste e fundo de reserva.

Os PDFs são lidos e processados **dentro do seu navegador**. Nenhum dado ou PDF é enviado para o Git ou para a internet.

## Como usar

### Pela web (GitHub Pages)

O painel é compilado e publicado automaticamente no GitHub Pages a cada push na branch `main` (via `.github/workflows/pages.yml`), sem nenhum dado financeiro embutido. Basta abrir a página e clicar em **+ Adicionar PDF** (ou arrastar os arquivos PDF das pastas de prestação de contas). Os arquivos são processados exclusivamente na memória do seu navegador.

### Localmente (com a pasta `prestacao-de-contas/`)

```bash
npm install
npm run build
npm start
```

Abra `http://127.0.0.1:7802`.

1. Coloque os PDFs na pasta `prestacao-de-contas/` (ou use o botão **+ Adicionar PDF**, que grava os arquivos diretamente nessa pasta).
2. Ao abrir o painel (ou clicar em **↻ Reprocessar**), o navegador lê automaticamente todos os PDFs presentes em `prestacao-de-contas/`.

Para acrescentar o mês seguinte, basta colocar o novo PDF em `prestacao-de-contas/` e clicar em **↻ Reprocessar**.

## O que aparece no painel

- **Indicadores do período (KPIs)** — despesa e receita acumuladas, resultado (superávit/déficit), saldo em caixa, custo médio por unidade pagante e inadimplência.
- **Receitas e despesas por mês** — barras comparativas com linha de resultado mensal e tabela detalhada.
- **Composição das despesas** — barras empilhadas pelos 7 grupos do plano de contas (Pessoal, Concessionárias, Operacional, Administrativas, Obras e Reparos, Bens e Equipamentos, Bancárias), com filtro interativo na legenda.
- **Concessionárias** — gráficos individuais em escala própria para Água (Cagepa), Energia (Energisa) e Gás (PB Gás).
- **Maiores contas do período** — ranking horizontal das contas com maior peso acumulado.
- **Inadimplência** — evolução do saldo inadimplente e quantidade de unidades em atraso ao fim de cada mês.
- **Orçamento e previsão anual** — cálculo da taxa mensal sugerida por unidade pagante com simulação de percentual de reajuste e fundo de reserva.
- **CSV e Impressão** — exportação dos dados consolidados para Excel (`.csv`) e layout próprio para impressão.

## Estrutura

```text
server.mjs               servidor local (127.0.0.1): lista a pasta, entrega e recebe PDFs
build.mjs                gera o index.html (interface + bibliotecas, sem dados embutidos)
src/
  template.html          marcação e estilos (tema claro e escuro)
  parser-prestacao.js    extração dos demonstrativos W015A e W073A (roda no Node e no navegador)
  app/                   módulos da interface, gráficos, orçamento e leitura de PDFs
tools/
  extrai.mjs             utilitário de linha de comando para inspecionar os PDFs da pasta
  confere.mjs            verificação automatizada do painel com servidor local
  confere-pdf.mjs        verificação automatizada do upload de PDFs no navegador
prestacao-de-contas/     seus PDFs (ignorada pelo Git)
```

O `index.html` é gerado localmente e também fica fora do Git. Rode `npm run build` depois de clonar ou de alterar qualquer arquivo em `src/`.

## Notas

- O servidor local escuta somente em `127.0.0.1` e não tem autenticação. Não exponha essa porta na rede.
- Ao remover uma prestação pelo painel com o servidor rodando, o PDF vai para `prestacao-de-contas/.lixeira` em vez de ser apagado definitivamente.
