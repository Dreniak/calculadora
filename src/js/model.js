// Modelo de dados do cálculo (Seção 9 do PRD) e utilitários de
// (de)serialização. Cada cálculo é um arquivo .json independente,
// identificado por UUID (RF-8 / RNF-4).

export const VERSAO_ARQUIVO = 1;

export function novoCalculo() {
  return {
    versao: VERSAO_ARQUIVO,
    id: crypto.randomUUID(),
    criadoEm: new Date().toISOString(),
    processo: { num: '', orgao: '', requerente: '', requerido: '' },
    config: {
      dataBase: mesAtual(),
      juros: 'legais',
      jurosFixoMensal: 1,
      multaDescumprimentoPct: 0,
      honorariosPct: 0,
      multa523: false,
      honorarios523: false,
      observacoes: '',
    },
    valoresDevidos: [],
    pagamentos: [],
    overrides: {},
    indicesSnapshot: null,
  };
}

export function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Valida e normaliza um cálculo carregado de arquivo (RF-8). */
export function validarCalculo(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Arquivo inválido');
  if (!obj.id || typeof obj.id !== 'string') throw new Error('Cálculo sem ID');
  const base = novoCalculo();
  return {
    ...base,
    ...obj,
    processo: { ...base.processo, ...(obj.processo || {}) },
    config: { ...base.config, ...(obj.config || {}) },
    valoresDevidos: Array.isArray(obj.valoresDevidos) ? obj.valoresDevidos : [],
    pagamentos: Array.isArray(obj.pagamentos) ? obj.pagamentos : [],
    overrides: obj.overrides && typeof obj.overrides === 'object' ? obj.overrides : {},
  };
}

/** Duplicata com novo UUID (RF-7). */
export function duplicarCalculo(calculo) {
  const copia = structuredClone(calculo);
  copia.id = crypto.randomUUID();
  copia.criadoEm = new Date().toISOString();
  return copia;
}

/** Ritos presentes, inferidos dos valores devidos (RF-2). */
export function ritosDoCalculo(calculo) {
  const set = new Set((calculo.valoresDevidos || []).map((v) => v.rito));
  return ['exprop', 'prisao'].filter((r) => set.has(r));
}

/**
 * Nome-base do arquivo PDF (RF-6): "{processo} - {ID}", com fallback
 * "{requerente} - {ID}" ou "{ID}"; sufixo de rito quando houver dois.
 * Remove caracteres inválidos em nomes de arquivo no Windows.
 */
export function nomeArquivoPdf(calculo, rito, doisRitos) {
  const limpar = (s) =>
    String(s || '')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .replace(/\s+/g, ' ')
      .trim();
  const proc = limpar(calculo.processo?.num);
  const req = limpar(calculo.processo?.requerente);
  let base = proc ? `${proc} - ${calculo.id}` : req ? `${req} - ${calculo.id}` : calculo.id;
  if (doisRitos && rito) base += rito === 'prisao' ? ' - prisao' : ' - expropriacao';
  return `${base}.pdf`;
}

/** Resumo para a biblioteca lateral (RF-7). */
export function resumoCalculo(calculo) {
  return {
    id: calculo.id,
    processo: calculo.processo?.num || '',
    requerente: calculo.processo?.requerente || '',
    requerido: calculo.processo?.requerido || '',
    ritos: ritosDoCalculo(calculo),
    criadoEm: calculo.criadoEm || null,
  };
}
