// Motor de cálculo — Calculadora Judicial de Pensão Alimentícia
// Implementa a especificação da Seção 8 do PRD:
//   8.1 correção monetária (INPC até 08/2024, IPCA a partir de 09/2024 — a base
//       de índices já entrega a série composta em snapshot.correcao)
//   8.2 juros de mora legais (0,5% a.m. até 10/01/2003; 1% a.m. até 29/08/2024;
//       Taxa Legal a partir de então), fixos ou sem juros — regime simples
//   8.3 pagamentos (soma por mês, imputação dentro/fora do período)
//   8.4 cascata de totalização: multa por descumprimento e honorários
//       advocatícios incidem sobre ambos os ritos; multa e honorários do
//       art. 523 só na expropriação, com base no Subtotal 01
//   8.5 totalização do rito da coerção pessoal
//
// Módulo puro: sem DOM, sem Tauri. Usado pela UI e pelos testes (Node).

export const RITOS = ['exprop', 'prisao'];

export const NOME_RITO = {
  exprop: 'Expropriação (CPC, art. 523)',
  prisao: 'Coerção pessoal (CPC, art. 528)',
};

// ---------------------------------------------------------------------------
// Datas (competências "AAAA-MM")
// ---------------------------------------------------------------------------

export function ymToNum(ym) {
  const [a, m] = ym.split('-').map(Number);
  return a * 12 + (m - 1);
}

export function numToYm(n) {
  const a = Math.floor(n / 12);
  const m = (n % 12) + 1;
  return `${a}-${String(m).padStart(2, '0')}`;
}

export function ymValido(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) return false;
  const m = Number(ym.slice(5));
  return m >= 1 && m <= 12;
}

/** Lista de competências de `de` a `ate`, inclusive. */
export function competencias(de, ate) {
  const out = [];
  for (let n = ymToNum(de); n <= ymToNum(ate); n++) out.push(numToYm(n));
  return out;
}

// ---------------------------------------------------------------------------
// Arredondamento (RNF-5)
// ---------------------------------------------------------------------------

/** Arredonda meio-para-cima, em `casas` decimais. */
export function round(v, casas) {
  const f = 10 ** casas;
  return Math.sign(v) * Math.round(Math.abs(v) * f + Number.EPSILON) / f;
}

export const round2 = (v) => round(v, 2);
/** Fatores de correção com 7 casas (RNF-5). */
export const round7 = (v) => round(v, 7);

// ---------------------------------------------------------------------------
// Índices — operam sobre o snapshot do cálculo (Seção 9 do PRD):
//   snapshot.correcao:   { "AAAA-MM": { valor: % a.m., status, fonte } }
//   snapshot.taxaLegal:  { "AAAA-MM": { valor: % a.m., status, fonte } }
//   snapshot.salarioMinimo: [ { vigencia: "AAAA-MM", valor, status, fonte } ]
// ---------------------------------------------------------------------------

const YM_TRANSICAO_TL = '2024-08'; // Lei nº 14.905/2024 — vigência 30/08/2024

/**
 * Fator de correção do mês `de` (inclusive) até o mês anterior a `ateExcl`
 * (8.1: da competência da parcela até o mês anterior à data-base).
 * Mês sem índice contribui com 0% e gera aviso.
 */
export function fatorCorrecao(snapshot, de, ateExcl, avisos) {
  let fator = 1;
  for (let n = ymToNum(de); n < ymToNum(ateExcl); n++) {
    const ym = numToYm(n);
    const idx = snapshot.correcao?.[ym];
    if (idx == null || idx.valor == null) {
      avisos?.push({ tipo: 'indice-ausente', serie: 'correcao', ym });
      continue;
    }
    fator *= 1 + idx.valor / 100;
    if (idx.status && idx.status !== 'oficial') {
      avisos?.push({ tipo: 'indice-estimado', serie: 'correcao', ym });
    }
  }
  return round7(fator);
}

