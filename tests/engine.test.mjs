// Testes do motor de cálculo (Seção 8 do PRD) com índices sintéticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ymToNum, numToYm, competencias, round2, round7,
  fatorCorrecao, jurosLegaisPct, jurosPct, salarioMinimoEm,
  expandirValoresDevidos, somarPagamentosPorMes, imputarPagamentos,
  calcular,
} from '../src/js/engine.js';

// ---------------------------------------------------------------------------
// Snapshot sintético: correção 1% a.m. em 2025, taxa legal 0,9% a.m.
// ---------------------------------------------------------------------------
function snapshotSintetico() {
  const correcao = {};
  const taxaLegal = {};
  for (let n = ymToNum('2024-01'); n <= ymToNum('2026-12'); n++) {
    correcao[numToYm(n)] = { valor: 1.0, status: 'oficial', fonte: 'teste' };
  }
  for (let n = ymToNum('2024-09'); n <= ymToNum('2026-12'); n++) {
    taxaLegal[numToYm(n)] = { valor: 0.9, status: 'oficial', fonte: 'teste' };
  }
  return {
    correcao,
    taxaLegal,
    salarioMinimo: [
      { vigencia: '2024-01', valor: 1412, status: 'oficial' },
      { vigencia: '2025-01', valor: 1518, status: 'oficial' },
    ],
  };
}

function calculoBase(extra = {}) {
  return {
    id: 'teste',
    processo: { num: '0001-23', orgao: 'Vara', requerente: 'A', requerido: 'B' },
    config: {
      dataBase: '2025-06',
      juros: 'sem',
      jurosFixoMensal: 1,
      multaDescumprimentoPct: 0,
      honorariosPct: 0,
      multa523: false,
      honorarios523: false,
      observacoes: '',
      ...extra.config,
    },
    valoresDevidos: extra.valoresDevidos || [],
    pagamentos: extra.pagamentos || [],
    overrides: extra.overrides || {},
  };
}

// ---------------------------------------------------------------------------
// Datas e utilitários
// ---------------------------------------------------------------------------
test('competências inclusivas e conversão ym', () => {
  assert.equal(numToYm(ymToNum('2024-12') + 1), '2025-01');
  assert.deepEqual(competencias('2024-11', '2025-02'), [
    '2024-11', '2024-12', '2025-01', '2025-02',
  ]);
});

test('arredondamento meio-para-cima com 2 e 7 casas (RNF-5)', () => {
  assert.equal(round2(2.005), 2.01);
  assert.equal(round2(-2.005), -2.01);
  assert.equal(round7(1.00000049), 1.0000005);
});

// ---------------------------------------------------------------------------
// 8.1 — Correção monetária
// ---------------------------------------------------------------------------
test('fator de correção: competência inclusive até mês anterior à data-base', () => {
  const s = snapshotSintetico();
  // 2025-03 e 2025-04 e 2025-05 a 1% => 1.01^3
  assert.equal(fatorCorrecao(s, '2025-03', '2025-06'), round7(1.01 ** 3));
  // competência igual à data-base: sem correção
  assert.equal(fatorCorrecao(s, '2025-06', '2025-06'), 1);
});

test('mês sem índice gera aviso e contribui com 0%', () => {
  const s = snapshotSintetico();
  delete s.correcao['2025-04'];
  const avisos = [];
  const f = fatorCorrecao(s, '2025-03', '2025-06', avisos);
  assert.equal(f, round7(1.01 ** 2));
  assert.ok(avisos.some((a) => a.tipo === 'indice-ausente' && a.ym === '2025-04'));
});

// ---------------------------------------------------------------------------
// 8.2 — Juros de mora
// ---------------------------------------------------------------------------
test('juros legais: 0,5% antes de 2003, transição pro rata em 01/2003', () => {
  const s = snapshotSintetico();
  // 2002-11 e 2002-12 a 0,5% + 01/2003 pro rata + 02/2003 a 1%
  const esperado = 0.5 + 0.5 + ((10 / 31) * 0.5 + (21 / 31) * 1.0) + 1.0;
  assert.ok(Math.abs(jurosLegaisPct(s, '2002-11', '2003-03') - esperado) < 1e-9);
});

