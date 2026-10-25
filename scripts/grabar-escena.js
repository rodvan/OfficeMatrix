// Graba docs/img/escena.gif (y la imagen fija docs/img/escena.png) con la demo de agentes falsos. Sin dependencias:
// la demo de tests/helpers/demo-server.js en un puerto 44xx, capturas con tests/helpers/ui-probe.js (Chrome o Edge
// headless del sistema) y un codificador GIF propio (PNG → paleta de 255 colores → LZW).
//   node scripts/grabar-escena.js [puerto=4430] [cuadros=60] [ms entre cuadros=200]
// Nunca toca la app en vivo (4321): solo usa 4400–4499.
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

// ---------- PNG (8 bits, RGB o RGBA, sin entrelazar: lo que devuelve Chrome) ----------
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('No es un PNG');
  let pos = 8, width, height, type, idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9];
      if (data[8] !== 8 || ![2, 6].includes(type) || data[12] !== 0) throw new Error('Unsupported PNG (only 8-bit non-interlaced RGB/RGBA)');
    }
    if (kind === 'IDAT') idat.push(data);
    if (kind === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = width * bpp, raw = zlib.inflateSync(Buffer.concat(idat));
  const rgb = Buffer.alloc(width * height * 3);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = (line[i] + p) & 255;
    }
    for (let x = 0; x < width; x++) line.copy(rgb, (y * width + x) * 3, x * bpp, x * bpp + 3);
    prev = line;
  }
  return { width, height, rgb };
}

// ---------- Paleta común a todos los cuadros (corte por la mediana sobre colores de 15 bits) ----------
const key15 = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
function palette(frames, size = 255) {
  const hist = new Uint32Array(32768);
  for (const f of frames) for (let i = 0; i < f.rgb.length; i += 3) hist[key15(f.rgb[i], f.rgb[i + 1], f.rgb[i + 2])]++;
  const colors = [];
  for (let k = 0; k < 32768; k++) if (hist[k]) colors.push(k);
  const ch = (k, c) => (k >> (10 - 5 * c)) & 31;
  let boxes = [colors];
  while (boxes.length < size) {
    let best = -1, bestRange = 0, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 31, hi = 0;
        for (const k of box) { const v = ch(k, c); if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > bestRange) { bestRange = hi - lo; best = i; bestCh = c; }
      }
    });
    if (best < 0) break;
    const box = boxes[best].sort((a, b) => ch(a, bestCh) - ch(b, bestCh));
    let total = 0, half = 0, cut = 1;
    for (const k of box) total += hist[k];
    for (let i = 0; i < box.length - 1; i++) { half += hist[box[i]]; if (half >= total / 2) { cut = i + 1; break; } }
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }
  const pal = boxes.map(box => {
    let n = 0, r = 0, g = 0, b = 0;
    for (const k of box) { const w = hist[k]; n += w; r += ch(k, 0) * w; g += ch(k, 1) * w; b += ch(k, 2) * w; }
    return [r, g, b].map(v => Math.round((v / n) * 255 / 31));
  });
  const lookup = new Uint8Array(32768);
  for (const k of colors) {
    let best = 0, dist = Infinity;
    const r = ch(k, 0) * 255 / 31, g = ch(k, 1) * 255 / 31, b = ch(k, 2) * 255 / 31;
    pal.forEach((p, i) => { const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2; if (d < dist) { dist = d; best = i; } });
    lookup[k] = best;
  }
  return { pal, lookup };
}