/**
 * Percentual de juros legais acumulados (regime simples) do mês `de`
 * (inclusive) até o mês anterior a `ateExcl`.
 *
 * Convenções de transição (mês parcial, pro rata die):
 *  - 01/2003: 10 dias a 0,5% + 21 dias a 1% (EC do CC/2002 em 11/01/2003);
 *  - 08/2024: 29 dias a 1% + Taxa Legal parcial de 30–31/08 quando constar
 *    da base (Lei nº 14.905/2024 em vigor a partir de 30/08/2024).
 */
export function jurosLegaisPct(snapshot, de, ateExcl, avisos) {
  let pct = 0;
  for (let n = ymToNum(de); n < ymToNum(ateExcl); n++) {
    const ym = numToYm(n);
    if (ym < '2003-01') {
      pct += 0.5;
    } else if (ym === '2003-01') {
      pct += (10 / 31) * 0.5 + (21 / 31) * 1.0;
    } else if (ym < YM_TRANSICAO_TL) {
      pct += 1.0;
    } else if (ym === YM_TRANSICAO_TL) {
      pct += (29 / 31) * 1.0;
      const tl = snapshot.taxaLegal?.[ym];
      if (tl?.valor != null) pct += tl.valor;
    } else {
      const tl = snapshot.taxaLegal?.[ym];
      if (tl == null || tl.valor == null) {
        avisos?.push({ tipo: 'indice-ausente', serie: 'taxaLegal', ym });
        continue;
      }
      pct += tl.valor;
      if (tl.status && tl.status !== 'oficial') {
        avisos?.push({ tipo: 'indice-estimado', serie: 'taxaLegal', ym });
      }
    }
  }
  return pct;
}

/**
 * Percentual de juros conforme a configuração ("legais" | "fixo" | "sem"),
 * sempre com termo inicial na competência da parcela (RF-1).
 */
export function jurosPct(snapshot, config, de, ateExcl, avisos) {
  if (config.juros === 'sem') return 0;
  const meses = Math.max(0, ymToNum(ateExcl) - ymToNum(de));
  if (config.juros === 'fixo') return meses * (Number(config.jurosFixoMensal) || 0);
  return jurosLegaisPct(snapshot, de, ateExcl, avisos);
}

/** Salário mínimo vigente na competência (maior vigência <= ym). */
export function salarioMinimoEm(snapshot, ym, avisos) {
  let melhor = null;
  for (const sm of snapshot.salarioMinimo || []) {
    if (sm.vigencia <= ym && (!melhor || sm.vigencia > melhor.vigencia)) melhor = sm;
  }
  if (!melhor) {
    avisos?.push({ tipo: 'salario-minimo-ausente', ym });
    return null;
  }
  if (melhor.status && melhor.status !== 'oficial') {
    avisos?.push({ tipo: 'salario-minimo-estimado', ym, vigencia: melhor.vigencia });
  }
  return melhor.valor;
}

// ---------------------------------------------------------------------------
// Expansão dos lançamentos (RF-2 / RF-3)
// ---------------------------------------------------------------------------

/**
 * Expande os valores devidos em parcelas mensais por rito.
 * Retorna { exprop: Map<ym, valor>, prisao: Map<ym, valor> } (somando
 * lançamentos que caiam na mesma competência do mesmo rito).
 */
export function expandirValoresDevidos(valoresDevidos, snapshot, avisos) {
  const porRito = { exprop: new Map(), prisao: new Map() };
  for (const vd of valoresDevidos || []) {
    const mapa = porRito[vd.rito];
    if (!mapa) continue;
    const ate = vd.ate || vd.de; // só "De" = mês único (RF-2)
    for (const ym of competencias(vd.de, ate)) {
      let valor;
      if (vd.forma === 'sm') {
        const sm = salarioMinimoEm(snapshot, ym, avisos);
        valor = sm == null ? 0 : round2((Number(vd.valor) / 100) * sm);
      } else {
        valor = round2(Number(vd.valor));
      }
      mapa.set(ym, round2((mapa.get(ym) || 0) + valor));
    }
  }
  return porRito;
}

/**
 * Soma os pagamentos por mês (RF-3), preservando a indicação de rito do
 * lançamento ("auto" | "prisao" | "exprop").
 * Retorna Map<"rito|ym", { ym, rito, valor }>.
 */