test('juros legais: 1% a.m. até 07/2024 e Taxa Legal a partir de 09/2024', () => {
  const s = snapshotSintetico();
  // 2024-06, 2024-07 a 1%; 2024-08 pro rata 29/31; 2024-09 taxa legal 0,9
  const esperado = 1 + 1 + (29 / 31) * 1.0 + 0.9;
  assert.ok(Math.abs(jurosLegaisPct(s, '2024-06', '2024-10') - esperado) < 1e-9);
});

test('juros fixos e sem juros', () => {
  const s = snapshotSintetico();
  assert.equal(jurosPct(s, { juros: 'fixo', jurosFixoMensal: 2 }, '2025-01', '2025-06'), 10);
  assert.equal(jurosPct(s, { juros: 'sem' }, '2025-01', '2025-06'), 0);
});

// ---------------------------------------------------------------------------
// RF-2 — Valores devidos (% do salário mínimo por vigência)
// ---------------------------------------------------------------------------
test('salário mínimo resolvido pela vigência de cada mês', () => {
  const s = snapshotSintetico();
  assert.equal(salarioMinimoEm(s, '2024-12'), 1412);
  assert.equal(salarioMinimoEm(s, '2025-01'), 1518);
});

test('expansão: período De/Até, % do SM por competência, soma de lançamentos', () => {
  const s = snapshotSintetico();
  const porRito = expandirValoresDevidos(
    [
      { id: '1', rito: 'prisao', de: '2024-12', ate: '2025-02', forma: 'sm', valor: 30 },
      { id: '2', rito: 'prisao', de: '2025-01', ate: null, forma: 'fixo', valor: 100 },
    ],
    s,
  );
  assert.equal(porRito.prisao.get('2024-12'), round2(0.3 * 1412)); // 423.60
  assert.equal(porRito.prisao.get('2025-01'), round2(0.3 * 1518 + 100)); // 555.40
  assert.equal(porRito.prisao.get('2025-02'), round2(0.3 * 1518)); // 455.40
  assert.equal(porRito.exprop.size, 0);
});

// ---------------------------------------------------------------------------
// 8.3 — Pagamentos
// ---------------------------------------------------------------------------
test('pagamentos do mesmo mês são somados', () => {
  const m = somarPagamentosPorMes([
    { tipo: 'data', data: '2025-01-05', valor: 100 },
    { tipo: 'data', data: '2025-01-20', valor: 50.5 },
    { tipo: 'periodo', de: '2025-02', ate: '2025-03', valor: 200 },
  ]);
  assert.equal(m.get('auto|2025-01').valor, 150.5);
  assert.equal(m.get('auto|2025-02').valor, 200);
  assert.equal(m.get('auto|2025-03').valor, 200);
});

test('imputação: dentro do período abate o mês; fora vai para Tabela II da expropriação', () => {
  const s = snapshotSintetico();
  const porRito = expandirValoresDevidos(
    [
      { id: '1', rito: 'exprop', de: '2025-01', ate: '2025-03', forma: 'fixo', valor: 500 },
      { id: '2', rito: 'prisao', de: '2025-04', ate: '2025-05', forma: 'fixo', valor: 500 },
    ],
    s,
  );
  const pagos = somarPagamentosPorMes([
    { tipo: 'data', data: '2025-02-10', valor: 300 },  // dentro (exprop)
    { tipo: 'data', data: '2024-06-10', valor: 100 },  // fora => exprop (preferência)
    { tipo: 'data', data: '2025-04-10', valor: 800 },  // dentro prisão + excedente 300 fora
  ]);
  const { pagosMes, fora } = imputarPagamentos(porRito, pagos, ['exprop', 'prisao']);
  assert.equal(pagosMes.exprop.get('2025-02'), 300);
  assert.equal(pagosMes.prisao.get('2025-04'), 500);
  assert.equal(fora.exprop.get('2024-06'), 100);
  // excedente do mês 2025-04 (300) vai para fora, preferindo expropriação
  assert.equal(fora.exprop.get('2025-04'), 300);
});

