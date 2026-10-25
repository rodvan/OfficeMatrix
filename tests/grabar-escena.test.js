'use strict';
// El grabador del GIF de la portada no usa dependencias: su PNG y su LZW se comprueban aquí con datos sintéticos.
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { decodePng, encodeGif, lzw } = require('../scripts/grabar-escena');

function crc(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; }
  return ~c >>> 0;
}
function chunk(kind, data) {
  const len = Buffer.alloc(4), sum = Buffer.alloc(4), body = Buffer.concat([Buffer.from(kind), data]);
  len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}
// PNG RGBA de 3×4 con un filtro distinto por fila (Sub, Up, Average, Paeth) para ejercitar el decodificador.
function pngRgba(w, h, px) {
  const bpp = 4, stride = w * bpp, rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const line = Buffer.from(px.subarray(y * stride, (y + 1) * stride)), f = (y % 4) + 1, out = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
      const p = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      out[i] = (line[i] - p) & 255;
    }
    rows.push(Buffer.from([f]), out);
    prev = line;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
// Decodificador LZW de GIF independiente del codificador.
function unlzw(bytes, minCode, count) {
  const clear = 1 << minCode, end = clear + 1, out = [];
  let size = minCode + 1, dict, prev = null, pos = 0, bits = 0, cur = 0;
  const reset = () => { dict = Array.from({ length: clear }, (_, i) => [i]); dict.push(null, null); size = minCode + 1; prev = null; };
  reset();
  while (out.length < count) {
    while (bits < size) { cur |= bytes[pos++] << bits; bits += 8; }
    const code = cur & ((1 << size) - 1); cur >>= size; bits -= size;
    if (code === clear) { reset(); continue; }
    if (code === end) break;
    const entry = code < dict.length ? dict[code] : [...prev, prev[0]];
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length === 1 << size && size < 12) size++;
  }
  return out;
}

test('grabar-escena: decodifica un PNG RGBA con los cuatro filtros', () => {
  const w = 3, h = 4, px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37 + 11) & 255;
  const { width, height, rgb } = decodePng(pngRgba(w, h, px));
  assert.equal(width, 3); assert.equal(height, 4);
  for (let i = 0; i < w * h; i++) assert.deepEqual([...rgb.subarray(i * 3, i * 3 + 3)], [...px.subarray(i * 4, i * 4 + 3)]);
});

test('grabar-escena: el LZW se lee igual que se escribió, incluido el reinicio al llenar el diccionario', () => {
  const datos = Array.from({ length: 60000 }, (_, i) => (i * 7919 + (i >> 5)) % 256);
  assert.deepEqual(unlzw(lzw(datos), 8, datos.length), datos);
  const plano = new Array(5000).fill(3);
  assert.deepEqual(unlzw(lzw(plano), 8, plano.length), plano);
});

test('grabar-escena: el GIF tiene cabecera, bucle infinito, un cuadro por imagen y lo repetido va transparente', () => {
  const w = 8, h = 6, a = Buffer.alloc(w * h * 3), b = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { a.set([i * 5, 40, 200 - i], i * 3); b.set(i === 9 ? [255, 0, 0] : [i * 5, 40, 200 - i], i * 3); }
  const gif = encodeGif([{ width: w, height: h, rgb: a }, { width: w, height: h, rgb: b }], 20);
  assert.equal(gif.toString('ascii', 0, 6), 'GIF89a');
  assert.equal(gif.readUInt16LE(6), w); assert.equal(gif.readUInt16LE(8), h);
  assert.ok(gif.includes(Buffer.from('NETSCAPE2.0')));
  assert.equal(gif[gif.length - 1], 0x3b);
  // Lee los dos cuadros: el segundo solo tiene un píxel opaco (el que cambió).
  let pos = 13 + 768 + 19, cuadros = [];
  while (gif[pos] === 0x21 && gif[pos + 1] === 0xf9) {
    pos += 8;
    assert.equal(gif[pos], 0x2c);
    pos += 10;
    const min = gif[pos++], data = [];
    while (gif[pos]) { data.push(...gif.subarray(pos + 1, pos + 1 + gif[pos])); pos += gif[pos] + 1; }
    pos++;
    cuadros.push(unlzw(Buffer.from(data), min, w * h));
  }
  assert.equal(cuadros.length, 2);
  assert.equal(cuadros[0].includes(255), false);
  assert.deepEqual(cuadros[1].map((v, i) => (v === 255 ? null : i)).filter(i => i !== null), [9]);
});
