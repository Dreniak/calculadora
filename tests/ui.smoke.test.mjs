// Teste de fumaça da UI (jsdom): carrega index.html, importa app.js em modo
// protótipo (sem Tauri) e percorre o fluxo principal — lançar valor devido,
// pagamento, editar inline, desfazer e restaurar (RF-2/RF-3/RF-5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

async function montarApp() {
  const html = readFileSync(join(raiz, 'src', 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/src/index.html', pretendToBeVisual: true });
  const { window } = dom;
  for (const k of ['document', 'window', 'localStorage', 'HTMLElement', 'Node']) {
    globalThis[k] = window[k] ?? window;
  }
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  // fetch do seed falha no jsdom — o app deve seguir com base vazia
  globalThis.window.fetch = () => Promise.reject(new Error('sem rede'));
  window.confirm = () => true;
  await import('../src/js/app.js');
  await new Promise((r) => setTimeout(r, 30)); // iniciar() é assíncrono
  return window;
}

function definirCampo(doc, id, valor) {
  const campo = doc.getElementById(id);
  campo.value = valor;
  campo.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test('fluxo principal no navegador (modo protótipo)', async () => {
  const win = await montarApp();
  const doc = win.document;

  // modo protótipo sinalizado
  assert.ok(!doc.getElementById('seloPrototipo').classList.contains('oculto'));

  // parâmetros
  definirCampo(doc, 'pNum', '0001234-56.2024.8.27.2729');
  definirCampo(doc, 'cDataBase', '2025-06');
  definirCampo(doc, 'cJuros', 'sem');

  // valor devido: 3 parcelas de 500 pela expropriação
  doc.getElementById('vdRito').value = 'exprop';
  doc.getElementById('vdDe').value = '2025-04';
  doc.getElementById('vdAte').value = '2025-06';
  doc.getElementById('vdForma').value = 'fixo';
  doc.getElementById('vdValor').value = '500';
  doc.getElementById('formVD').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));

  // campos de consectários integrados à seção 1 (RF-1)
  assert.ok(doc.getElementById('cMultaPct'));
  assert.ok(doc.getElementById('cMulta523'));

  // pagamento dentro do período
  doc.getElementById('pgTipo').value = 'data';
  doc.getElementById('pgData').value = '2025-05-10';
  doc.getElementById('pgValor').value = '200';
  doc.getElementById('formPg').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));

  // demonstrativo renderizado com 3 linhas na Tabela I
  const tabelas = doc.querySelectorAll('#resultado table.demo');
  assert.ok(tabelas.length >= 1, 'Tabela I deveria existir');
  const linhas = tabelas[0].querySelectorAll('tbody tr');
  assert.equal(linhas.length, 3);

  // total geral = 1500 - 200 (sem juros, sem correção pois base vazia)
  const totalGeral = doc.querySelector('#resultado .totalizacao tr.geral td.num').textContent;
  assert.equal(totalGeral, 'R$ 1.300,00');

  // edição inline do valor devido de 04/2025 → 600 (RF-5)
  const inputDevido = linhas[0].querySelector('td.editavel input');
  inputDevido.value = '600,00';
  inputDevido.dispatchEvent(new win.Event('change', { bubbles: true }));
  let geral = doc.querySelector('#resultado .totalizacao tr.geral td.num').textContent;
  assert.equal(geral, 'R$ 1.400,00');
  assert.ok(doc.querySelector('#resultado tr.editada'), 'linha editada deve ser marcada');

  // desfazer (RF-5) — botão renderizado no cabeçalho da Tabela I quando há edição
  const btnDesfazer = doc.querySelector('#resultado .btnDesfazer');
  assert.ok(btnDesfazer, 'botão Desfazer deve aparecer após edição');
  btnDesfazer.click();
  geral = doc.querySelector('#resultado .totalizacao tr.geral td.num').textContent;
  assert.equal(geral, 'R$ 1.300,00');

  // salvar e listar na biblioteca (RF-7/RF-8, localStorage no protótipo)
  doc.getElementById('btnSalvar').click();
  await new Promise((r) => setTimeout(r, 20));
  const itens = doc.querySelectorAll('#listaCalculos li[data-id]');
  assert.equal(itens.length, 1);
  assert.match(itens[0].textContent, /0001234-56/);
});