export function somarPagamentosPorMes(pagamentos) {
  const porMes = new Map();
  for (const p of pagamentos || []) {
    const rito = p.rito || 'auto';
    const meses =
      p.tipo === 'periodo'
        ? competencias(p.de, p.ate || p.de)
        : [String(p.data).slice(0, 7)];
    for (const ym of meses) {
      const chave = `${rito}|${ym}`;
      const atual = porMes.get(chave) || { ym, rito, valor: 0 };
      atual.valor = round2(atual.valor + Number(p.valor));
      porMes.set(chave, atual);
    }
  }
  return porMes;
}

/**
 * Imputação dos pagamentos (8.3):
 *  - dentro do período do débito, abate a parcela do próprio mês;
 *  - fora do período, vai para a Tabela II (corrigido e deduzido do total),
 *    imputado preferencialmente à expropriação quando houver os dois ritos;
 *  - excedente sobre a parcela do mês é tratado como pagamento fora do
 *    período do mesmo rito (não gera saldo devedor negativo);
 *  - rito explícito no lançamento ("prisao"/"exprop") força a imputação.
 *
 * Retorna { pagosMes: {rito: Map<ym, valor>}, fora: {rito: Map<ym, valor>} }.
 */
export function imputarPagamentos(porRito, pagamentosMes, ritosAtivos) {
  const pagosMes = { exprop: new Map(), prisao: new Map() };
  const fora = { exprop: new Map(), prisao: new Map() };
  const addFora = (rito, ym, v) =>
    fora[rito].set(ym, round2((fora[rito].get(ym) || 0) + v));
  const addPago = (rito, ym, v) =>
    pagosMes[rito].set(ym, round2((pagosMes[rito].get(ym) || 0) + v));

  const ritoForaPadrao = ritosAtivos.includes('exprop') ? 'exprop' : 'prisao';

  for (const { ym, rito, valor } of pagamentosMes.values()) {
    let restante = valor;
    // ordem de tentativa de abatimento dentro do mês
    const candidatos =
      rito === 'auto' ? ['exprop', 'prisao'] : [rito];
    for (const r of candidatos) {
      if (restante <= 0) break;
      if (!ritosAtivos.includes(r)) continue;
      const devido = porRito[r].get(ym);
      if (devido == null) continue;
      const jaPago = pagosMes[r].get(ym) || 0;
      const abatimento = Math.min(restante, Math.max(0, devido - jaPago));
      if (abatimento > 0) {
        addPago(r, ym, abatimento);
        restante = round2(restante - abatimento);
      }
    }
    if (restante > 0) {
      const r =
        rito !== 'auto' && ritosAtivos.includes(rito) ? rito : ritoForaPadrao;
      addFora(r, ym, restante);
    }
  }
  return { pagosMes, fora };
}

// ---------------------------------------------------------------------------
// Demonstrativo (RF-5) e totalizações (8.4 / 8.5)
// ---------------------------------------------------------------------------

/**
 * Calcula o demonstrativo completo a partir do cálculo (modelo da Seção 9)
 * e do snapshot de índices.
 *
 * Retorna {
 *   ritos: { exprop?, prisao? },   // demonstrativo por rito
 *   ordem: [...],                  // ordem cronológica (RF-5)
 *   avisos: [...]
 * }
 */
