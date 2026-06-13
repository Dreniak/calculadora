// Geração de PDF (RF-6) — gerador próprio, sem dependências externas.
// Produz um PDF por rito espelhando o demonstrativo do TJTO: cabeçalho do
// processo, Tabela I (parcelas), Tabela II (pagamentos fora do intervalo),
// totalização (Seção 8), notas explicativas e rodapé com data.
//
// O PDF usa as fontes padrão Helvetica/Helvetica-Bold com WinAnsiEncoding,
// que cobre os acentos do português. Os bytes são gravados pelo backend na
// pasta configurada, sem diálogo de impressão.

import { NOME_RITO } from './engine.js';

// ---------------------------------------------------------------------------
// Métricas Helvetica (AFM, unidades /1000) — suficientes para alinhamento.
// ---------------------------------------------------------------------------
const W_REG = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722,
  I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778,
  R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584, '§': 556, 'º': 333, 'ª': 333, '°': 400,
  '—': 1000, '–': 556, '−': 333, '…': 1000, '•': 350,
};
const W_BOLD = {
  ...W_REG,
  A: 722, B: 722, E: 667, J: 556, K: 722, L: 611, P: 667, R: 722, V: 667,
  a: 556, b: 611, c: 556, d: 611, f: 333, g: 611, h: 611, i: 278, j: 278,
  k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389, s: 556,
  t: 333, u: 611, v: 556, x: 556, y: 556,
  ' ': 278, '-': 333, ',': 278, '.': 278, ':': 333, '%': 889,
};
// acentuadas herdam a largura da letra-base
const BASES = { á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a', é: 'e', ê: 'e', í: 'i',
  ó: 'o', ô: 'o', õ: 'o', ú: 'u', ü: 'u', ç: 'c', Á: 'A', À: 'A', Â: 'A',
  Ã: 'A', É: 'E', Ê: 'E', Í: 'I', Ó: 'O', Ô: 'O', Õ: 'O', Ú: 'U', Ç: 'C' };

function larguraTexto(s, size, bold) {
  const tab = bold ? W_BOLD : W_REG;
  let w = 0;
  for (const ch of String(s)) {
    const c = BASES[ch] || ch;
    w += tab[c] ?? 556;
  }
  return (w / 1000) * size;
}

