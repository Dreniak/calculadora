# PRD — Calculadora Judicial de Pensão Alimentícia

| | |
|---|---|
| **Produto** | Calculadora Judicial de Pensão Alimentícia (Execução de Alimentos) |
| **Versão do documento** | 1.0 |
| **Data** | 12/06/2026 |
| **Status** | Aprovado para desenvolvimento |
| **Plataforma alvo** | Desktop Windows (instalação por máquina) |
| **Stack** | Tauri (frontend web reaproveitado do protótipo + backend Rust) |

---

## 1. Resumo executivo

Ferramenta de desktop dedicada ao cálculo de débito de pensão alimentícia em execução, cobrindo os ritos da **prisão** (CPC, art. 528) e da **expropriação/penhora** (CPC, art. 523) numa única sessão. Aplica correção monetária e juros conforme a Lei nº 14.905/2024, mantém base própria de índices e salário mínimo atualizada automaticamente, persiste cada cálculo como arquivo navegável e gera PDFs no padrão do demonstrativo do TJTO. Nasce preparada para integração futura com extensão do e-Proc.

O protótipo HTML existente (`calculadora-pensao-alimenticia.html`) valida o motor de cálculo e serve de referência de interface; o produto final será implementado em Tauri, fora do escopo de geração automática.

---

## 2. Problema e motivação

O cálculo de alimentos hoje é feito em planilha ou em calculadoras genéricas (Juriscalc/TJDFT, Cálculo Geral/TJTO) que não tratam particularidades do débito alimentar: coexistência de dois ritos no mesmo processo, imputação de pagamentos dentro e fora do período, e a necessidade de gerar peças separadas por rito sem redigitar os dados do processo. O trabalho é repetitivo, suscetível a erro e sem trilha de reaproveitamento.

---

## 3. Objetivos e métricas de sucesso

**Objetivos**
1. Calcular o débito por um ou ambos os ritos numa única sessão, com dados do processo digitados uma só vez.
2. Eliminar a busca manual de índices, mantendo base própria atualizada automaticamente.
3. Produzir PDFs padronizados, salvos automaticamente em pasta, prontos para juntada.
4. Constituir uma biblioteca de cálculos reutilizável e compartilhável por rede.

**Métricas de sucesso**
- Cálculo de um processo com dois ritos concluído sem redigitação de dados do processo.
- Resultado conferível contra o demonstrativo do TJTO (diferença apenas por arredondamento de casas dos índices).
- PDF gerado e salvo sem diálogo de impressão.
- Funcionamento offline com a base semeada; atualização automática quando há internet.

---

## 4. Personas e usuários

- **Servidor de cartório / vara de família (usuário primário):** elabora o cálculo, confere índices, gera o PDF e arquiva.
- **Equipe da vara (usuários secundários):** consultam e reaproveitam cálculos pela biblioteca, possivelmente em pasta de rede compartilhada.
- Não há autenticação/login. Controle de acesso é o do próprio sistema operacional/rede.

---

## 5. Escopo

### 5.1. Dentro do escopo (v1.0)
- Cálculo por rito da prisão e/ou expropriação, inferido dos valores devidos.
- Cadastro de valores devidos (mês único ou período) por valor fixo ou % do salário mínimo, com rito por lançamento.
- Cadastro de pagamentos (data específica ou mensal fixo por período), com soma automática por mês e imputação dentro/fora do período.
- Edição inline de valores no resultado, com desfazer/restaurar.
- Consectários legais (somente expropriação): multa por descumprimento, honorários, multa e honorários do art. 523.
- Base local de índices e salário mínimo desde 2000, com atualização automática (IBGE/Bacen).
- Biblioteca lateral de cálculos persistidos como `.json` em pasta configurável.
- Geração de PDF por rito, salva em pasta configurável.
- Porta de entrada padronizada para preenchimento externo (preparação para a extensão).

### 5.2. Fora do escopo (v1.0)
- A extensão de navegador do e-Proc (será especificada e construída depois).
- Multiusuário transacional/servidor central (a biblioteca é por pasta, ainda que em rede).
- Login/autenticação.
- Cálculos diversos de alimentos (custas, astreintes complexas) além do previsto neste PRD.

