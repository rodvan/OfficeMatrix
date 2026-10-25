// Shared brain: memoria de la oficina en Markdown, con fusión de tres vías para no perder anotaciones,
// historial de versiones y búsqueda por relevancia.
const fs = require('fs');
const path = require('path');

const HISTORY_DIR = '.historial';
const HISTORY_KEEP = 30;

function listMemoryFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.')).sort();
}

function validName(name) {
  const base = path.basename(String(name || ''));
  return /^[\w.\-áéíóúñü ]+\.md$/i.test(base) && !base.startsWith('.') ? base : null;
}

// ---------- Fusión de tres vías por líneas ----------
// base = lo que había cuando el ciclo copió la memoria; ours = lo que dejó el ciclo; theirs = lo que hay ahora en la memoria global
// (otro ciclo o el usuario pudo escribir mientras tanto). Reglas:
//  - Si solo cambió un lado, gana ese lado.
//  - Si cambiaron los dos: se parte de "theirs", se quitan las líneas que "ours" borró y se insertan las que "ours" añadió,
//    justo después de la última línea anterior que siga existiendo (normalmente su encabezado de sección).
//    Nunca se pierde una línea añadida por ninguno de los dos.

function counts(lines) {
  const m = new Map();
  for (const l of lines) m.set(l, (m.get(l) || 0) + 1);
  return m;
}

function mergeText(base, ours, theirs) {
  base = base ?? '';
  if (theirs == null) return ours;
  if (ours === theirs || ours === base) return theirs;
  if (theirs === base) return ours;

  const b = base.split('\n'), o = ours.split('\n');
  let result = theirs.split('\n');

  // Borrados de "ours": líneas que estaban en base y ya no están en ours (respetando repeticiones).
  const bc = counts(b), oc = counts(o);
  for (const [line, n] of bc) {
    if (!line.trim()) continue;
    let removeCount = n - (oc.get(line) || 0);
    for (let i = result.length - 1; i >= 0 && removeCount > 0; i--) {
      if (result[i] === line) { result.splice(i, 1); removeCount--; }
    }
  }

  // Añadidos de "ours": bloques de líneas que no estaban en base.
  const remaining = new Map(bc);
  const added = [];
  let anchor = null;
  let block = null;
  for (const line of o) {
    if ((remaining.get(line) || 0) > 0) {
      remaining.set(line, remaining.get(line) - 1);
      if (block) { added.push(block); block = null; }
      anchor = line;
    } else {
      if (!block) block = { anchor, lines: [] };
      block.lines.push(line);
    }
  }
  if (block) added.push(block);

  for (const blk of added) {
    const resultSet = new Set(result.filter(l => l.trim()));
    const lines = blk.lines.filter(l => !l.trim() || !resultSet.has(l)); // ya presente en theirs: no duplicar
    if (!lines.some(l => l.trim())) continue;
    let at = blk.anchor == null ? -1 : result.lastIndexOf(blk.anchor);
    if (blk.anchor != null && at === -1) at = result.length - 1; // el ancla desapareció: al final
    // Dentro de la sección del ancla, inserta tras el contenido contiguo (no en medio de otra entrada).
    let pos = at + 1;
    if (blk.anchor != null && /^#{1,6}\s/.test(blk.anchor)) {
      while (pos < result.length && !/^#{1,6}\s/.test(result[pos])) pos++;
      while (pos > at + 1 && !result[pos - 1].trim()) pos--;
    }
    result.splice(pos, 0, ...lines);
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n');
}

// ---------- Escritura con historial ----------

function writeWithHistory(dir, name, content) {
  const file = path.join(dir, name);
  if (fs.existsSync(file)) {
    const prev = fs.readFileSync(file, 'utf8');
    if (prev === content) return false;
    const hdir = path.join(dir, HISTORY_DIR, name.replace(/\.md$/, ''));
    fs.mkdirSync(hdir, { recursive: true });
    fs.writeFileSync(path.join(hdir, `${new Date().toISOString().replace(/[:.]/g, '-')}.md`), prev);
    const versions = fs.readdirSync(hdir).sort();
    for (const old of versions.slice(0, Math.max(0, versions.length - HISTORY_KEEP))) fs.unlinkSync(path.join(hdir, old));
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

function listHistory(dir, name) {
  const hdir = path.join(dir, HISTORY_DIR, name.replace(/\.md$/, ''));
  if (!fs.existsSync(hdir)) return [];
  return fs.readdirSync(hdir).sort().reverse();
}

// ---------- Búsqueda y relevancia ----------

const STOP = new Set(('para pero como este esta estos estas sobre entre desde hasta donde cuando porque que con sin los las del una uno unos unas por más muy ya hay ser son fue sus todo toda todos todas cada otro otra otros otras eso esto esa ese también solo sólo debe deben puede pueden hacer hace usa usar the and for with that this from have your into will').split(' '));

function tokens(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9ñ]+/).filter(t => t.length >= 4 && !STOP.has(t));
}

// Parte un archivo de memoria en entradas (por encabezado ### o ##, o por viñeta de primer nivel).
function splitEntries(file, content) {
  const entries = [];
  let heading = '';
  let current = null;
  const push = () => { if (current && current.text.trim()) entries.push(current); current = null; };
  for (const line of content.split('\n')) {
    if (/^#{1,6}\s/.test(line)) {
      push();
      heading = line.replace(/^#+\s*/, '').trim();
      if (/^#{3,6}\s/.test(line)) current = { file, heading, text: line + '\n' };
      continue;
    }
    if (/^[-*]\s/.test(line) && (!current || !/^#{3,6}/.test(current.text))) {
      push();
      current = { file, heading, text: line + '\n' };
      continue;
    }
    if (current) current.text += line + '\n';
  }
  push();
  return entries.map(e => ({ ...e, text: e.text.trim() }));
}

// Las entradas de memoria más relacionadas con el pedido (para que el agente las tenga delante sin buscarlas).
function relevantEntries(query, docs, limit = 6) {
  const q = new Set(tokens(query));
  if (!q.size) return [];
  const all = docs.flatMap(d => splitEntries(d.file, d.content));
  const df = new Map();
  for (const e of all) for (const t of new Set(tokens(e.text))) df.set(t, (df.get(t) || 0) + 1);
  const scored = all.map(e => {
    const et = new Set(tokens(e.text + ' ' + e.heading));
    let score = 0;
    for (const t of q) if (et.has(t)) score += Math.log(1 + all.length / (df.get(t) || 1));
    return { ...e, score };
  }).filter(e => e.score > 0);
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

// Búsqueda literal (sin distinguir mayúsculas ni tildes) con contexto, para la UI.
function searchDocs(query, docs, limit = 80) {
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits = [];
  for (const d of docs) {
    const lines = d.content.split('\n');
    lines.forEach((line, i) => {
      const n = norm(line);
      if (terms.every(t => n.includes(t))) hits.push({ file: d.file, scope: d.scope, line: i + 1, text: line.trim().slice(0, 240) });
    });
  }
  return hits.slice(0, limit);
}

module.exports = { listMemoryFiles, validName, mergeText, writeWithHistory, listHistory, splitEntries, relevantEntries, searchDocs, tokens, HISTORY_DIR };
