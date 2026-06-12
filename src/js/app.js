// UI da Calculadora Judicial de Pensão Alimentícia.
// Orquestra modelo (model.js), motor (engine.js), PDF (pdf.js) e o
// backend (backend.js — Tauri ou modo protótipo no navegador).

import { calcular, NOME_RITO } from './engine.js';
import {
  novoCalculo, validarCalculo, duplicarCalculo, ritosDoCalculo,
  nomeArquivoPdf, resumoCalculo,
} from './model.js';
import { gerarPdfRito, moedaBR, competenciaBR, dataBR } from './pdf.js';
import * as backend from './backend.js';

// ----------------------------- estado --------------------------------------
let calculo = novoCalculo();
let baseIndices = { correcao: {}, taxaLegal: {}, salarioMinimo: [] };
let prefs = {};
let resultado = null;
let desfazerPilha = []; // [{ chave, campo, anterior }]
let biblioteca = [];

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...filhos) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  for (const f of filhos) if (f != null) n.append(f);
  return n;
};

function toast(msg, erro = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('erro', erro);
  t.classList.remove('oculto');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('oculto'), 4200);
}

function parseValor(s) {
  if (typeof s === 'number') return s;
  let t = String(s).trim().replace(/\s|R\$/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

// ------------------------ snapshot de índices -------------------------------
function snapshotDaBase() {
  return structuredClone({
    correcao: baseIndices.correcao || {},
    taxaLegal: baseIndices.taxaLegal || {},
    salarioMinimo: baseIndices.salarioMinimo || [],
  });
}

const snapshotAtivo = () => calculo.indicesSnapshot || snapshotDaBase();

// ------------------------- formulário ↔ modelo ------------------------------
function lerParametros() {
  calculo.processo = {
    num: $('pNum').value.trim(),
    orgao: $('pOrgao').value.trim(),
    requerente: $('pRequerente').value.trim(),
    requerido: $('pRequerido').value.trim(),
  };
  calculo.config = {
    ...calculo.config,
    dataBase: $('cDataBase').value,
    juros: $('cJuros').value,
    jurosFixoMensal: Number($('cJurosFixo').value) || 0,
    multaDescumprimentoPct: Number($('cMultaPct').value) || 0,
    honorariosPct: Number($('cHonPct').value) || 0,
    multa523: $('cMulta523').checked,
    honorarios523: $('cHon523').checked,
    observacoes: $('cObs').value.trim(),
  };
}

function preencherFormulario() {
  $('pNum').value = calculo.processo.num || '';
  $('pOrgao').value = calculo.processo.orgao || '';
  $('pRequerente').value = calculo.processo.requerente || '';
  $('pRequerido').value = calculo.processo.requerido || '';
  $('cDataBase').value = calculo.config.dataBase || '';
  $('cJuros').value = calculo.config.juros || 'legais';
  $('cJurosFixo').value = calculo.config.jurosFixoMensal ?? 1;
  $('cMultaPct').value = calculo.config.multaDescumprimentoPct ?? 0;
  $('cHonPct').value = calculo.config.honorariosPct ?? 0;
  $('cMulta523').checked = !!calculo.config.multa523;
  $('cHon523').checked = !!calculo.config.honorarios523;
  $('cObs').value = calculo.config.observacoes || '';
  atualizarVisibilidades();
}

function atualizarVisibilidades() {
  $('rotJurosFixo').classList.toggle('oculto', $('cJuros').value !== 'fixo');
  // consectários só quando houver valor devido pela expropriação (RF-1)
  const temExprop = ritosDoCalculo(calculo).includes('exprop');
  $('consectarios').classList.toggle('oculto', !temExprop);
  $('rotVdValor').firstChild.textContent =
    $('vdForma').value === 'sm' ? '% do salário mínimo ' : 'Valor (R$) ';
  const periodo = $('pgTipo').value === 'periodo';
  $('rotPgData').classList.toggle('oculto', periodo);
  $('rotPgDe').classList.toggle('oculto', !periodo);
  $('rotPgAte').classList.toggle('oculto', !periodo);
}

// --------------------------- valores devidos (RF-2) -------------------------
function renderValoresDevidos() {
  const tbl = $('tblVD');
  const corpo = tbl.querySelector('tbody');
  corpo.replaceChildren();
  tbl.classList.toggle('oculto', calculo.valoresDevidos.length === 0);
  for (const vd of calculo.valoresDevidos) {
    const comp = vd.ate && vd.ate !== vd.de
      ? `${competenciaBR(vd.de)} a ${competenciaBR(vd.ate)}`
      : competenciaBR(vd.de);
    const valor = vd.forma === 'sm'
      ? `${String(vd.valor).replace('.', ',')}% do SM`
      : `R$ ${moedaBR(Number(vd.valor))}`;
    corpo.append(el('tr', {},
      el('td', {}, el('span', { class: `tag ${vd.rito}`, text: vd.rito === 'prisao' ? 'Prisão' : 'Exprop.' })),
      el('td', { text: comp }),
      el('td', { text: vd.forma === 'sm' ? '% do salário mínimo' : 'Valor fixo' }),
      el('td', { class: 'num', text: valor }),
      el('td', { text: vd.descricao || '' }),
      el('td', {},
        el('button', { class: 'mini suave', text: 'Editar', onclick: () => editarVD(vd.id) }),
        ' ',
        el('button', { class: 'mini perigo', text: 'Excluir', onclick: () => excluirVD(vd.id) }),
      ),
    ));
  }
}

function editarVD(id) {
  const vd = calculo.valoresDevidos.find((v) => v.id === id);
  if (!vd) return;
  $('vdRito').value = vd.rito;
  $('vdDe').value = vd.de;
  $('vdAte').value = vd.ate || '';
  $('vdForma').value = vd.forma;
  $('vdValor').value = vd.valor;
  $('vdDesc').value = vd.descricao || '';
  calculo.valoresDevidos = calculo.valoresDevidos.filter((v) => v.id !== id);
  aposMudanca();
  $('vdValor').focus();
}

function excluirVD(id) {
  calculo.valoresDevidos = calculo.valoresDevidos.filter((v) => v.id !== id);
  aposMudanca();
}

$('formVD').addEventListener('submit', (e) => {
  e.preventDefault();
  const de = $('vdDe').value;
  const ate = $('vdAte').value || null;
  const valor = parseValor($('vdValor').value);
  if (!de || !valor || valor <= 0) return toast('Informe a competência e um valor válido.', true);
  if (ate && ate < de) return toast('"Até" não pode ser anterior a "De".', true);
  calculo.valoresDevidos.push({
    id: crypto.randomUUID(),
    rito: $('vdRito').value,
    de, ate,
    forma: $('vdForma').value,
    valor,
    descricao: $('vdDesc').value.trim(),
  });
  $('formVD').reset();
  aposMudanca();
});

// ----------------------------- pagamentos (RF-3) ----------------------------
function renderPagamentos() {
  const tbl = $('tblPg');
  const corpo = tbl.querySelector('tbody');
  corpo.replaceChildren();
  tbl.classList.toggle('oculto', calculo.pagamentos.length === 0);
  const nomeImputacao = { auto: 'Automática', exprop: 'Expropriação', prisao: 'Prisão' };
  for (const pg of calculo.pagamentos) {
    const quando = pg.tipo === 'periodo'
      ? `${competenciaBR(pg.de)} a ${competenciaBR(pg.ate || pg.de)} (mensal)`
      : dataBR(new Date(pg.data + 'T12:00:00'));
    corpo.append(el('tr', {},
      el('td', { text: quando }),
      el('td', { class: 'num', text: `R$ ${moedaBR(Number(pg.valor))}` }),
      el('td', { text: nomeImputacao[pg.rito || 'auto'] }),
      el('td', { text: pg.descricao || '' }),
      el('td', {},
        el('button', { class: 'mini suave', text: 'Editar', onclick: () => editarPg(pg.id) }),
        ' ',
        el('button', { class: 'mini perigo', text: 'Excluir', onclick: () => excluirPg(pg.id) }),
      ),
    ));
  }
}

function editarPg(id) {
  const pg = calculo.pagamentos.find((p) => p.id === id);
  if (!pg) return;
  $('pgTipo').value = pg.tipo;
  $('pgData').value = pg.data || '';
  $('pgDe').value = pg.de || '';
  $('pgAte').value = pg.ate || '';
  $('pgValor').value = pg.valor;
  $('pgRito').value = pg.rito || 'auto';
  $('pgDesc').value = pg.descricao || '';
  calculo.pagamentos = calculo.pagamentos.filter((p) => p.id !== id);
  atualizarVisibilidades();
  aposMudanca();
  $('pgValor').focus();
}

function excluirPg(id) {
  calculo.pagamentos = calculo.pagamentos.filter((p) => p.id !== id);
  aposMudanca();
}

$('formPg').addEventListener('submit', (e) => {
  e.preventDefault();
  const tipo = $('pgTipo').value;
  const valor = parseValor($('pgValor').value);
  if (!valor || valor <= 0) return toast('Informe um valor válido.', true);
  const pg = {
    id: crypto.randomUUID(),
    tipo,
    valor,
    rito: $('pgRito').value,
    descricao: $('pgDesc').value.trim(),
  };
  if (tipo === 'periodo') {
    if (!$('pgDe').value) return toast('Informe o início do período.', true);
    pg.de = $('pgDe').value;
    pg.ate = $('pgAte').value || null;
    if (pg.ate && pg.ate < pg.de) return toast('"Até" não pode ser anterior a "De".', true);
  } else {
    if (!$('pgData').value) return toast('Informe a data do pagamento.', true);
    pg.data = $('pgData').value;
  }
  calculo.pagamentos.push(pg);
  $('formPg').reset();
  atualizarVisibilidades();
  aposMudanca();
});

// --------------------------- demonstrativo (RF-5) ---------------------------
function renderAvisos() {
  const div = $('avisos');
  const avisos = resultado?.avisos || [];
  const grupos = new Map();
  for (const a of avisos) {
    if (a.tipo === 'data-base-invalida') { grupos.set('db', 'Informe a data-base do cálculo.'); continue; }
    const chave = `${a.tipo}:${a.serie || ''}`;
    if (!grupos.has(chave)) grupos.set(chave, new Set());
    const g = grupos.get(chave);
    if (g instanceof Set) g.add(a.ym || a.vigencia || '');
  }
  const nomes = {
    'indice-ausente:correcao': 'Sem índice de correção para',
    'indice-ausente:taxaLegal': 'Sem Taxa Legal para',
    'indice-estimado:correcao': 'Índice de correção estimado/pendente em',
    'indice-estimado:taxaLegal': 'Taxa Legal estimada/pendente em',
    'salario-minimo-ausente:': 'Sem salário mínimo vigente para',
    'salario-minimo-estimado:': 'Salário mínimo estimado/pendente usado em',
  };
  const itens = [];
  for (const [chave, val] of grupos) {
    if (typeof val === 'string') { itens.push(val); continue; }
    const meses = [...val].sort();
    const lista = meses.slice(0, 6).map(competenciaBR).join(', ') +
      (meses.length > 6 ? ` e mais ${meses.length - 6}` : '');
    itens.push(`${nomes[chave] || chave}: ${lista}. Verifique a base de índices.`);
  }
  div.classList.toggle('oculto', itens.length === 0);
  div.replaceChildren(
    el('strong', { text: 'Atenção' }),
    el('ul', {}, ...itens.map((t) => el('li', { text: t }))),
  );
}

function definirOverride(chave, campo, valor) {
  const ov = { ...(calculo.overrides[chave] || {}) };
  desfazerPilha.push({ chave, campo, anterior: ov[campo] });
  if (valor == null) delete ov[campo];
  else ov[campo] = valor;
  if (ov.valorDevido == null && ov.valorPago == null) delete calculo.overrides[chave];
  else calculo.overrides[chave] = ov;
  $('btnDesfazer').disabled = desfazerPilha.length === 0;
  aposMudanca(false);
}

$('btnDesfazer').addEventListener('click', () => {
  const ult = desfazerPilha.pop();
  if (!ult) return;
  const ov = { ...(calculo.overrides[ult.chave] || {}) };
  if (ult.anterior == null) delete ov[ult.campo];
  else ov[ult.campo] = ult.anterior;
  if (ov.valorDevido == null && ov.valorPago == null) delete calculo.overrides[ult.chave];
  else calculo.overrides[ult.chave] = ov;
  $('btnDesfazer').disabled = desfazerPilha.length === 0;
  aposMudanca(false);
});

function restaurarLinha(chave) {
  const ov = calculo.overrides[chave];
  if (!ov) return;
  for (const campo of ['valorDevido', 'valorPago']) {
    if (ov[campo] != null) desfazerPilha.push({ chave, campo, anterior: ov[campo] });
  }
  delete calculo.overrides[chave];
  $('btnDesfazer').disabled = desfazerPilha.length === 0;
  aposMudanca(false);
}

function restaurarTabela(rito) {
  for (const chave of Object.keys(calculo.overrides)) {
    if (chave.startsWith(`${rito}:`)) restaurarLinhaSemRender(chave);
  }
  $('btnDesfazer').disabled = desfazerPilha.length === 0;
  aposMudanca(false);
}

function restaurarLinhaSemRender(chave) {
  const ov = calculo.overrides[chave];
  if (!ov) return;
  for (const campo of ['valorDevido', 'valorPago']) {
    if (ov[campo] != null) desfazerPilha.push({ chave, campo, anterior: ov[campo] });
  }
  delete calculo.overrides[chave];
}

function celulaEditavel(chave, campo, linha) {
  const valorAtual = campo === 'valorDevido' ? linha.valorDevido : linha.valorPago;
  const valorCalc = campo === 'valorDevido' ? linha.valorDevidoCalc : linha.valorPagoCalc;
  const inp = el('input', {
    type: 'text', value: moedaBR(valorAtual),
    'aria-label': `${campo === 'valorDevido' ? 'Valor devido' : 'Valor pago'} de ${competenciaBR(linha.ym)}`,
  });
  inp.addEventListener('change', () => {
    const v = parseValor(inp.value);
    if (v == null || v < 0) {
      inp.value = moedaBR(valorAtual);
      return toast('Valor inválido.', true);
    }
    definirOverride(chave, campo, Math.abs(v - valorCalc) < 0.005 ? null : v);
  });
  return el('td', { class: 'num editavel' }, inp);
}

function renderDemonstrativo() {
  const div = $('resultado');
  div.replaceChildren();
  const ordem = resultado?.ordem || [];
  if (!ordem.length) {
    div.append(el('p', { class: 'vazio', text: 'Cadastre valores devidos para ver o demonstrativo.' }));
    return;
  }
  for (const rito of ordem) {
    const demo = resultado.ritos[rito];
    const bloco = el('div', { class: 'demoRito' });
    bloco.append(el('h3', {},
      el('span', { class: `tag ${rito}`, text: rito === 'prisao' ? 'Prisão' : 'Expropriação' }),
      NOME_RITO[rito],
    ));

    // Tabela I
    const temOverrideRito = Object.keys(calculo.overrides).some((c) => c.startsWith(`${rito}:`));
    bloco.append(el('div', { class: 'cabecTabela' },
      el('h4', { text: 'Tabela I — Parcelas do débito alimentar' }),
      el('button', {
        class: 'mini suave', text: 'Restaurar tabela',
        disabled: temOverrideRito ? undefined : 'disabled',
        onclick: () => restaurarTabela(rito),
      }),
    ));
    const corpoI = el('tbody');
    for (const l of demo.tabelaI) {
      const chave = `${rito}:${l.ym}`;
      const tr = el('tr', { class: l.override ? 'editada' : '' },
        el('td', { text: competenciaBR(l.ym) }),
        celulaEditavel(chave, 'valorDevido', l),
        celulaEditavel(chave, 'valorPago', l),
        el('td', { class: 'num', text: moedaBR(l.saldo) }),
        el('td', { class: 'num', text: l.fator.toFixed(7).replace('.', ',') }),
        el('td', { class: 'num', text: moedaBR(l.valorCorrigido) }),
        el('td', { class: 'num', text: l.jurosPct.toFixed(4).replace('.', ',') }),
        el('td', { class: 'num', text: moedaBR(l.juros) }),
        el('td', { class: 'num', text: moedaBR(l.total) }),
        el('td', {}, l.override
          ? el('button', { class: 'mini suave', text: 'Restaurar', onclick: () => restaurarLinha(chave) })
          : null),
      );
      corpoI.append(tr);
    }
    bloco.append(el('table', { class: 'demo' },
      el('thead', {}, el('tr', {},
        ...['Competência', 'Valor Devido', 'Valor Pago', 'Saldo', 'Fator', 'Corrigido', 'Juros %', 'Juros R$', 'Total', '']
          .map((t, i) => el('th', { class: i >= 1 && i <= 8 ? 'num' : '', text: t })),
      )),
      corpoI,
      el('tfoot', {}, el('tr', {},
        el('td', { colspan: '8', text: 'Subtotal 01 — total das parcelas' }),
        el('td', { class: 'num', text: moedaBR(demo.totais.subtotal01) }),
        el('td'),
      )),
    ));

    // Tabela II
    if (demo.tabelaII.length) {
      bloco.append(el('h4', { text: 'Tabela II — Pagamentos fora do intervalo (corrigidos)' }));
      const corpoII = el('tbody');
      for (const l of demo.tabelaII) {
        const chave = `${rito}:fora:${l.ym}`;
        corpoII.append(el('tr', { class: l.override ? 'editada' : '' },
          el('td', { text: competenciaBR(l.ym) }),
          celulaEditavel(chave, 'valorPago', l),
          el('td', { class: 'num', text: l.fator.toFixed(7).replace('.', ',') }),
          el('td', { class: 'num', text: moedaBR(l.valorCorrigido) }),
          el('td', {}, l.override
            ? el('button', { class: 'mini suave', text: 'Restaurar', onclick: () => restaurarLinha(chave) })
            : null),
        ));
      }
      bloco.append(el('table', { class: 'demo' },
        el('thead', {}, el('tr', {},
          ...['Competência', 'Valor Pago', 'Fator', 'Valor Atualizado', '']
            .map((t, i) => el('th', { class: i >= 1 && i <= 3 ? 'num' : '', text: t })),
        )),
        corpoII,
      ));
    }

    // Totalização
    const t = demo.totais;
    const linhas = [];
    const linha = (rotulo, valor, geral = false) =>
      linhas.push(el('tr', { class: geral ? 'geral' : '' },
        el('td', { text: rotulo }),
        el('td', { class: 'num', text: `R$ ${moedaBR(valor)}` }),
      ));
    if (rito === 'exprop') {
      linha('Subtotal 01 — total das parcelas (Tabela I)', t.subtotal01);
      linha(`(+) Multa por descumprimento (${t.multaDescumprimentoPct}%)`, t.multaDescumprimento);
      linha('Subtotal 02', t.subtotal02);
      linha(`(+) Honorários advocatícios (${t.honorariosPct}%)`, t.honorarios);
      linha('Subtotal 03', t.subtotal03);
      linha('(+) Multa 10% — art. 523, § 1º', t.multa523);
      linha('(+) Honorários 10% — art. 523, § 1º', t.honorarios523);
      linha('Subtotal 04', t.subtotal04);
      linha('(−) Pagamentos fora do intervalo (corrigidos)', t.pagamentosFora);
      linha('TOTAL GERAL', t.totalGeral, true);
    } else {
      linha('Subtotal 01 — total das parcelas (Tabela I)', t.subtotal01);
      linha('(−) Pagamentos fora do intervalo (corrigidos)', t.pagamentosFora);
      linha('TOTAL GERAL', t.totalGeral, true);
    }
    bloco.append(el('div', { class: 'totalizacao' }, el('table', {}, ...linhas)));
    div.append(bloco);
  }
}

// ------------------------------ recálculo -----------------------------------
function aposMudanca(lerForm = true) {
  if (lerForm) lerParametros();
  resultado = calcular(calculo, snapshotAtivo());
  renderValoresDevidos();
  renderPagamentos();
  renderDemonstrativo();
  renderAvisos();
  atualizarVisibilidades();
}

for (const id of ['pNum', 'pOrgao', 'pRequerente', 'pRequerido', 'cDataBase', 'cJuros',
  'cJurosFixo', 'cMultaPct', 'cHonPct', 'cMulta523', 'cHon523', 'cObs']) {
  $(id).addEventListener('change', () => aposMudanca());
}
$('vdForma').addEventListener('change', atualizarVisibilidades);
$('pgTipo').addEventListener('change', atualizarVisibilidades);

// --------------------------- salvar / PDF / novo ----------------------------
async function salvar() {
  lerParametros();
  if (!calculo.config.dataBase) return toast('Informe a data-base antes de salvar.', true);
  if (!calculo.indicesSnapshot) calculo.indicesSnapshot = snapshotDaBase();
  try {
    await backend.salvarCalculo(calculo);
    toast('Cálculo salvo.');
    await carregarBiblioteca();
  } catch (e) {
    toast(`Erro ao salvar: ${e.message || e}`, true);
  }
}
$('btnSalvar').addEventListener('click', salvar);

$('btnPdf').addEventListener('click', async () => {
  lerParametros();
  resultado = calcular(calculo, snapshotAtivo());
  const ordem = resultado.ordem;
  if (!ordem.length) return toast('Não há demonstrativo para gerar.', true);
  const doisRitos = ordem.length > 1;
  const gerados = [];
  try {
    for (const rito of ordem) {
      const bytes = gerarPdfRito(calculo, resultado.ritos[rito]);
      const nome = nomeArquivoPdf(calculo, rito, doisRitos);
      gerados.push(await backend.salvarPdf(nome, bytes));
    }
    toast(`PDF gerado: ${gerados.join(' | ')}`);
  } catch (e) {
    toast(`Erro ao gerar PDF: ${e.message || e}`, true);
  }
});

function novo() {
  calculo = novoCalculo();
  desfazerPilha = [];
  resultado = null;
  $('btnDesfazer').disabled = true;
  $('formVD').reset();
  $('formPg').reset();
  preencherFormulario();
  aposMudanca();
  marcarAtivo(null);
}
$('btnNovo').addEventListener('click', novo);

// ----------------------------- biblioteca (RF-7) ----------------------------
async function carregarBiblioteca() {
  try {
    const calcs = await backend.listarCalculos();
    biblioteca = calcs.map((c) => (c.processo && typeof c.processo === 'object' ? resumoCalculo(c) : c));
  } catch (e) {
    biblioteca = [];
    toast(`Erro ao ler a biblioteca: ${e.message || e}`, true);
  }
  renderBiblioteca();
}

function renderBiblioteca() {
  const ul = $('listaCalculos');
  ul.replaceChildren();
  const filtro = $('buscaBiblioteca').value.trim().toLowerCase();
  const visiveis = biblioteca.filter((c) => {
    if (!filtro) return true;
    return [c.processo, c.requerente, c.requerido]
      .some((s) => (s || '').toLowerCase().includes(filtro));
  });
  if (!visiveis.length) {
    ul.append(el('li', { class: 'vazioBiblioteca', text: filtro ? 'Nada encontrado.' : 'Nenhum cálculo salvo ainda.' }));
    return;
  }
  for (const c of visiveis) {
    const li = el('li', { 'data-id': c.id, tabindex: '0', role: 'button' },
      el('div', { class: 'proc', text: c.processo || '(sem nº de processo)' }),
      el('div', { class: 'partes', text: `${c.requerente || '—'} × ${c.requerido || '—'}` }),
      el('div', {}, ...c.ritos.map((r) =>
        el('span', { class: `tag ${r}`, text: r === 'prisao' ? 'Prisão' : 'Exprop.' }))),
      el('div', { class: 'acoesItem' },
        el('button', { text: 'Abrir', onclick: (e) => { e.stopPropagation(); abrir(c.id); } }),
        el('button', { text: 'Duplicar', onclick: (e) => { e.stopPropagation(); duplicar(c.id); } }),
        el('button', { text: 'Excluir', onclick: (e) => { e.stopPropagation(); excluir(c.id); } }),
      ),
    );
    li.addEventListener('click', () => abrir(c.id));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') abrir(c.id); });
    if (c.id === calculo.id) li.classList.add('ativo');
    ul.append(li);
  }
}
$('buscaBiblioteca').addEventListener('input', renderBiblioteca);

function marcarAtivo(id) {
  for (const li of $('listaCalculos').children) {
    li.classList.toggle('ativo', li.getAttribute('data-id') === id);
  }
}

async function abrir(id) {
  try {
    calculo = validarCalculo(await backend.carregarCalculo(id));
    desfazerPilha = [];
    $('btnDesfazer').disabled = true;
    preencherFormulario();
    aposMudanca();
    marcarAtivo(id);
  } catch (e) {
    toast(`Erro ao abrir: ${e.message || e}`, true);
  }
}

async function duplicar(id) {
  try {
    const copia = duplicarCalculo(validarCalculo(await backend.carregarCalculo(id)));
    await backend.salvarCalculo(copia);
    await carregarBiblioteca();
    toast('Cálculo duplicado.');
  } catch (e) {
    toast(`Erro ao duplicar: ${e.message || e}`, true);
  }
}

async function excluir(id) {
  if (!window.confirm('Excluir este cálculo definitivamente?')) return;
  try {
    await backend.excluirCalculo(id);
    if (calculo.id === id) novo();
    await carregarBiblioteca();
    toast('Cálculo excluído.');
  } catch (e) {
    toast(`Erro ao excluir: ${e.message || e}`, true);
  }
}

// --------------------------- configurações ----------------------------------
$('btnConfig').addEventListener('click', () => {
  $('cfgPastaCalc').value = prefs.pastaCalculos || '';
  $('cfgPastaPdf').value = prefs.pastaPdf || '';
  $('cfgAutoAtualiza').checked = prefs.atualizacaoAutomatica !== false;
  $('cfgPorta').value = prefs.portaEntrada || 48591;
  $('dlgConfig').showModal();
});

$('dlgConfig').addEventListener('close', async () => {
  if ($('dlgConfig').returnValue !== 'default') return;
  prefs = {
    ...prefs,
    pastaCalculos: $('cfgPastaCalc').value.trim(),
    pastaPdf: $('cfgPastaPdf').value.trim(),
    atualizacaoAutomatica: $('cfgAutoAtualiza').checked,
    portaEntrada: Number($('cfgPorta').value) || 48591,
  };
  try {
    await backend.salvarPreferencias(prefs);
    toast('Configurações salvas.');
    await carregarBiblioteca();
  } catch (e) {
    toast(`Erro ao salvar configurações: ${e.message || e}`, true);
  }
});

// ------------------------- base de índices (RF-4) ---------------------------
function renderIndices() {
  const serie = $('serieIndices').value;
  const div = $('tabelaIndices');
  div.replaceChildren();
  const statusSpan = (st) => el('span', {
    class: st === 'oficial' ? 'statusOficial' : 'statusEstimado',
    text: st === 'oficial' ? 'oficial' : (st || 'estimado'),
  });

  const aoEditar = (obj, campoValor) => (e) => {
    const v = parseValor(e.target.value);
    if (v == null) return toast('Valor inválido.', true);
    obj[campoValor] = v;
    obj.status = 'estimado'; // edição manual não vira "oficial" sem registro
    obj.fonte = 'editado manualmente';
    obj.atualizadoEm = new Date().toISOString();
    backend.salvarIndices(baseIndices).catch((err) => toast(String(err), true));
    if (!calculo.indicesSnapshot) aposMudanca(false);
    renderIndices();
  };

  if (serie === 'salarioMinimo') {
    const tbl = el('table', {}, el('thead', {}, el('tr', {},
      ...['Vigência', 'Valor (R$)', 'Status', 'Fonte'].map((t) => el('th', { text: t })))));
    const corpo = el('tbody');
    const lista = [...(baseIndices.salarioMinimo || [])].sort((a, b) => b.vigencia.localeCompare(a.vigencia));
    for (const sm of lista) {
      const inp = el('input', { type: 'text', value: moedaBR(sm.valor) });
      inp.addEventListener('change', aoEditar(sm, 'valor'));
      corpo.append(el('tr', {},
        el('td', { text: competenciaBR(sm.vigencia) }),
        el('td', {}, inp),
        el('td', {}, statusSpan(sm.status)),
        el('td', { text: sm.fonte || '' }),
      ));
    }
    tbl.append(corpo);
    div.append(tbl);
    return;
  }

  const mapa = baseIndices[serie] || {};
  const meses = Object.keys(mapa).sort().reverse();
  if (!meses.length) {
    div.append(el('p', { class: 'vazio', text: 'Série vazia — use "Buscar atualizações" ou semeie a base (scripts/seed-indices.mjs).' }));
    return;
  }
  const tbl = el('table', {}, el('thead', {}, el('tr', {},
    ...['Competência', '% no mês', 'Status', 'Fonte'].map((t) => el('th', { text: t })))));
  const corpo = el('tbody');
  for (const ym of meses) {
    const item = mapa[ym];
    const inp = el('input', { type: 'text', value: String(item.valor).replace('.', ',') });
    inp.addEventListener('change', aoEditar(item, 'valor'));
    corpo.append(el('tr', {},
      el('td', { text: competenciaBR(ym) }),
      el('td', {}, inp),
      el('td', {}, statusSpan(item.status)),
      el('td', { text: item.fonte || '' }),
    ));
  }
  tbl.append(corpo);
  div.append(tbl);
}

$('btnIndices').addEventListener('click', () => { renderIndices(); $('dlgIndices').showModal(); });
$('btnFecharIndices').addEventListener('click', () => $('dlgIndices').close());
$('serieIndices').addEventListener('change', renderIndices);

$('btnAtualizarIndices').addEventListener('click', async () => {
  $('statusIndices').textContent = 'Buscando…';
  try {
    const r = await backend.atualizarIndices();
    if (r?.ok === false) {
      $('statusIndices').textContent = r.mensagem || 'Indisponível.';
    } else {
      baseIndices = await backend.obterIndices();
      $('statusIndices').textContent = `Atualizado: ${r?.adicionados ?? 0} valor(es) novo(s).`;
      renderIndices();
      if (!calculo.indicesSnapshot) aposMudanca(false);
    }
  } catch (e) {
    $('statusIndices').textContent = `Falha: ${e.message || e}`;
  }
});

// ------------------------ porta de entrada (RF-9) ---------------------------
backend.aoPreencherProcesso((payload) => {
  if (!payload) return;
  $('pNum').value = payload.processo || $('pNum').value;
  $('pOrgao').value = payload.orgao || $('pOrgao').value;
  $('pRequerente').value = payload.requerente || $('pRequerente').value;
  $('pRequerido').value = payload.requerido || $('pRequerido').value;
  aposMudanca();
  toast('Dados do processo recebidos.');
});

// ------------------------------- inicialização ------------------------------
async function iniciar() {
  $('seloPrototipo').classList.toggle('oculto', backend.ehTauri);
  try { prefs = (await backend.obterPreferencias()) || {}; } catch { prefs = {}; }
  try { baseIndices = await backend.obterIndices(); } catch { /* base vazia */ }
  preencherFormulario();
  aposMudanca();
  await carregarBiblioteca();
  // RNF-3 — atualização automática silenciosa quando houver internet
  if (backend.ehTauri && prefs.atualizacaoAutomatica !== false) {
    backend.atualizarIndices().then(async (r) => {
      if (r?.adicionados) {
        baseIndices = await backend.obterIndices();
        if (!calculo.indicesSnapshot) aposMudanca(false);
        toast(`Base de índices atualizada (${r.adicionados} valor(es)).`);
      }
    }).catch(() => { /* falha de rede não interrompe o uso */ });
  }
}

iniciar();