---

## 6. Requisitos funcionais

### RF-1 — Parâmetros do processo e do cálculo
- Campos do processo: nº do processo, órgão julgador/vara, requerente, requerido (todos texto).
- Não há seletor de rito nos parâmetros; o(s) rito(s) decorre(m) dos valores devidos cadastrados (RF-2).
- Data-base (mês/ano até onde se atualiza).
- Juros: legais (padrão), percentual fixo mensal, ou sem juros. Termo inicial dos juros é sempre a data de cada parcela.
- Consectários (multa por descumprimento %, honorários %, multa 10% art. 523, honorários 10% art. 523) só são exibidos/aplicados quando existir valor devido pelo rito da expropriação.
- Campo de observações que consta no PDF.

### RF-2 — Valores devidos
- Cada valor devido pertence a um rito (prisão ou expropriação).
- Período por dois campos: **De** (obrigatório) e **Até** (opcional). Só De = mês único; De+Até = parcela mensal repetida no intervalo (inclusive). Não há seletor de "mês único/período".
- Forma do valor: valor fixo (R$) ou % do salário mínimo (resolvido pela vigência de cada mês).
- Descrição opcional.
- Lista editável e excluível; cada item exibe rito, competência(s), valor, forma e descrição.

### RF-3 — Pagamentos
- Lançamento por data específica ou mensal fixo por período (De/Até).
- Pagamentos do mesmo mês são somados automaticamente.
- Imputação: dentro do período do débito abate a parcela do próprio mês; fora do período é corrigido e deduzido do total. Quando houver os dois ritos, pagamento fora do período é imputado preferencialmente à expropriação; imputação manual disponível.
- Lista editável e excluível.

### RF-4 — Base de índices e salário mínimo
- Base local desde 01/2000: correção (INPC até 08/2024, IPCA a partir de 09/2024), Taxa Legal mensal (a partir de 08/2024) e vigências de salário mínimo.
- Todos os valores editáveis; cada índice marcado como **oficial** ou **estimado/pendente**, com origem e data.
- Atualização automática quando houver internet (RNF-3), sem sobrescrever valores oficiais sem registro.

### RF-5 — Demonstrativo (resultado)
- Para cada rito, Tabela I (parcelas), Tabela II (pagamentos fora do intervalo) e totalização.
- Colunas **Valor Devido** e **Valor Pago** editáveis inline como camada de override sobre o apurado nos RF-2/RF-3; linhas alteradas recebem marca visual.
- Controles **Desfazer** (última alteração) e **Restaurar** (linha ou tabela ao valor calculado).
- Overrides persistidos no cálculo salvo e refletidos no PDF.
- Quando houver dois ritos, a ordem de apresentação (e de geração dos PDFs) é cronológica: rito de termo inicial mais antigo primeiro.

### RF-6 — Geração de PDF
- Gravação direta na pasta de PDFs configurada, sem diálogo de impressão.
- Nome do arquivo: `{número do processo} - {ID}`; com dois ritos, acrescenta sufixo do rito. Fallback quando o processo estiver vazio: `{requerente} - {ID}` ou `{ID}`.
- Layout espelha o demonstrativo do TJTO: cabeçalho do processo, Tabela I, Tabela II, totalização (Seção 8), notas explicativas e rodapé com data.

### RF-7 — Biblioteca de cálculos
- Painel lateral esquerdo lista cada cálculo salvo com: **Processo**, **Requerente × Requerido**, **Tag(s) de rito**.
- Ações: abrir, duplicar, excluir. Busca por processo e por parte.
- Cada cálculo é um arquivo `.json` independente na pasta configurada; a lista é a leitura dessa pasta.

### RF-8 — Salvar / carregar
- Salvar grava o cálculo completo (processo, parâmetros, valores devidos, pagamentos, overrides e índices editados) como `.json` identificado por **UUID**.
- Carregar reabre qualquer `.json` válido.
- Novo cálculo limpa a sessão.

