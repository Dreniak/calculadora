# SuperCalculadora de Alimentos 3.000

Ferramenta de desktop (Windows, Tauri) para cálculo de débito de pensão
alimentícia em execução, cobrindo os ritos da **coerção pessoal** (CPC,
art. 528) e da **expropriação** (CPC, art. 523) numa única sessão, conforme o
[PRD v1.0](docs/PRD.md).

## Estrutura

```
src/                  Frontend (HTML/CSS/JS puro, embarcado na webview)
  js/engine.js        Motor de cálculo (Seção 8 do PRD) — módulo puro, testável
  js/model.js         Modelo de dados do cálculo (Seção 9), UUID, nomes de PDF
  js/pdf.js           Gerador de PDF próprio (layout do demonstrativo TJTO)
  js/backend.js       Adaptador: comandos Tauri ou fallback de navegador
  js/app.js           UI (biblioteca, formulários, demonstrativo, índices)
src-tauri/            Backend Rust
  src/storage.rs      Cálculos .json (gravação atômica), PDFs, preferências
  src/indices.rs      Base SQLite de índices/SM + atualização IBGE/Bacen
  src/entry.rs        Serviço HTTP local 127.0.0.1 (RF-9, integração e-Proc)
seed/indices-seed.json  Base semeada (vigências de salário mínimo + séries)
scripts/seed-indices.mjs  Preenche o seed com INPC/IPCA/Taxa Legal/SM oficiais
tests/                Testes (Node) do motor, modelo, PDF e fumaça da UI
```

## Desenvolvimento

Pré-requisitos: Node 20+, Rust estável e os pré-requisitos do
[Tauri 2](https://tauri.app/start/prerequisites/).

```bash
npm install
node scripts/gen-icon.mjs   # gera src-tauri/icons/ (necessário antes do build)
npm test           # motor, modelo, PDF e fumaça da UI (jsdom)
npm run dev        # aplicativo em modo desenvolvimento
npm run build      # instaladores (.msi/.exe no Windows)
npm run prototipo  # frontend em http://localhost:8080/src/ (modo protótipo)
```

No modo protótipo (navegador) os cálculos ficam em `localStorage` e o PDF é
baixado; no aplicativo os cálculos são arquivos `.json` na pasta configurada e
o PDF é gravado direto na pasta de PDFs, sem diálogo (RF-6).

## Distribuição (instalador Windows)

O Tauri empacota para o sistema em que roda: o `.msi`/`.exe` do Windows precisa
ser gerado **no Windows**. Para isso há o workflow
[`.github/workflows/build-windows.yml`](.github/workflows/build-windows.yml),
que compila num runner `windows-latest` (roda `seed` + `gen-icon` + `tauri build`)
e publica o instalador.

- **Build sob demanda:** aba **Actions** → *Build Windows installer* → *Run
  workflow*. O `.msi` e o `-setup.exe` ficam disponíveis como artefato da execução.
- **Release versionado:** crie e envie uma tag `v*` (ex.: `git tag v1.0.0 &&
  git push origin v1.0.0`); o mesmo workflow anexa os instaladores a um Release.

Os artefatos saem em `src-tauri/target/release/bundle/msi/` e `.../bundle/nsis/`.
Sem certificado de *code signing*, o SmartScreen exibirá o aviso de editor
desconhecido na instalação.

## Semeadura da base de índices

Antes de empacotar o instalador, rode (com internet):

```bash
npm run seed
```

O script preenche `seed/indices-seed.json` com INPC/IPCA (IBGE SIDRA),
Taxa Legal (derivada das séries SGS 29541/29542 do Bacen, piso zero) e as
vigências do salário mínimo (SGS 1619). A base é importada para o SQLite da
máquina na primeira execução; depois disso o próprio aplicativo completa os
meses faltantes quando há internet (RNF-3), sem sobrescrever valores com
status **oficial**.

## Convenções de cálculo adotadas

Decisões do PRD (Seção 8) e convenções de implementação registradas:

- Correção monetária da competência da parcela (inclusive) até o mês anterior
  à data-base; fatores com 7 casas decimais (RNF-5).
- Juros simples, termo inicial na competência de cada parcela, incidentes
  sobre o valor corrigido. Transições com pro rata die: 01/2003
  (10 dias a 0,5% + 21 dias a 1%) e 08/2024 (29 dias a 1% + Taxa Legal
  parcial de 30–31/08 quando constar da base).
- Pagamentos fora do período são apenas **corrigidos** (sem juros) antes da
  dedução; excedente de pagamento sobre a parcela do mês é tratado como
  pagamento fora do período do mesmo rito (não gera saldo negativo).
- Consectários da expropriação incidem **antes** do abatimento dos pagamentos
  fora do intervalo (decisão de produto, Seção 8.4 do PRD).
- Mês sem índice na base contribui com 0% e gera aviso visível na UI.

## Integração futura (e-Proc)

O serviço local (porta padrão 48591, configurável) já aceita o payload
padronizado do RF-9:

```bash
curl -X POST http://127.0.0.1:48591/preencher \
  -H 'Content-Type: application/json' \
  -d '{"processo":"0001234-56.2024.8.27.2729","orgao":"1ª Vara de Família","requerente":"Fulana","requerido":"Beltrano"}'
```

A janela vem ao primeiro plano com os campos preenchidos.

## Pendências (Seção 13 do PRD)

- Validar a série derivada da Taxa Legal contra os comunicados do Bacen.
- Definir o cabeçalho institucional do PDF (brasão/identificação) e o texto
  final das notas explicativas — hoje o cabeçalho é genérico ("PODER
  JUDICIÁRIO") e as notas refletem os critérios do PRD.
- Conferir o motor contra o demonstrativo oficial `Calculo_2026_UNB_298700`
  (Seção 8.6) com a base real de índices semeada.
- O valor do salário mínimo de 2026 no seed está marcado como **estimado**;
  é confirmado automaticamente pela SGS 1619 na primeira atualização.
