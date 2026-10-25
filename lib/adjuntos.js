// Archivos que el usuario adjunta a una misión (PDF, imágenes, documentos…).
// Se suben primero a un área temporal (cada uno con un id) y al crear la misión o enviar el pedido se mueven a
// <proyecto>/adjuntos/. De cada PDF se saca además el texto con pdftotext (viene con Git para Windows), porque no
// todas las CLIs leen PDF: así las cuatro trabajan sobre el mismo contenido.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { t, getLang } = require('./i18n');

const MAX_BYTES = 50 * 1024 * 1024;
const FOLDER = 'adjuntos';
const ID_RE = /^[a-f0-9]{16}$/;

// Solo el nombre, sin rutas ni caracteres raros (Windows no admite <>:"/\|?*).
function safeName(name) {
  const base = path.basename(String(name || '').replace(/\\/g, '/')).normalize('NFC');
  const clean = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').trim().slice(-120);
  return clean || 'archivo';
}

function stage(stagingDir, name, buffer) {
  if (!buffer.length) throw Object.assign(new Error(t('attach.err.empty')), { status: 400 });
  const id = crypto.randomBytes(8).toString('hex');
  const dir = path.join(stagingDir, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = safeName(name);
  fs.writeFileSync(path.join(dir, file), buffer);
  return { id, name: file, size: buffer.length };
}

// pdftotext en el PATH o el que trae Git para Windows.
const PDFTOTEXT = ['pdftotext', 'C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe', 'C:\\Program Files (x86)\\Git\\mingw64\\bin\\pdftotext.exe'];
function pdfText(pdf, out) {
  for (const cmd of PDFTOTEXT) {
    const r = spawnSync(cmd, ['-layout', '-enc', 'UTF-8', pdf, out], { timeout: 120000, windowsHide: true });
    if (!r.error && r.status === 0 && fs.existsSync(out)) {
      const text = fs.readFileSync(out, 'utf8');
      return { pages: text.split('\f').filter(p => p.trim()).length, chars: text.replace(/\s+/g, '').length };
    }
  }
  return null;
}

// Mueve los adjuntos subidos al proyecto. Devuelve lo que quedó: [{ file, size, text?, pages?, scanned? }].
function attach(stagingDir, ids, projectDir) {
  const out = [];
  const dest = path.join(projectDir, FOLDER);
  for (const id of [...new Set(ids || [])]) {
    if (!ID_RE.test(String(id))) continue;
    const dir = path.join(stagingDir, id);
    if (!fs.existsSync(dir)) continue;
    const name = fs.readdirSync(dir)[0];
    if (!name) continue;
    fs.mkdirSync(dest, { recursive: true });
    const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
    let file = name;
    for (let i = 2; fs.existsSync(path.join(dest, file)); i++) file = `${stem} (${i})${ext}`;
    fs.renameSync(path.join(dir, name), path.join(dest, file));
    fs.rmSync(dir, { recursive: true, force: true });
    const item = { file: `${FOLDER}/${file}`, size: fs.statSync(path.join(dest, file)).size };
    if (ext.toLowerCase() === '.pdf') {
      const info = pdfText(path.join(dest, file), path.join(dest, `${file}.txt`));
      if (info) Object.assign(item, { text: `${item.file}.txt`, pages: info.pages, scanned: info.chars < 10 * Math.max(1, info.pages) });
    }
    out.push(item);
  }
  return out;
}

const human = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Bloque que se añade al pedido para que todos los agentes sepan qué leer, en el idioma del pedido si se da.
function describe(items, lang = getLang()) {
  if (!items.length) return '';
  const lines = items.map(a => {
    const extra = a.text
      ? a.scanned
        ? t('attach.scanned', null, lang)
        : t('attach.pages', { pages: a.pages, text: a.text }, lang)
      : '';
    return `- ${a.file} (${human(a.size)})${extra}`;
  });
  return t('attach.block', { folder: FOLDER, lines: lines.join('\n') }, lang);
}

// Borra subidas que nunca se usaron (más de un día).
function sweep(stagingDir) {
  if (!fs.existsSync(stagingDir)) return;
  for (const id of fs.readdirSync(stagingDir)) {
    const dir = path.join(stagingDir, id);
    try { if (Date.now() - fs.statSync(dir).mtimeMs > 864e5) fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { stage, attach, describe, sweep, safeName, MAX_BYTES, FOLDER };