export function calcular(calculo, snapshot) {
  const avisos = [];
  const config = calculo.config || {};
  const dataBase = config.dataBase;
  if (!ymValido(dataBase)) {
    return { ritos: {}, ordem: [], avisos: [{ tipo: 'data-base-invalida' }] };
  }

  const porRito = expandirValoresDevidos(calculo.valoresDevidos, snapshot, avisos);
  const ritosAtivos = RITOS.filter((r) => porRito[r].size > 0);
  const pagamentosMes = somarPagamentosPorMes(calculo.pagamentos);
  const { pagosMes, fora } = imputarPagamentos(porRito, pagamentosMes, ritosAtivos);
  const overrides = calculo.overrides || {};

  const ritos = {};
  for (const rito of ritosAtivos) {
    const meses = [...porRito[rito].keys()].sort();
    const tabelaI = [];
    let parcelas = 0;

    for (const ym of meses) {
      const ov = overrides[`${rito}:${ym}`] || {};
      const valorDevidoCalc = porRito[rito].get(ym);
      const valorPagoCalc = pagosMes[rito].get(ym) || 0;
      const valorDevido =
        ov.valorDevido != null ? round2(Number(ov.valorDevido)) : valorDevidoCalc;
      const valorPago =
        ov.valorPago != null ? round2(Number(ov.valorPago)) : valorPagoCalc;
      const saldo = round2(Math.max(0, valorDevido - valorPago));
      const fator = fatorCorrecao(snapshot, ym, dataBase, avisos);
      const valorCorrigido = round2(saldo * fator);
      const pctJuros = jurosPct(snapshot, config, ym, dataBase, avisos);
      const juros = round2(valorCorrigido * (pctJuros / 100));
      const total = round2(valorCorrigido + juros);
      parcelas = round2(parcelas + total);
      tabelaI.push({
        ym,
        valorDevido,
        valorDevidoCalc,
        valorPago,
        valorPagoCalc,
        saldo,
        fator,
        valorCorrigido,
        jurosPct: pctJuros,
        juros,
        total,
        override: ov.valorDevido != null || ov.valorPago != null,
      });
    }

    // Tabela II — pagamentos fora do intervalo, apenas corrigidos (8.3)
    const tabelaII = [];
    let pagamentosFora = 0;
    for (const ym of [...fora[rito].keys()].sort()) {
      const ov = overrides[`${rito}:fora:${ym}`] || {};
      const valorPagoCalc = fora[rito].get(ym);
      const valorPago =
        ov.valorPago != null ? round2(Number(ov.valorPago)) : valorPagoCalc;
      const fator = fatorCorrecao(snapshot, ym, dataBase, avisos);
      const valorCorrigido = round2(valorPago * fator);
      pagamentosFora = round2(pagamentosFora + valorCorrigido);
      tabelaII.push({
        ym,
        valorPago,
        valorPagoCalc,
        fator,
        valorCorrigido,
        override: ov.valorPago != null,
      });
    }

    const demo = {
      rito,
      nome: NOME_RITO[rito],
      termoInicial: meses[0] || null,
      tabelaI,
      tabelaII,
    };

    // 8.4 — todos os consectários incidem ANTES do abatimento dos pagamentos
    // fora do intervalo (decisão de produto registrada no PRD). A multa e os
    // honorários de 10% do art. 523 (só na expropriação) têm por base o total
    // das parcelas e formam, somados a ele, o Subtotal 01. A multa por
    // descumprimento e os honorários advocatícios incidem sobre esse mesmo
    // Subtotal 01 (em paralelo, sem cascata entre si) e os dois ritos.
    const multaPct = Number(config.multaDescumprimentoPct) || 0;
    const honPct = Number(config.honorariosPct) || 0;
    const multa523 = rito === 'exprop' && config.multa523 ? round2(parcelas * 0.10) : 0;
    const honorarios523 = rito === 'exprop' && config.honorarios523 ? round2(parcelas * 0.10) : 0;
    const subtotal01 = round2(parcelas + multa523 + honorarios523);
    const multaDescumprimento = round2(subtotal01 * (multaPct / 100));
    const honorarios = round2(subtotal01 * (honPct / 100));
    const subtotal02 = round2(subtotal01 + multaDescumprimento + honorarios);
    const totais = {
      parcelas,
      subtotal01,
      multaDescumprimentoPct: multaPct,
      multaDescumprimento,
      honorariosPct: honPct,
      honorarios,
      subtotal02,
      pagamentosFora,
      totalGeral: round2(subtotal02 - pagamentosFora),
    };
    if (rito === 'exprop') {
      totais.multa523 = multa523;
      totais.honorarios523 = honorarios523;
    }
    demo.totais = totais;
    ritos[rito] = demo;
  }

  // RF-5 — ordem cronológica: rito de termo inicial mais antigo primeiro
  const ordem = ritosAtivos
    .slice()
    .sort((a, b) => (ritos[a].termoInicial || '').localeCompare(ritos[b].termoInicial || ''));

  return { ritos, ordem, avisos };
}
