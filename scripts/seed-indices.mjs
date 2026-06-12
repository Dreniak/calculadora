// Preenche seed/indices-seed.json com os índices oficiais (RF-4 / §10.1):
//   - Correção: INPC (IBGE/SIDRA t.1736 v.44) até 08/2024,
//               IPCA (IBGE/SIDRA t.1737 v.63) a partir de 09/2024;
//   - Taxa Legal: razão entre os fatores SGS 29541 (Selic) e 29542 (IPCA),
//                 nunca negativa (Res. CMN nº 5.171/2024);
//   - Salário mínimo: SGS 1619 (confirma/atualiza vigências do seed).
//
// Uso: node scripts/seed-indices.mjs   (requer internet)
// Rode antes de empacotar o instalador, para distribuir a base já semeada
// (RNF-2). Em execução, o próprio aplicativo completa meses faltantes.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEED = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'indices-seed.json');
const DESDE = '2000-01';
const TRANSICAO = '2024-08'; // INPC até aqui; IPCA a partir do mês seguinte

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

// SIDRA: localiza em cada linha o código de período (AAAAMM) e o valor "V".
function lerSidra(linhas) {
  const out = {};
  for (const linha of linhas.slice(1)) { // primeira linha é o cabeçalho
    const periodo = Object.values(linha).find((v) => /^\d{6}$/.test(v));
    const valor = Number(linha.V);
    if (!periodo || !Number.isFinite(valor)) continue;
    out[`${periodo.slice(0, 4)}-${periodo.slice(4)}`] = valor;
  }
  return out;
}

function lerSgs(linhas) {
  const out = {};
  for (const { data, valor } of linhas) {
    const [, m, a] = data.split('/');
    const v = Number(valor);
    if (Number.isFinite(v)) out[`${a}-${m}`] = v;
  }
  return out;
}

const hoje = new Date().toISOString();
const marca = (valor, fonte) => ({ valor, status: 'oficial', fonte, atualizadoEm: hoje });

console.log('Buscando INPC (SIDRA 1736)…');
const inpc = lerSidra(await fetchJson(
  'https://apisidra.ibge.gov.br/values/t/1736/n1/all/v/44/p/all?formato=json',
));
console.log('Buscando IPCA (SIDRA 1737)…');
const ipca = lerSidra(await fetchJson(
  'https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/63/p/all?formato=json',
));
console.log('Buscando fatores da Taxa Legal (SGS 29541/29542)…');
const fatorSelic = lerSgs(await fetchJson(
  'https://api.bcb.gov.br/dados/serie/bcdata.sgs.29541/dados?formato=json',
));
const fatorIpca = lerSgs(await fetchJson(
  'https://api.bcb.gov.br/dados/serie/bcdata.sgs.29542/dados?formato=json',
));
console.log('Buscando salário mínimo (SGS 1619)…');
const sm = lerSgs(await fetchJson(
  'https://api.bcb.gov.br/dados/serie/bcdata.sgs.1619/dados?formato=json',
));

const seed = JSON.parse(readFileSync(SEED, 'utf8'));

// Correção composta INPC→IPCA
seed.correcao = {};
for (const [ym, v] of Object.entries(inpc).sort()) {
  if (ym >= DESDE && ym <= TRANSICAO) seed.correcao[ym] = marca(v, 'INPC/IBGE');
}
for (const [ym, v] of Object.entries(ipca).sort()) {
  if (ym > TRANSICAO) seed.correcao[ym] = marca(v, 'IPCA/IBGE');
}

// Taxa Legal = (fator Selic / fator IPCA − 1) × 100, piso zero
seed.taxaLegal = {};
for (const [ym, fs] of Object.entries(fatorSelic).sort()) {
  const fi = fatorIpca[ym];
  if (fi == null || fi === 0) continue;
  const taxa = Math.max(0, (fs / fi - 1) * 100);
  seed.taxaLegal[ym] = marca(Number(taxa.toFixed(7)), 'Bacen SGS 29541/29542');
}

// Salário mínimo: vigências a partir das mudanças de valor da série mensal
const vigencias = [];
let anterior = null;
for (const [ym, v] of Object.entries(sm).sort()) {
  if (ym < '1999-05') continue;
  if (v !== anterior) {
    vigencias.push({ vigencia: ym, valor: v, status: 'oficial', fonte: 'Bacen SGS 1619', atualizadoEm: hoje });
    anterior = v;
  }
}
if (vigencias.length) seed.salarioMinimo = vigencias;

seed.geradoEm = hoje;
writeFileSync(SEED, JSON.stringify(seed, null, 2) + '\n');
console.log(
  `OK: ${Object.keys(seed.correcao).length} meses de correção, ` +
  `${Object.keys(seed.taxaLegal).length} de Taxa Legal, ` +
  `${seed.salarioMinimo.length} vigências de salário mínimo.`,
);