### RF-9 — Porta de entrada padronizada (preparação para extensão)
- O app aceita um payload padronizado `{processo, orgao, requerente, requerido}` por um único ponto de entrada, usado tanto por carregamento manual quanto, no futuro, pela extensão via serviço HTTP local.
- Ao receber, traz a janela ao primeiro plano com os campos preenchidos.

---

## 7. Requisitos não funcionais

- **RNF-1 — Plataforma:** Windows, instalável por máquina (`.msi`/`.exe`). Binário enxuto (Tauri).
- **RNF-2 — Offline-first:** funciona sem internet com a base semeada; conectividade é melhoria, não dependência.
- **RNF-3 — Atualização de dados:** ao haver internet, busca meses faltantes de IBGE/Bacen; falha de rede não interrompe o uso.
- **RNF-4 — Concorrência em rede:** como a pasta de cálculos pode estar em compartilhamento de rede, cada cálculo é um arquivo `.json` separado, evitando corrupção por múltiplos gravadores. A base de índices é local por máquina.
- **RNF-5 — Precisão:** valores monetários em reais com 2 casas; fatores de correção com 7 casas; percentuais de juros com a precisão das fontes. Resultado conferível contra o TJTO.
- **RNF-6 — Acessibilidade/UX:** responsivo na janela, foco de teclado visível, sem dependência de diálogos do navegador para salvar.

---

## 8. Motor de cálculo (especificação)

### 8.1. Correção monetária
INPC/IBGE até 08/2024; IPCA/IBGE a partir de 09/2024 (Lei nº 14.905/2024). Fator aplicado do mês da competência da parcela (inclusive) até o mês anterior à data-base.

### 8.2. Juros de mora (legais)
0,5% a.m. até 10/01/2003; 1% a.m. de 11/01/2003 a 29/08/2024; Taxa Legal (art. 406 do CC, Res. CMN nº 5.171/2024) a partir de 30/08/2024. Regime simples (soma de percentuais). Termo inicial: data de cada parcela. Alternativas: percentual fixo mensal ou sem juros.

### 8.3. Pagamentos
Somados por mês. Dentro do período do débito abatem a parcela do próprio mês; fora do período são corrigidos e deduzidos do total (imputação preferencial à expropriação havendo dois ritos).

### 8.4. Cascata de totalização — rito da expropriação
1. **Subtotal 01** = total das parcelas (Tabela I).
2. + Multa por descumprimento (% × Subtotal 01) → **Subtotal 02**.
3. + Honorários advocatícios (% × Subtotal 02) → **Subtotal 03**.
4. + Multa 10% art. 523 (× Subtotal 03) + Honorários 10% art. 523 (× Subtotal 03) → **Subtotal 04**.
5. **− Pagamentos fora do intervalo (corrigidos)**.
6. = **TOTAL GERAL**.

> Decisão de produto: todos os consectários incidem sobre o débito **antes** do abatimento dos pagamentos fora do intervalo. Isso afasta o resultado do padrão Juriscalc/TJTO (que abate logo após o total das parcelas) — diferença consciente e intencional.

### 8.5. Totalização — rito da prisão
Apenas o débito alimentar atualizado (Tabela I) menos pagamentos fora do intervalo; sem consectários.

### 8.6. Validação
Motor conferido contra o demonstrativo oficial do TJTO anexado (`Calculo_2026_UNB_298700`): fatores de correção e juros coincidem com diferença inferior a 0,01% por arredondamento de casas dos índices; a linha de exemplo (03/2025, saldo R$ 225,40) reproduz corrigido R$ 237,63/64, juros R$ 25,04 e total R$ 262,68.

---

## 9. Modelo de dados (cálculo `.json`)

```
Calculo {
  id: UUID
  processo: { num, orgao, requerente, requerido }
  config: {
    dataBase: "AAAA-MM",
    juros: "legais" | "fixo" | "sem",
    jurosFixoMensal: número,
    multaDescumprimentoPct, honorariosPct,
    multa523: bool, honorarios523: bool,
    observacoes
  }
  valoresDevidos: [ { id, rito: "prisao"|"exprop", de: "AAAA-MM",
                      ate: "AAAA-MM"|null, forma: "fixo"|"sm",
                      valor, descricao } ]
  pagamentos: [ { id, rito: "auto"|"prisao"|"exprop",
                  tipo: "data"|"periodo", data|de|ate, valor, descricao } ]
  overrides: { "<rito>:<AAAA-MM>": { valorDevido?, valorPago? } }
  indicesSnapshot: { correcao: {...}, taxaLegal: {...}, salarioMinimo: [...] }
}
```

