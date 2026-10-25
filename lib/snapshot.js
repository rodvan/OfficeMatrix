// Foto de los archivos de un proyecto (tamaño + fecha) para saber qué tocó cada agente en su turno.
// Funciona igual con todas las CLIs, aunque escriban con comandos de shell en vez de herramientas.
const fs = require('fs');
const path = require('path');
const { t } = require('./i18n');

const IGNORED = new Set(['node_modules', '.git', '.office', '__pycache__', '.venv', 'dist', 'build', '.historial']);
const MAX_FILES = 5000;

const MAX_TEXT = 64 * 1024;
const MAX_TEXT_BUDGET = 8 * 1024 * 1024;

function readText(full, size, budget) {
  if (size > MAX_TEXT || size > budget.left) return null;
  let buf;
  try { buf = fs.readFileSync(full); } catch { return null; }
  if (buf.includes(0)) return null;
  budget.left -= buf.length;
  return buf.toString('utf8');
}

function snapshot(dir) {
  const out = new Map();
  const budget = { left: MAX_TEXT_BUDGET };
  const walk = d => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.size >= MAX_FILES) return;
      if (IGNORED.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try {
          const st = fs.statSync(full);
          const rel = path.relative(dir, full).replace(/\\/g, '/');
          out.set(rel, { sig: `${st.size}:${Math.round(st.mtimeMs)}`, text: readText(full, st.size, budget) });
        } catch {}
      }
    }
  };
  walk(dir);
  return out;
}

const sigOf = v => (v && typeof v === 'object' ? v.sig : v);
const textOf = v => (v && typeof v === 'object' ? v.text : null);

function diffSnapshots(before, after) {
  const added = [], modified = [], deleted = [];
  for (const [file, val] of after) {
    if (!before.has(file)) added.push(file);
    else {
      const prev = before.get(file);
      // La fecha puede conservarse al copiar/restaurar un archivo. Aprovecha el
      // texto ya capturado para detectar ediciones con igual tamaño y mtime.
      const textChanged = textOf(prev) != null && textOf(val) != null && textOf(prev) !== textOf(val);
      if (sigOf(prev) !== sigOf(val) || textChanged) modified.push(file);
    }
  }
  for (const file of before.keys()) if (!after.has(file)) deleted.push(file);
  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() };
}

// El salto de línea final no cuenta: así un archivo con o sin él no genera un diff fantasma.
function splitLines(text) {
  if (text == null) return [];
  const s = String(text).replace(/\r\n/g, '\n');
  if (!s) return [];
  const lines = s.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Diff por líneas (LCS). null si el archivo es demasiado grande para compararlo entero.
function lineDiff(a, b) {
  const n = a.length, m = b.length;
  if (n * m > 200000) return null;
  const dp = new Uint32Array((n + 1) * (m + 1));
  const ix = (i, j) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[ix(i, j)] = a[i] === b[j] ? dp[ix(i + 1, j + 1)] + 1 : Math.max(dp[ix(i + 1, j)], dp[ix(i, j + 1)]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++; }
    else if (dp[ix(i + 1, j)] >= dp[ix(i, j + 1)]) { ops.push(['-', a[i]]); i++; }
    else { ops.push(['+', b[j]]); j++; }
  }
  while (i < n) { ops.push(['-', a[i]]); i++; }
  while (j < m) { ops.push(['+', b[j]]); j++; }
  return ops;
}

const clipLine = s => (s.length > 200 ? s.slice(0, 199) + '…' : s);

