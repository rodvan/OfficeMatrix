// Paquete de contexto corto con prefijo estable (ver docs/DECISIONES.md, D57).
// Máximo ~4 000 tokens (~16 KB) para reducir el 90 % de tokens gastados en releer contexto.
// Estructura:
// 1. Arriba: prefijo estable por agente (rol, instrucciones, protocolo) para maximizar aciertos en la caché del LLM.
// 2. Abajo: lo dinámico (pedido actual, diff desde el último turno de este agente, objeciones, mapa de archivos y memoria relevante).

const fs = require('fs');
const path = require('path');
const { t, getLang } = require('./i18n');

const IGNORE_DIRS = new Set(['.git', '.office', 'node_modules', 'dist', 'coverage', '.system_generated', 'tmp']);
const DYNAMIC_MARK = '<!-- dinámico -->';
const CONTEXT_MAX = 16000;
// Solo un id de agente ya validado entra en el nombre. Un `../` no puede salir de `.office`.
const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// true si `full` sigue dentro de `rootReal` después de resolver enlaces y uniones.
function realInside(rootReal, full) {
  let real;
  try { real = fs.realpathSync(full); } catch { return false; }
  const rel = path.relative(rootReal, real);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

// Mapa corto de archivos del proyecto (1 línea por archivo clave). No sigue un enlace ni una
// unión que salga de la carpeta: el servidor sí puede leerla, y el mapa iría en el prompt.
function projectFileMap(dir, maxFiles = 60, lang = getLang()) {
  let rootReal;
  try { rootReal = fs.realpathSync(dir); } catch { return t('context.noProject', {}, lang); }
  const result = [];
  function scan(current, rel) {
    if (result.length >= maxFiles) return;
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (result.length >= maxFiles) break;
      if (IGNORE_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      if (ent.isSymbolicLink()) continue;
      const full = path.join(current, ent.name);
      if (!realInside(rootReal, full)) continue;
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        scan(full, relPath);
      } else if (ent.isFile()) {
        try {
          const st = fs.statSync(full);
          result.push(`- \`${relPath}\` (${formatBytes(st.size)})`);
        } catch {}
      }
    }
  }
  scan(dir, '');
  return result.join('\n') || t('context.empty', {}, lang);
}

// Cambios ocurridos desde el último turno DE ESTE AGENTE.
function diffsSinceLastTurn(messages = [], agentId, lang = getLang()) {
  const agentTurns = messages.filter(m => m.kind === 'agent');
  let lastIdx = -1;
  agentTurns.forEach((m, idx) => { if (m.agentId === agentId) lastIdx = idx; });
  const since = lastIdx >= 0 ? agentTurns.slice(lastIdx + 1) : agentTurns;
  if (!since.length) return t('context.noChanges', {}, lang);

  return since.map(m => {
    const files = m.workFiles?.length ? m.workFiles : m.files || [];
    const filesList = files.length ? files.slice(0, 10).map(f => `\`${f}\``).join(', ') : t('context.none', {}, lang);
    const note = m.score != null ? t('context.score', { score: m.score }, lang) : '';
    const verdict = m.verdict ? ` · ${m.verdict}` : '';
    const diffSummary = m.diffs?.length
      ? `\n  Diffs: ${m.diffs.slice(0, 5).map(d => `\`${d.file}\` (+${d.added || 0}/-${d.removed || 0})`).join(', ')}`
      : '';
    return t('context.change', { name: m.agentName, round: m.round || '?', note, verdict, files: filesList, diffSummary }, lang);
  }).join('\n');
}

// Presupuesto en bytes UTF-8, no en unidades UTF-16. El prefijo siempre queda entero:
// si él solo supera el máximo, tiene prioridad sobre el presupuesto.
function assembleContext(prefix, head, tail, max = CONTEXT_MAX, lang = getLang()) {
  const fixed = `${prefix}\n---\n\n${DYNAMIC_MARK}\n`;
  let body = `${head || ''}${tail || ''}`;
  if (Buffer.byteLength(fixed + body, 'utf8') > max) {
    const notice = t('context.clipped', {}, lang);
    const room = max - Buffer.byteLength(fixed + notice, 'utf8');
    let clipped = '', used = 0;
    // Iterar por puntos de código evita partir un emoji o producir un sustituto aislado.
    for (const char of body) {
      const bytes = Buffer.byteLength(char, 'utf8');
      if (used + bytes > room) break;
      clipped += char;
      used += bytes;
    }
    body = room >= 0 ? clipped + notice : '';
  }
  return fixed + body;
}

function contextNames(agentId) {
  const names = ['contexto.md'];
  const id = String(agentId || '');
  if (SAFE_ID.test(id)) names.push(`contexto-${id}.md`);
  return names;
}

// Escribe el paquete dentro de `.office` y en ningún otro sitio. `contenido` es el brief que la CLI lee.
function writeContextFiles(projectDir, agentId, content) {
  const officeDir = path.join(projectDir, '.office');
  fs.mkdirSync(officeDir, { recursive: true });
  const root = fs.realpathSync(officeDir);
  for (const name of contextNames(agentId)) {
    const dest = path.join(officeDir, name);
    if (!realInside(root, officeDir) || path.basename(dest) !== name) {
      throw new Error(t('context.outside'));
    }
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, dest);
  }
}

module.exports = {
  projectFileMap,
  diffsSinceLastTurn,
  writeContextFiles,
  assembleContext,
  contextNames,
  realInside,
  DYNAMIC_MARK,
  CONTEXT_MAX,
  SAFE_ID,
};
