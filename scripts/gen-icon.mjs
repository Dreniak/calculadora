// Gera os ícones do aplicativo (PNG 256x256 e ICO 32x32) sem dependências externas.
// Desenho: fundo azul-escuro com "P A" estilizado — placeholder até a definição
// da identidade visual (PRD §13).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function drawPixels(size) {
  // RGBA
  const px = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const cx = size / 2, cy = size / 2, R = size * 0.46;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx + 0.5, y - cy + 0.5);
      if (d <= R) set(x, y, 14, 58, 110);          // disco azul-escuro
      if (d <= R && d >= R - size * 0.03) set(x, y, 201, 162, 39); // borda dourada
    }
  }
  // barra horizontal e vertical formando um "+" de calculadora
  const t = Math.max(2, Math.round(size * 0.09));
  const L = Math.round(size * 0.5);
  for (let i = -Math.floor(L / 2); i < Math.ceil(L / 2); i++) {
    for (let w = -Math.floor(t / 2); w < Math.ceil(t / 2); w++) {
      set(Math.round(cx) + i, Math.round(cy) + w, 255, 255, 255);
      set(Math.round(cx) + w, Math.round(cy) + i, 255, 255, 255);
    }
  }
  return px;
}

function makePng(size) {
  const px = drawPixels(size);
  // scanlines com filtro 0
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIco(size) {
  // ICO contendo um único PNG (suportado desde o Vista)
  const png = makePng(size);
  const header = Buffer.alloc(6 + 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // tipo: ícone
  header.writeUInt16LE(1, 4); // 1 imagem
  header[6] = size < 256 ? size : 0;
  header[7] = size < 256 ? size : 0;
  header[8] = 0; header[9] = 0;
  header.writeUInt16LE(1, 10);  // planos
  header.writeUInt16LE(32, 12); // bpp
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // offset
  return Buffer.concat([header, png]);
}

const dir = join(here, '..', 'src-tauri', 'icons');
mkdirSync(dir, { recursive: true });   // a pasta é ignorada pelo git (não vem no checkout)
writeFileSync(join(dir, 'icon.png'), makePng(256));
writeFileSync(join(dir, 'icon.ico'), makeIco(48));
console.log('Ícones gerados em', dir);