// ---------- GIF89a con LZW; lo que no cambia respecto al cuadro anterior va transparente (pesa casi nada) ----------
function lzw(indices, minCode = 8) {
  const out = [];
  let cur = 0, bits = 0, size = minCode + 1, dict = new Map(), next;
  const clear = 1 << minCode, end = clear + 1;
  const put = code => { cur |= code << bits; bits += size; while (bits >= 8) { out.push(cur & 255); cur >>= 8; bits -= 8; } };
  const reset = () => { dict = new Map(); next = end + 1; size = minCode + 1; };
  reset(); put(clear);
  let w = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], wk = w * 4096 + k;
    if (dict.has(wk)) { w = dict.get(wk); continue; }
    put(w);
    if (next < 4096) { dict.set(wk, next++); if (next > 1 << size && size < 12) size++; }
    else { put(clear); reset(); }
    w = k;
  }
  put(w); put(end);
  if (bits > 0) out.push(cur & 255);
  return Buffer.from(out);
}
function encodeGif(frames, delayCs = 20) {
  const { width, height } = frames[0];
  const { pal, lookup } = palette(frames);
  const TRANSP = 255, parts = [];
  const ct = Buffer.alloc(768);
  pal.forEach((p, i) => ct.set(p, i * 3));
  const head = Buffer.alloc(13);
  head.write('GIF89a'); head.writeUInt16LE(width, 6); head.writeUInt16LE(height, 8); head[10] = 0xf7;
  parts.push(head, ct, Buffer.from([0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0]));
  let prev = null;
  for (const f of frames) {
    const idx = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < idx.length; i++, p += 3) idx[i] = lookup[key15(f.rgb[p], f.rgb[p + 1], f.rgb[p + 2])];
    const out = prev ? idx.map((v, i) => (v === prev[i] ? TRANSP : v)) : idx;
    prev = idx;
    parts.push(Buffer.from([0x21, 0xf9, 4, (1 << 2) | 1, delayCs & 255, delayCs >> 8, TRANSP, 0]));
    const desc = Buffer.alloc(10);
    desc[0] = 0x2c; desc.writeUInt16LE(width, 5); desc.writeUInt16LE(height, 7);
    parts.push(desc, Buffer.from([8]));
    const data = lzw(out);
    for (let i = 0; i < data.length; i += 255) { const c = data.subarray(i, i + 255); parts.push(Buffer.from([c.length]), c); }
    parts.push(Buffer.from([0]));
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

// ---------- Grabación ----------
async function grabar() {
  const port = Number(process.argv[2]) || 4430, nFrames = Number(process.argv[3]) || 60, every = Number(process.argv[4]) || 200;
  if (port < 4400 || port > 4499) throw new Error('Use a port from 4400 to 4499: never the live app');
  const root = path.join(__dirname, '..');
  const demo = spawn(process.execPath, [path.join(root, 'tests/helpers/demo-server.js'), String(port), '240'],
    { cwd: root, env: { ...process.env, DEMO_SIMULACION: '1', FAKE_DELAY_MS: '2500' }, stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    const office = await new Promise((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => reject(new Error('The demo did not start within 30 s')), 30000);
      demo.stdout.on('data', b => { out += b; const m = out.match(/simulación de ejemplo: .* \(([^)]+)\)/); if (m) { clearTimeout(timer); resolve(m[1]); } });
      demo.once('exit', code => reject(new Error(`The demo exited early (code ${code})`)));
    });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-gif-'));
    console.log(`demo en ${port}, oficina ${office}; grabando ${nFrames} cuadros…`);
    execFileSync(process.execPath, [path.join(root, 'tests/helpers/ui-probe.js'), `http://localhost:${port}/#s=${office}`,
      // El perfil headless es nuevo: «Primeros pasos» se abriría encima de la escena.
      '--eval=localStorage.setItem("om-setup-seen-v1", "1"), document.getElementById("setupDialog").close(), "listo"',
      '--wait=12000', '--size=1920,1080', '--clip=.deck.nave .stage', '--scale=1', `--frames=${nFrames},${every}`,
      `--shot=${path.join(tmp, 'cuadro.png')}`], { stdio: 'inherit', timeout: 300000 });
    const files = Array.from({ length: nFrames }, (_, i) => path.join(tmp, `cuadro-${i + 1}.png`));
    const frames = files.map(f => decodePng(fs.readFileSync(f)));
    const dir = path.join(root, 'docs', 'img');
    fs.writeFileSync(path.join(dir, 'escena.gif'), encodeGif(frames, Math.round(every / 10)));
    fs.copyFileSync(files[Math.floor(nFrames / 2)], path.join(dir, 'escena.png'));
    fs.rmSync(tmp, { recursive: true, force: true });
    const kb = n => `${Math.round(fs.statSync(path.join(dir, n)).size / 1024)} KB`;
    console.log(`docs/img/escena.gif (${frames[0].width}×${frames[0].height}, ${nFrames} cuadros, ${kb('escena.gif')}) y docs/img/escena.png (${kb('escena.png')})`);
  } finally { demo.kill(); }
}

if (require.main === module) grabar().catch(err => { console.error(err.message); process.exit(1); });
module.exports = { decodePng, encodeGif, lzw };
