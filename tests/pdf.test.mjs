// Testes do gerador de PDF (RF-6): estrutura do arquivo, xref, paginação
// e formatação pt-BR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcular, ymToNum, numToYm } from '../src/js/engine.js';
import { gerarPdfRito, moedaBR, competenciaBR, fatorBR } from '../src/js/pdf.js';

function snapshot() {
  const correcao = {};
  const taxaLegal = {};
  for (let n = ymToNum('2020-01'); n <= ymToNum('2026-12'); n++) {
    correcao[numToYm(n)] = { valor: 0.5, status: 'oficial' };
  }
  for (let n = ymToNum('2024-08'); n <= ymToNum('2026-12'); n++) {
    taxaLegal[numToYm(n)] = { valor: 0.9, status: 'oficial' };
  }
  return { correcao, taxaLegal, salarioMinimo: [{ vigencia: '2020-01', valor: 1412, status: 'oficial' }] };
}

function calculoDemo() {
  return {
    id: '6f1d3c0a-0000-4000-8000-000000000001',
    processo: {
      num: '0001234-56.2024.8.27.2729',
      orgao: '1ª Vara de Família de Palmas',
      requerente: 'Fulana de Tal',
      requerido: 'Beltrano de Tal',
    },
    config: {
      dataBase: '2026-05',
      juros: 'legais',
      jurosFixoMensal: 1,
      multaDescumprimentoPct: 10,
      honorariosPct: 10,
      multa523: true,
      honorarios523: true,
      observacoes: 'Cálculo de demonstração.',
    },
    valoresDevidos: [
      { id: 'v1', rito: 'exprop', de: '2022-01', ate: '2025-12', forma: 'sm', valor: 30 },
      { id: 'v2', rito: 'prisao', de: '2026-01', ate: '2026-03', forma: 'fixo', valor: 500 },
    ],
    pagamentos: [
      { id: 'p1', tipo: 'data', data: '2022-05-10', valor: 200 },
      { id: 'p2', tipo: 'data', data: '2021-03-10', valor: 150 },
    ],
    overrides: { 'exprop:2022-03': { valorPago: 50 } },
  };
}

test('formatadores pt-BR', () => {
  assert.equal(moedaBR(1234567.5), '1.234.567,50');
  assert.equal(moedaBR(-42.005), '-42,01');
  assert.equal(competenciaBR('2025-03'), '03/2025');
  assert.equal(fatorBR(1.0123456), '1,0123456');
});

function textoPdf(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

test('PDF da expropriação: estrutura válida, xref e conteúdo', () => {
  const calc = calculoDemo();
  const r = calcular(calc, snapshot());
  const bytes = gerarPdfRito(calc, r.ritos.exprop, { agora: new Date('2026-06-12T12:00:00') });
  const s = textoPdf(bytes);

  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));

  // xref aponta para a tabela de referências
  const startxref = Number(s.match(/startxref\n(\d+)\n/)[1]);
  assert.equal(s.slice(startxref, startxref + 4), 'xref');

  // offsets do xref apontam para os objetos certos
  const linhas = s.slice(startxref).split('\n');
  const n = Number(linhas[1].split(' ')[1]);
  for (let i = 1; i < n; i++) {
    const off = Number(linhas[2 + i].split(' ')[0]);
    assert.equal(s.slice(off, off + `${i} 0 obj`.length), `${i} 0 obj`);
  }

  // 48 parcelas + tabela II + totalização => mais de uma página
  const nPaginas = (s.match(/\/Type \/Page[^s]/g) || []).length;
  assert.ok(nPaginas >= 2, `esperava 2+ páginas, veio ${nPaginas}`);

  // conteúdo essencial
  for (const trecho of [
    'Tabela I', 'Tabela II', 'TOTAL GERAL', 'art. 523',
    '0001234-56.2024.8.27.2729', 'Fulana de Tal',
    'ajustado manualmente', // nota do override
    'P\\xe1gina 1 de'.replace('\\xe1', String.fromCharCode(0xe1)),
  ]) {
    assert.ok(s.includes(trecho), `PDF deveria conter "${trecho}"`);
  }
});

test('PDF da prisão: multa/honorários incidem, mas sem o art. 523', () => {
  const calc = calculoDemo();
  const r = calcular(calc, snapshot());
  const bytes = gerarPdfRito(calc, r.ritos.prisao, { agora: new Date('2026-06-12T12:00:00') });
  const s = textoPdf(bytes);
  assert.ok(s.includes('art. 528'));
  assert.ok(s.includes('TOTAL GERAL'));
  assert.ok(s.includes('Multa por descumprimento')); // multa/honorários incidem nos dois ritos
  assert.ok(!s.includes('art. 523'));                 // multa/honorários do art. 523 só na expropriação
});
