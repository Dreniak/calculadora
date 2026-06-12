// Adaptador de backend: usa os comandos do Tauri quando o app roda na
// webview; em navegador puro (modo protótipo) cai para localStorage e
// download de arquivos, mantendo a mesma interface para a UI.

export const ehTauri =
  typeof window !== 'undefined' && !!window.__TAURI__?.core?.invoke;

const invoke = ehTauri ? window.__TAURI__.core.invoke : null;

// --------------------------- modo protótipo --------------------------------
const LS = {
  prefs: 'cpa.prefs',
  indices: 'cpa.indices',
  calc: (id) => `cpa.calc.${id}`,
};

function lsListarCalculos() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith('cpa.calc.')) {
      try { out.push(JSON.parse(localStorage.getItem(k))); } catch { /* ignora */ }
    }
  }
  return out;
}

async function lsIndicesIniciais() {
  try {
    const res = await fetch('../seed/indices-seed.json');
    if (res.ok) return await res.json();
  } catch { /* sem seed disponível no protótipo */ }
  return { versao: 1, correcao: {}, taxaLegal: {}, salarioMinimo: [] };
}

function baixarArquivo(nome, bytes, tipo) {
  const blob = new Blob([bytes], { type: tipo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ------------------------------ API única ----------------------------------

export async function obterPreferencias() {
  if (ehTauri) return invoke('obter_preferencias');
  return JSON.parse(localStorage.getItem(LS.prefs) || '{}');
}

export async function salvarPreferencias(prefs) {
  if (ehTauri) return invoke('salvar_preferencias', { prefs });
  localStorage.setItem(LS.prefs, JSON.stringify(prefs));
}

export async function listarCalculos() {
  if (ehTauri) return invoke('listar_calculos');
  return lsListarCalculos();
}

export async function carregarCalculo(id) {
  if (ehTauri) return invoke('carregar_calculo', { id });
  const raw = localStorage.getItem(LS.calc(id));
  if (!raw) throw new Error('Cálculo não encontrado');
  return JSON.parse(raw);
}

export async function salvarCalculo(calculo) {
  if (ehTauri) return invoke('salvar_calculo', { calculo });
  localStorage.setItem(LS.calc(calculo.id), JSON.stringify(calculo));
}

export async function excluirCalculo(id) {
  if (ehTauri) return invoke('excluir_calculo', { id });
  localStorage.removeItem(LS.calc(id));
}

/** Grava o PDF na pasta configurada (Tauri) ou baixa (protótipo). */
export async function salvarPdf(nome, bytes) {
  if (ehTauri) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return invoke('salvar_pdf', { nome, dadosB64: btoa(bin) });
  }
  baixarArquivo(nome, bytes, 'application/pdf');
  return nome;
}

export async function obterIndices() {
  if (ehTauri) return invoke('obter_indices');
  const raw = localStorage.getItem(LS.indices);
  if (raw) return JSON.parse(raw);
  const base = await lsIndicesIniciais();
  localStorage.setItem(LS.indices, JSON.stringify(base));
  return base;
}

export async function salvarIndices(base) {
  if (ehTauri) return invoke('salvar_indices', { base });
  localStorage.setItem(LS.indices, JSON.stringify(base));
}

/** Busca meses faltantes em IBGE/Bacen (RNF-3). Só disponível no Tauri. */
export async function atualizarIndices() {
  if (ehTauri) return invoke('atualizar_indices');
  return { ok: false, mensagem: 'Atualização automática disponível apenas no aplicativo instalado.' };
}

/** RF-9 — payload {processo, orgao, requerente, requerido} vindo da extensão. */
export function aoPreencherProcesso(cb) {
  if (ehTauri && window.__TAURI__.event?.listen) {
    window.__TAURI__.event.listen('preencher-processo', (ev) => cb(ev.payload));
  }
}