// ---------------------------------------------------------------------------
// Formatação pt-BR
// ---------------------------------------------------------------------------
export function moedaBR(v) {
  const neg = v < 0;
  const [int, dec] = Math.abs(v).toFixed(2).split('.');
  const mil = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${mil},${dec}`;
}
export const competenciaBR = (ym) => `${ym.slice(5)}/${ym.slice(0, 4)}`;
export const fatorBR = (f) => f.toFixed(7).replace('.', ',');
export const pctBR = (p, casas = 4) => p.toFixed(casas).replace('.', ',');
export function dataBR(d = new Date()) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Escritor PDF mínimo
// ---------------------------------------------------------------------------
const A4 = { w: 595.28, h: 841.89 };

// Pontuação tipográfica fora do Latin-1 mapeada para o WinAnsiEncoding
const WINANSI = {
  '—': 0x97, '–': 0x96, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85,
  '€': 0x80, '−': 0x2d,
};

function escaparPdf(s) {
  let out = '';
  for (const ch of String(s)) {
    const code = WINANSI[ch] ?? ch.codePointAt(0);
    if (ch === '\\' || ch === '(' || ch === ')') out += '\\' + ch;
    else if (code >= 32 && code <= 255) out += String.fromCharCode(code);
    else out += '?';
  }
  return out;
}

class Doc {
  constructor() {
    this.pages = []; // cada página: array de comandos do content stream
    this.addPage();
  }
  addPage() {
    this.pages.push([]);
    this.pi = this.pages.length - 1;
    return this.pi;
  }
  setPage(i) {
    this.pi = i;
  }
  get atual() {
    return this.pages[this.pi];
  }
  text(x, y, s, { size = 8, bold = false, align = 'left', maxW = null } = {}) {
    let texto = String(s);
    if (maxW != null) {
      while (texto.length > 1 && larguraTexto(texto, size, bold) > maxW) {
        texto = texto.slice(0, -1);
      }
    }
    let tx = x;
    if (align === 'right') tx = x - larguraTexto(texto, size, bold);
    else if (align === 'center') tx = x - larguraTexto(texto, size, bold) / 2;
    this.atual.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${tx.toFixed(2)} ${y.toFixed(2)} Td (${escaparPdf(texto)}) Tj ET`,
    );
  }
  line(x1, y1, x2, y2, w = 0.5) {
    this.atual.push(
      `${w} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`,
    );
  }
  rect(x, y, w, h, cinza = 0.92) {
    this.atual.push(
      `${cinza} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g`,
    );
  }
  build() {
    const latin1 = (s) => {
      const b = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
      return b;
    };
    const objs = [];
    const nPag = this.pages.length;
    // 1: catálogo, 2: árvore de páginas, 3: F1, 4: F2; páginas a partir de 5
    const fonte = (nome) =>
      `<< /Type /Font /Subtype /Type1 /BaseFont /${nome} /Encoding /WinAnsiEncoding >>`;
    const kids = this.pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${nPag} >>`;
    objs[3] = fonte('Helvetica');
    objs[4] = fonte('Helvetica-Bold');
    this.pages.forEach((cmds, i) => {
      const conteudo = cmds.join('\n');
      objs[5 + i * 2] =
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
      objs[6 + i * 2] = { stream: conteudo };
    });

    let corpo = '%PDF-1.4\n%âãÏÓ\n';
    const offsets = [];
    for (let n = 1; n < objs.length; n++) {
      offsets[n] = corpo.length;
      const o = objs[n];
      if (o && typeof o === 'object' && 'stream' in o) {
        corpo += `${n} 0 obj\n<< /Length ${o.stream.length} >>\nstream\n${o.stream}\nendstream\nendobj\n`;
      } else {
        corpo += `${n} 0 obj\n${o}\nendobj\n`;
      }
    }
    const xref = corpo.length;
    corpo += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
    for (let n = 1; n < objs.length; n++) {
      corpo += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
    }
    corpo += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return latin1(corpo);
  }
}

// ---------------------------------------------------------------------------
// Demonstrativo por rito
// ---------------------------------------------------------------------------
const MARGEM = 42;
const LARGURA = A4.w - 2 * MARGEM;
const Y_TOPO = A4.h - 46;
const Y_BASE = 56;

// Tabela I — nove colunas (larguras somam LARGURA)
const COLS_I = [
  { titulo: 'Competência', w: 62, align: 'left' },
  { titulo: 'Valor Devido', w: 58, align: 'right' },
  { titulo: 'Valor Pago', w: 56, align: 'right' },
  { titulo: 'Saldo', w: 54, align: 'right' },
  { titulo: 'Fator Corr.', w: 60, align: 'right' },
  { titulo: 'V. Corrigido', w: 60, align: 'right' },
  { titulo: 'Juros %', w: 50, align: 'right' },
  { titulo: 'Juros R$', w: 53, align: 'right' },
  { titulo: 'Total', w: 58, align: 'right' },
];
const COLS_II = [
  { titulo: 'Competência', w: 90, align: 'left' },
  { titulo: 'Valor Pago', w: 140, align: 'right' },
  { titulo: 'Fator Corr.', w: 140, align: 'right' },
  { titulo: 'Valor Atualizado', w: 141, align: 'right' },
];

function celulas(cols) {
  // posições x do conteúdo de cada coluna
  let x = MARGEM;
  return cols.map((c) => {
    const pos = { ...c, x0: x, x1: x + c.w };
    x += c.w;
    return pos;
  });
}

function cabecalhoTabela(doc, y, cols, titulo) {
  doc.text(MARGEM, y, titulo, { size: 9, bold: true });
  y -= 14;
  doc.rect(MARGEM, y - 3.5, LARGURA, 12, 0.88);
  for (const c of celulas(cols)) {
    const tx = c.align === 'right' ? c.x1 - 2 : c.x0 + 2;
    doc.text(tx, y, c.titulo, { size: 7.5, bold: true, align: c.align, maxW: c.w - 4 });
  }
  doc.line(MARGEM, y - 4, MARGEM + LARGURA, y - 4, 0.7);
  return y - 14;
}

function cabecalhoPagina(doc, calculo, demo) {
  let y = Y_TOPO;
  doc.text(A4.w / 2, y, 'DEMONSTRATIVO DE CÁLCULO', { size: 12, bold: true, align: 'center' });
  y -= 14;
  doc.text(A4.w / 2, y, 'débito alimentar', { size: 9.5, align: 'center' });
  y -= 8;
  doc.line(MARGEM, y, MARGEM + LARGURA, y, 0.8);
  y -= 16;
  const campo = (rotulo, valor) => {
    doc.text(MARGEM, y, `${rotulo}:`, { size: 8.5, bold: true });
    doc.text(MARGEM + 92, y, valor || '—', { size: 8.5, maxW: LARGURA - 92 });
    y -= 12;
  };
  campo('Processo', calculo.processo?.num);
  campo('Órgão julgador', calculo.processo?.orgao);
  campo('Requerente', calculo.processo?.requerente);
  campo('Requerido', calculo.processo?.requerido);
  campo('Data-base', competenciaBR(calculo.config.dataBase));
  doc.text(MARGEM, y, 'Rito:', { size: 8.5, bold: true });
  doc.text(MARGEM + 92, y, NOME_RITO[demo.rito], { size: 8.5, bold: true });
  y -= 10;
  doc.line(MARGEM, y, MARGEM + LARGURA, y, 0.5);
  return y - 16;
}

function novaPagina(doc, calculo, demo) {
  doc.addPage();
  return cabecalhoPagina(doc, calculo, demo);
}

/**
 * Gera o PDF de um rito. `demo` é o demonstrativo do rito retornado por
 * `calcular()`. Retorna Uint8Array com os bytes do arquivo.
 */
export function gerarPdfRito(calculo, demo, { agora = new Date() } = {}) {
  const doc = new Doc();
  let y = cabecalhoPagina(doc, calculo, demo);
  const garantir = (espaco, reabrirTabela) => {
    if (y - espaco < Y_BASE) {
      y = novaPagina(doc, calculo, demo);
      if (reabrirTabela) y = reabrirTabela();
    }
  };

  // ---- Tabela I -----------------------------------------------------------
  const cols1 = celulas(COLS_I);
  const tituloI = 'Tabela I — Parcelas do débito alimentar';
  y = cabecalhoTabela(doc, y, COLS_I, tituloI);
  for (const l of demo.tabelaI) {
    garantir(12, () => cabecalhoTabela(doc, y, COLS_I, `${tituloI} (continuação)`));
    const vals = [
      competenciaBR(l.ym),
      moedaBR(l.valorDevido),
      moedaBR(l.valorPago),
      moedaBR(l.saldo),
      fatorBR(l.fator),
      moedaBR(l.valorCorrigido),
      pctBR(l.jurosPct),
      moedaBR(l.juros),
      moedaBR(l.total),
    ];
    vals.forEach((v, i) => {
      const c = cols1[i];
      const tx = c.align === 'right' ? c.x1 - 2 : c.x0 + 2;
      doc.text(tx, y, v, { size: 7.5, align: c.align, maxW: c.w - 4 });
    });
    y -= 11;
  }
  doc.line(MARGEM, y + 7, MARGEM + LARGURA, y + 7, 0.7);
  y -= 6;

  // ---- Tabela II ----------------------------------------------------------
  if (demo.tabelaII.length) {
    garantir(60);
    const cols2 = celulas(COLS_II);
    const tituloII = 'Tabela II — Pagamentos fora do intervalo (corrigidos)';
    y = cabecalhoTabela(doc, y, COLS_II, tituloII);
    for (const l of demo.tabelaII) {
      garantir(12, () => cabecalhoTabela(doc, y, COLS_II, `${tituloII} (continuação)`));
      const vals = [
        competenciaBR(l.ym),
        moedaBR(l.valorPago),
        fatorBR(l.fator),
        moedaBR(l.valorCorrigido),
      ];
      vals.forEach((v, i) => {
        const c = cols2[i];
        const tx = c.align === 'right' ? c.x1 - 2 : c.x0 + 2;
        doc.text(tx, y, v, { size: 7.5, align: c.align, maxW: c.w - 4 });
      });
      y -= 11;
    }
    doc.line(MARGEM, y + 7, MARGEM + LARGURA, y + 7, 0.7);
    y -= 6;
  }

  // ---- Totalização (Seção 8) ---------------------------------------------
  garantir(demo.rito === 'exprop' ? 150 : 110);
  doc.text(MARGEM, y, 'Totalização', { size: 9, bold: true });
  y -= 14;
  const linhaTotal = (rotulo, valor, destaque = false) => {
    garantir(12);
    doc.text(MARGEM + 6, y, rotulo, { size: destaque ? 9 : 8.5, bold: destaque });
    doc.text(MARGEM + LARGURA - 4, y, `R$ ${moedaBR(valor)}`, {
      size: destaque ? 9 : 8.5, bold: destaque, align: 'right',
    });
    y -= 12;
  };
  const t = demo.totais;
  const tem523 = demo.rito === 'exprop' && (t.multa523 > 0 || t.honorarios523 > 0);
  if (tem523) {
    linhaTotal('Total das parcelas (Tabela I)', t.parcelas);
    linhaTotal('(+) Multa de 10% — CPC, art. 523, § 1º', t.multa523);
    linhaTotal('(+) Honorários de 10% — CPC, art. 523, § 1º', t.honorarios523);
    linhaTotal('Subtotal 01 (parcelas + art. 523, § 1º)', t.subtotal01);
  } else {
    linhaTotal('Subtotal 01 — total das parcelas (Tabela I)', t.subtotal01);
  }
  linhaTotal(`(+) Multa por descumprimento (${pctBR(t.multaDescumprimentoPct, 2)}%)`, t.multaDescumprimento);
  linhaTotal(`(+) Honorários advocatícios (${pctBR(t.honorariosPct, 2)}%)`, t.honorarios);
  linhaTotal('Subtotal 02', t.subtotal02);
  linhaTotal('(−) Pagamentos fora do intervalo (corrigidos)', t.pagamentosFora);
  doc.line(MARGEM, y + 8, MARGEM + LARGURA, y + 8, 0.8);
  linhaTotal('TOTAL GERAL', t.totalGeral, true);
  y -= 8;

  // ---- Notas explicativas -------------------------------------------------
  const notas = [
    'Correção monetária: INPC/IBGE até 08/2024 e IPCA/IBGE a partir de 09/2024 (Lei nº 14.905/2024), da competência de cada parcela até o mês anterior à data-base.',
  ];
  if (calculo.config.juros === 'legais') {
    notas.push(
      'Juros de mora legais, regime simples, com termo inicial na competência de cada parcela: 0,5% a.m. até 10/01/2003; 1% a.m. de 11/01/2003 a 29/08/2024; Taxa Legal (CC, art. 406; Res. CMN nº 5.171/2024) a partir de 30/08/2024.',
    );
  } else if (calculo.config.juros === 'fixo') {
    notas.push(`Juros de mora simples de ${pctBR(Number(calculo.config.jurosFixoMensal) || 0, 2)}% ao mês, com termo inicial na competência de cada parcela.`);
  } else {
    notas.push('Cálculo sem incidência de juros de mora.');
  }
  const t2 = demo.totais;
  if (demo.rito === 'exprop' && (t2.multa523 > 0 || t2.honorarios523 > 0)) {
    notas.push('A multa e os honorários de 10% do art. 523, § 1º do CPC incidem apenas no rito da expropriação, têm por base o total das parcelas e integram o Subtotal 01.');
  }
  if (calculo.config.observacoes) {
    notas.push(`Observações: ${calculo.config.observacoes}`);
  }
  garantir(20);
  doc.text(MARGEM, y, 'Notas explicativas', { size: 8.5, bold: true });
  y -= 11;
  const maxLinha = LARGURA;
  for (const nota of notas) {
    const palavras = `- ${nota}`.split(' ');
    let linha = '';
    for (const p of palavras) {
      const tent = linha ? `${linha} ${p}` : p;
      if (larguraTexto(tent, 7.5, false) > maxLinha && linha) {
        garantir(10);
        doc.text(MARGEM, y, linha, { size: 7.5 });
        y -= 9.5;
        linha = `  ${p}`;
      } else {
        linha = tent;
      }
    }
    if (linha) {
      garantir(10);
      doc.text(MARGEM, y, linha, { size: 7.5 });
      y -= 9.5;
    }
  }

  // ---- Rodapé em todas as páginas ----------------------------------------
  const total = doc.pages.length;
  for (let i = 0; i < total; i++) {
    doc.setPage(i);
    doc.text(MARGEM, 38, `Emitido em ${dataBR(agora)} — cálculo ${calculo.id}`, { size: 7 });
    doc.text(MARGEM + LARGURA, 38, `Página ${i + 1} de ${total}`, { size: 7, align: 'right' });
  }

  return doc.build();
}
