// Testes do modelo de dados (Seção 9, RF-6/RF-7/RF-8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  novoCalculo, validarCalculo, duplicarCalculo, ritosDoCalculo,
  nomeArquivoPdf, resumoCalculo,
} from '../src/js/model.js';

test('novo cálculo tem UUID e padrões coerentes', () => {
  const c = novoCalculo();
  assert.match(c.id, /^[0-9a-f-]{36}$/);
  assert.equal(c.config.juros, 'legais');
  assert.match(c.config.dataBase, /^\d{4}-\d{2}$/);
  assert.deepEqual(c.valoresDevidos, []);
});

test('validarCalculo normaliza arquivo parcial e rejeita inválido', () => {
  const ok = validarCalculo({ id: 'abc', processo: { num: '1' } });
  assert.equal(ok.processo.num, '1');
  assert.equal(ok.config.juros, 'legais');
  assert.deepEqual(ok.pagamentos, []);
  assert.throws(() => validarCalculo(null));
  assert.throws(() => validarCalculo({ processo: {} }));
});

test('duplicar gera novo UUID preservando conteúdo', () => {
  const c = novoCalculo();
  c.processo.num = '0001';
  const d = duplicarCalculo(c);
  assert.notEqual(d.id, c.id);
  assert.equal(d.processo.num, '0001');
});

test('ritos inferidos dos valores devidos (RF-2)', () => {
  const c = novoCalculo();
  assert.deepEqual(ritosDoCalculo(c), []);
  c.valoresDevidos.push({ rito: 'prisao' }, { rito: 'prisao' });
  assert.deepEqual(ritosDoCalculo(c), ['prisao']);
  c.valoresDevidos.push({ rito: 'exprop' });
  assert.deepEqual(ritosDoCalculo(c), ['exprop', 'prisao']);
});

test('nome do PDF: processo, fallback requerente, fallback ID; sufixo de rito', () => {
  const c = novoCalculo();
  c.id = 'uuid-1';
  c.processo.num = '0001234-56.2024.8.27.2729';
  assert.equal(nomeArquivoPdf(c, 'exprop', false), '0001234-56.2024.8.27.2729 - uuid-1.pdf');
  assert.equal(nomeArquivoPdf(c, 'prisao', true), '0001234-56.2024.8.27.2729 - uuid-1 - prisao.pdf');
  c.processo.num = '';
  c.processo.requerente = 'Fulana de Tal';
  assert.equal(nomeArquivoPdf(c, null, false), 'Fulana de Tal - uuid-1.pdf');
  c.processo.requerente = '';
  assert.equal(nomeArquivoPdf(c, null, false), 'uuid-1.pdf');
});

test('nome do PDF remove caracteres inválidos no Windows (§13)', () => {
  const c = novoCalculo();
  c.id = 'u';
  c.processo.num = 'a<b>c:d"e/f\\g|h?i*j';
  assert.ok(!/[<>:"/\\|?*]/.test(nomeArquivoPdf(c, null, false).replace('.pdf', '')));
});

test('resumo para a biblioteca (RF-7)', () => {
  const c = novoCalculo();
  c.processo = { num: '01', orgao: 'V', requerente: 'A', requerido: 'B' };
  c.valoresDevidos.push({ rito: 'exprop' });
  const r = resumoCalculo(c);
  assert.equal(r.processo, '01');
  assert.deepEqual(r.ritos, ['exprop']);
});