test('imputação manual força o rito', () => {
  const s = snapshotSintetico();
  const porRito = expandirValoresDevidos(
    [
      { id: '1', rito: 'exprop', de: '2025-01', ate: '2025-03', forma: 'fixo', valor: 500 },
      { id: '2', rito: 'prisao', de: '2025-04', ate: '2025-05', forma: 'fixo', valor: 500 },
    ],
    s,
  );
  const pagos = somarPagamentosPorMes([
    { tipo: 'data', data: '2024-06-10', valor: 100, rito: 'prisao' },
  ]);
  const { fora } = imputarPagamentos(porRito, pagos, ['exprop', 'prisao']);
  assert.equal(fora.prisao.get('2024-06'), 100);
  assert.equal(fora.exprop.size, 0);
});

// ---------------------------------------------------------------------------
// 8.4 / 8.5 — Cascatas de totalização
// ---------------------------------------------------------------------------
test('cascata da expropriação: consectários antes do abatimento (decisão do PRD)', () => {
  const s = snapshotSintetico();
  // Sem correção/juros para conferência aritmética da cascata:
  // 3 parcelas de 1000 na própria data-base.
  const calc = calculoBase({
    config: {
      dataBase: '2025-06',
      juros: 'sem',
      multaDescumprimentoPct: 10,
      honorariosPct: 10,
      multa523: true,
      honorarios523: true,
    },
    valoresDevidos: [
      { id: '1', rito: 'exprop', de: '2025-06', ate: '2025-06', forma: 'fixo', valor: 3000 },
    ],
    pagamentos: [{ id: 'p', tipo: 'data', data: '2024-06-10', valor: 100 }],
  });
  // pagamento fora corrigido de 2024-06 a 2025-06 (12 meses a 1%)
  const foraCorrigido = round2(100 * round7(1.01 ** 12));
  const r = calcular(calc, s).ritos.exprop;
  assert.equal(r.totais.subtotal01, 3000);
  assert.equal(r.totais.multaDescumprimento, 300);     // 10% de 3000
  assert.equal(r.totais.subtotal02, 3300);
  assert.equal(r.totais.honorarios, 330);              // 10% de 3300 (cascata)
  assert.equal(r.totais.subtotal03, 3630);
  assert.equal(r.totais.multa523, 300);                // 10% do Subtotal 01 (3000)
  assert.equal(r.totais.honorarios523, 300);           // 10% do Subtotal 01 (3000)
  assert.equal(r.totais.subtotal04, 4230);             // 3630 + 300 + 300
  assert.equal(r.totais.pagamentosFora, foraCorrigido);
  assert.equal(r.totais.totalGeral, round2(4230 - foraCorrigido));
});

test('coerção pessoal: multa e honorários incidem; sem multa/honorários do art. 523', () => {
  const s = snapshotSintetico();
  const calc = calculoBase({
    config: { dataBase: '2025-06', juros: 'sem', multaDescumprimentoPct: 10, honorariosPct: 10 },
    valoresDevidos: [
      { id: '1', rito: 'prisao', de: '2025-06', ate: null, forma: 'fixo', valor: 1000 },
    ],
    pagamentos: [{ id: 'p', tipo: 'data', data: '2025-05-15', valor: 200 }],
  });
  const r = calcular(calc, s).ritos.prisao;
  assert.equal(r.totais.subtotal01, 1000);
  assert.equal(r.totais.multaDescumprimento, 100);     // 10% de 1000
  assert.equal(r.totais.subtotal02, 1100);
  assert.equal(r.totais.honorarios, 110);              // 10% de 1100 (cascata)
  assert.equal(r.totais.subtotal03, 1210);
  assert.equal(r.totais.multa523, undefined);          // art. 523 só na expropriação
  assert.equal(r.totais.subtotal04, undefined);
  assert.equal(r.totais.pagamentosFora, round2(200 * 1.01));
  assert.equal(r.totais.totalGeral, round2(1210 - round2(200 * 1.01)));
});