A base de índices/salário mínimo da máquina é separada (SQLite); o snapshot dentro do cálculo garante reprodutibilidade ao reabrir.

---

## 10. Arquitetura

- **Frontend:** HTML/CSS/JS do protótipo, embarcado na webview do Tauri.
- **Backend (Rust):** arquivos (ler/gravar `.json` e PDF nas pastas configuradas), busca IBGE/Bacen sem CORS, atualização da base, geração de PDF, foco de janela, serviço HTTP local para a futura extensão.
- **Persistência:** SQLite local (índices/salário mínimo, desde 2000); cálculos como `.json` por arquivo em pasta configurável; PDFs em pasta configurável.
- **Preferências:** pasta de PDFs, pasta de `.json`, estado da atualização automática.

### 10.1. Fontes de atualização automática
- IBGE INPC/IPCA: API de agregados/SIDRA (JSON).
- Bacen Taxa Legal: SGS, séries **29541** (Fator Selic mensal) e **29542** (Fator IPCA mensal); a taxa mensal é a razão entre os fatores. Endpoint: `https://api.bcb.gov.br/dados/serie/bcdata.sgs.{codigo}/dados?formato=json`. Não há série única "pronta" da Taxa Legal — o backend deriva de 29541/29542 (ou consome os comunicados mensais).
- Bacen Salário mínimo: SGS série **1619**.

---

## 11. Integração futura com e-Proc (preparação)
Extensão de navegador (escopo posterior) lerá nº do processo, polo ativo, polo passivo e vara do e-Proc TJTO e enviará ao app pela porta de entrada (RF-9), trazendo a janela ao primeiro plano com os campos preenchidos. Seletores DOM serão mapeados na construção da extensão. O contrato do payload já está definido neste PRD.

---

## 12. Critérios de aceite

- Cálculo de processo com dois ritos numa sessão, com dados do processo digitados uma vez; PDFs separados por rito, salvos automaticamente com nome `{processo} - {ID}` + sufixo do rito.
- Valor devido lançado por período mensal e por % do salário mínimo resolve corretamente por vigência.
- Pagamentos do mesmo mês somados; pagamento dentro do período abate a parcela; fora do período é corrigido e deduzido, imputado à expropriação quando há dois ritos.
- Edição inline no resultado altera o total; desfazer e restaurar funcionam; override persiste no `.json` e no PDF.
- Cascata da expropriação aplica consectários antes do abatimento dos pagamentos fora do intervalo.
- Biblioteca lateral lista por processo/partes/rito, lendo a pasta de `.json`; abre, duplica e exclui.
- App funciona offline com a base semeada; com internet, completa meses faltantes sem sobrescrever oficiais.

---

## 13. Pendências de implementação (não bloqueiam o início)
- Consolidar/derivar a série da Taxa Legal a partir de 29541/29542 e validar contra comunicados do Bacen.
- Definir cabeçalho do PDF (brasão/identificação) e os textos finais das notas explicativas.
- Validar caracteres do nº do processo no nome de arquivo no Windows (fallback já previsto).

---

## 14. Histórico de decisões (referência)
- Ritos inferidos dos valores devidos; sem seletor no Bloco 1.
- Período por De/Até, sem seletor de modo.
- Edição inline no resultado com desfazer/restaurar.
- Ordem cronológica entre ritos.
- Consectários incidem antes do abatimento dos pagamentos fora do intervalo (inclui art. 523).
- Juros sempre da data de cada parcela.
- Windows, instalação por máquina, stack Tauri.
- Pastas fixas separadas para PDF e para `.json`.
- ID = UUID; PDF = `{processo} - {ID}`.
- Internet disponível; atualização automática ligada.
- Biblioteca por pasta, individual por máquina, podendo apontar para rede compartilhada.