function toUnified(ops, { context = 2, maxLines = 80 } = {}) {
  const out = [];
  let i = 0;
  let truncated = false;
  while (i < ops.length) {
    if (ops[i][0] === ' ') { i++; continue; }
    let s = i, ctx = 0;
    while (s > 0 && ctx < context && ops[s - 1][0] === ' ') { s--; ctx++; }
    let e = i;
    while (e < ops.length && ops[e][0] !== ' ') e++;
    while (e < ops.length) {
      let k = e, gap = 0;
      while (k < ops.length && ops[k][0] === ' ' && gap < context * 2) { k++; gap++; }
      if (k < ops.length && ops[k][0] !== ' ' && gap <= context * 2) {
        while (e < k && ops[e][0] === ' ') e++;
        while (e < ops.length && ops[e][0] !== ' ') e++;
      } else break;
    }
    let after = 0;
    while (e < ops.length && ops[e][0] === ' ' && after < context) { e++; after++; }
    let aLine = 1, bLine = 1;
    for (let t = 0; t < s; t++) {
      if (ops[t][0] !== '+') aLine++;
      if (ops[t][0] !== '-') bLine++;
    }
    let aCount = 0, bCount = 0;
    const body = [];
    for (let t = s; t < e; t++) {
      const [op, line] = ops[t];
      body.push(op + clipLine(line));
      if (op !== '+') aCount++;
      if (op !== '-') bCount++;
    }
    const hunk = [`@@ -${aLine},${aCount} +${bLine},${bCount} @@`, ...body];
    if (out.length + hunk.length > maxLines) { truncated = true; break; }
    out.push(...hunk);
    i = e > i ? e : i + 1;
  }
  return { patch: out.join('\n'), truncated };
}

function largeSpan(a, b) {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start++;
  let aEnd = a.length, bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd--; }
  const removed = a.slice(start, aEnd).slice(0, 20).map(l => '-' + clipLine(l));
  const added = b.slice(start, bEnd).slice(0, 20).map(l => '+' + clipLine(l));
  const more = aEnd - start > 20 || bEnd - start > 20;
  return {
    patch: [t('diff.bigFile', { a: a.length, b: b.length }), ...removed, ...added, ...(more ? [t('diff.hunkCut')] : [])].join('\n'),
    truncated: true,
  };
}

// Diffs de texto de los archivos de trabajo (los de contabilidad se ven en Handoff y en el cerebro).
function textDiffs(before, after, diff, { limit = 8, maxPatch = 3500 } = {}) {
  const items = [
    ...diff.added.map(file => ({ file, status: 'added' })),
    ...diff.modified.map(file => ({ file, status: 'modified' })),
    ...diff.deleted.map(file => ({ file, status: 'deleted' })),
  ].filter(item => !isBookkeeping(item.file));
  const out = [];
  for (const item of items) {
    if (out.length >= limit) break;
    const prev = before.has(item.file) ? textOf(before.get(item.file)) : null;
    const next = after.has(item.file) ? textOf(after.get(item.file)) : null;
    if ((item.status !== 'deleted' && next == null && after.has(item.file)) || (item.status !== 'added' && prev == null && before.has(item.file))) {
      out.push({ ...item, patch: t('diff.binary'), truncated: true });
      continue;
    }
    const a = splitLines(prev), b = splitLines(next);
    const ops = lineDiff(a, b);
    const built = ops ? toUnified(ops) : largeSpan(a, b);
    if (!built.patch.trim()) continue;
    let patch = built.patch;
    let truncated = built.truncated;
    if (patch.length > maxPatch) { patch = patch.slice(0, maxPatch) + '\n…(diff recortado)'; truncated = true; }
    out.push({ ...item, patch, truncated });
  }
  return out;
}

// Archivos que NO cuentan como "cambiar el trabajo" (un APROBADO puede tocarlos).
// aportes/: lo que OfficeMatrix guarda de la respuesta de un bot externo (el bot no toca archivos; su aporte es su texto).
const BOOKKEEPING = [/^MEMORIA\.md$/i, /^HANDOFF\.md$/i, /^memoria-oficina\//i, /^docs\/DISCUSION\.md$/i, /^aportes\//i];
const isBookkeeping = f => BOOKKEEPING.some(re => re.test(f));

function workChanges(diff) {
  return [...diff.added, ...diff.modified, ...diff.deleted].filter(f => !isBookkeeping(f));
}

module.exports = { snapshot, diffSnapshots, workChanges, textDiffs, isBookkeeping, splitLines, IGNORED };