test('linha da Tabela I: saldo, corrigido, juros e total', () => {
  const s = snapshotSintetico();
  const calc = calculoBase({
    config: { dataBase: '2025-06', juros: 'fixo', jurosFixoMensal: 1 },
    valoresDevidos: [
      { id: '1', rito: 'exprop', de: '2025-03', ate: null, forma: 'fixo', valor: 500 },
    ],
    pagamentos: [{ id: 'p', tipo: 'data', data: '2025-03-05', valor: 200 }],
  });
  const linha = calcular(calc, s).ritos.exprop.tabelaI[0];
  assert.equal(linha.saldo, 300);
  assert.equal(linha.fator, round7(1.01 ** 3));
  assert.equal(linha.valorCorrigido, round2(300 * round7(1.01 ** 3))); // 309.09
  assert.equal(linha.jurosPct, 3);
  assert.equal(linha.juros, round2(linha.valorCorrigido * 0.03));
  assert.equal(linha.total, round2(linha.valorCorrigido + linha.juros));
});

// ---------------------------------------------------------------------------
// RF-5 — Overrides e ordem cronológica
// ---------------------------------------------------------------------------
test('override de Valor Devido/Pago altera o total e marca a linha', () => {
  const s = snapshotSintetico();
  const base = calculoBase({
    config: { dataBase: '2025-06', juros: 'sem' },
    valoresDevidos: [
      { id: '1', rito: 'exprop', de: '2025-06', ate: null, forma: 'fixo', valor: 1000 },
    ],
  });
  const semOv = calcular(base, s).ritos.exprop;
  assert.equal(semOv.totais.totalGeral, 1000);
  base.overrides = { 'exprop:2025-06': { valorDevido: 1500, valorPago: 200 } };
  const comOv = calcular(base, s).ritos.exprop;
  assert.equal(comOv.tabelaI[0].override, true);
  assert.equal(comOv.tabelaI[0].saldo, 1300);
  assert.equal(comOv.totais.totalGeral, 1300);
  // valores calculados originais preservados para "Restaurar"
  assert.equal(comOv.tabelaI[0].valorDevidoCalc, 1000);
  assert.equal(comOv.tabelaI[0].valorPagoCalc, 0);
});

test('ordem cronológica: rito de termo inicial mais antigo primeiro', () => {
  const s = snapshotSintetico();
  const calc = calculoBase({
    valoresDevidos: [
      { id: '1', rito: 'prisao', de: '2025-03', ate: '2025-05', forma: 'fixo', valor: 100 },
      { id: '2', rito: 'exprop', de: '2024-01', ate: '2025-02', forma: 'fixo', valor: 100 },
    ],
  });
  assert.deepEqual(calcular(calc, s).ordem, ['exprop', 'prisao']);
  const calc2 = calculoBase({
    valoresDevidos: [
      { id: '1', rito: 'prisao', de: '2023-01', ate: '2023-03', forma: 'fixo', valor: 100 },
      { id: '2', rito: 'exprop', de: '2024-01', ate: null, forma: 'fixo', valor: 100 },
    ],
  });
  assert.deepEqual(calcular(calc2, s).ordem, ['prisao', 'exprop']);
});

test('data-base inválida não calcula', () => {
  const r = calcular(calculoBase({ config: { dataBase: 'xx' } }), snapshotSintetico());
  assert.deepEqual(r.ordem, []);
  assert.ok(r.avisos.some((a) => a.tipo === 'data-base-invalida'));
});
