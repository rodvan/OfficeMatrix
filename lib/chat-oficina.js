// Chat de una oficina: no es una misión. Los mensajes viven en oficinas/<id>/chat/mensajes.jsonl
// y el anfitrión (quien contesta si nadie fue mencionado) en chat/ajustes.json.
// Las menciones (@nombre) eligen quién contesta. Las llaves no se escriben: redact() las tapa
// antes de guardar, de enseñarlas o de reenviarlas a un bot.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const HISTORY_N = 8;
const MENTION_RE = /@([A-Za-z0-9][\w.-]{0,39})/g;

const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

// Una llave conocida se tapa con su prefijo (whsec_••••, crsr_••••) para que se vea el tipo y no el valor.
function maskOf(secret) {
  if (/^whsec_/i.test(secret)) return 'whsec_••••';
  if (/^crsr_/i.test(secret)) return 'crsr_••••';
  if (/^om_[a-z0-9-]+_/i.test(secret)) return 'om_••••';
  return '••••';
}

// Sustituye llaves conocidas y las que tienen forma de secreto, aunque el texto las parta en el chat.
function redact(text, secrets = []) {
  let s = String(text ?? '');
  const list = [...new Set(secrets.map(x => String(x || '')).filter(x => x.length >= 8))];
  list.sort((a, b) => b.length - a.length);
  for (const secret of list) s = s.split(secret).join(maskOf(secret));
  return s
    .replace(/whsec_[A-Za-z0-9+/=_-]{6,}/g, 'whsec_••••')
    .replace(/crsr_[A-Za-z0-9_-]{6,}/g, 'crsr_••••')
    .replace(/\bom_[a-z0-9-]+_[A-Za-z0-9_-]{10,}/g, 'om_••••')
    .replace(/Authorization:\s*Bearer\s+\S+/gi, 'Authorization: Bearer ••••');
}

function mentioned(text, members) {
  const out = [];
  for (const m of String(text || '').matchAll(MENTION_RE)) {
    const token = m[1].toLowerCase();
    const hit = members.find(x => x.mencion === token || String(x.id).toLowerCase() === token || String(x.nombre || '').toLowerCase() === token || String(x.sceneId || '').toLowerCase() === token);
    if (hit && !out.some(x => x.sceneId === hit.sceneId)) out.push(hit);
  }
  return out;
}

// Con mención contestan solo esos miembros, en el orden del texto. Sin mención, el anfitrión.
// Una @ que no coincide con nadie no cae en el anfitrión: el usuario pidió a otra persona.
function recipients(text, members, hostId) {
  const hits = mentioned(text, members);
  if (hits.length) return { modo: 'mencion', quienes: hits };
  if (/@[A-Za-z0-9]/.test(String(text || ''))) return { modo: 'nadie', quienes: [], motivo: 'desconocida' };
  const host = hostId ? members.find(m => m.sceneId === hostId || m.id === hostId) : null;
  if (host) return { modo: 'anfitrion', quienes: [host] };
  return { modo: 'nadie', quienes: [], motivo: 'sin-anfitrion' };
}

function draftMission(messages) {
  const picked = (messages || []).filter(m => m && m.autor?.tipo !== 'system');
  const first = picked.find(m => m.autor?.tipo === 'owner') || picked[0];
  const title = String(first?.texto || 'Chat').split('\n')[0].replace(/@[\w.-]+/g, '').trim().slice(0, 60) || 'Chat';
  const body = picked.map(m => `${m.autor?.nombre || '?'}: ${m.texto}`).join('\n\n');
  return { titulo: title, texto: `From the office chat:\n\n${body}` };
}

// El prompt que lee la CLI está en un archivo del cajón, nunca en la línea de órdenes:
// el texto del usuario no pasa por el shell. La orden fija solo dice «lee ese archivo».
function chatPrompt({ nombre, historial = [], memoria = '', mensaje = '', imagenes = false, adjuntos = [] }) {
  const recent = historial.slice(-HISTORY_N).map(m => `${m.de}: ${String(m.texto || '').replace(/\s+/g, ' ').slice(0, 240)}`).join(' | ');
  return [
    `You are ${nombre} in an OfficeMatrix office chat.`,
    imagenes
      ? 'Read-only: do not edit, create or delete any file. Only exception: if asked for an image and you have an image tool, generate it; it is shared automatically, so do not copy, move or convert it. Reply in at most 80 words, plain text.'
      : 'Read-only: do not edit, create or delete any file. Reply in at most 80 words, plain text.',
    memoria ? `Office memory: ${String(memoria).slice(0, 1500)}` : '',
    recent ? `Recent chat: ${recent}` : '',
    adjuntos.length ? `The user attached these images (in your working folder): ${adjuntos.join(', ')}. Look at them before replying.` : '',
    `Reply to: ${String(mensaje || '').replace(/\s+/g, ' ').slice(0, 500)}`,
  ].filter(Boolean).join('\n');
}

// Un turno de chat no puede escribir: los args de misión (acceptEdits, --always-approve,
// workspace-write) se cambian por los de solo lectura de cada CLI. El cajón temporal no basta,
// porque Bash o una ruta absoluta salen de él. `chatArgs` en agents.json manda si existe.
const WRITE_FLAGS = {
  claude: { drop: ['--dangerously-skip-permissions'], dropWithValue: ['--permission-mode', '--allowedTools', '--allowed-tools', '--disallowedTools', '--disallowed-tools'], add: ['--permission-mode', 'plan', '--disallowedTools', 'Write,Edit,MultiEdit,NotebookEdit,Bash'] },
  codex: { drop: ['--full-auto', '--dangerously-bypass-approvals-and-sandbox', '--yolo'], dropWithValue: ['--sandbox', '-s'], add: ['--sandbox', 'read-only'] },
  grok: { drop: ['--always-approve', '--yolo', '--dangerously-skip-permissions'], dropWithValue: [], add: [] },
  agy: { drop: ['--dangerously-skip-permissions', '--yolo'], dropWithValue: [], add: [] },
  // Kimi con -p aprueba solo sus herramientas y no admite --plan: el chat lo lanza con un agente propio
  // (lib/kimi/chat.md) cuya lista de herramientas solo lee, busca y navega. Kimi la vuelve a comprobar antes de ejecutar.
  kimi: { drop: ['--yolo', '-y', '--auto', '--plan'], dropWithValue: ['--agent', '--agent-file'], add: ['--agent-file', path.join(__dirname, 'kimi', 'chat.md')] },
};

// sinArchivos (chat desde Discord): a Claude también se le quitan las herramientas de lectura de archivos y de red, para
// que nadie en un canal pueda pedirle leer una ruta del disco. Las otras CLIs no tienen ese interruptor: por eso solo
// los usuarios autorizados de Discord pueden hablar con el bot (docs/DISCORD.md).
const NO_FILE_TOOLS = 'Write,Edit,MultiEdit,NotebookEdit,Bash,Read,Glob,Grep,LS,WebFetch';

// Cómo le llega el mensaje a la CLI. Lo normal: la orden fija dice «lee chat-prompt.md» y el texto del usuario nunca pasa
// por la línea de órdenes (ni por el shell). Pero quien no puede leer archivos no puede abrir ese archivo:
//  - Claude desde Discord (sin Read): el prompt va por la entrada estándar, que Claude añade a la orden.
//  - Kimi (ignora la entrada estándar): el prompt va al final de su archivo de agente, que Kimi mismo lee al arrancar
//    (no es una herramienta). Se copia el agente al cajón con el prompt debajo y la orden apunta a esa copia.
// Devuelve { args, stdin } con {prompt} ya sustituido.
const ORDEN_STDIN = 'Your instructions and the chat message come on standard input. Reply with the chat message only. Do not edit, create or delete files.';
const ORDEN_AGENTE = 'Reply to the chat message in your instructions (section "This chat turn") with the chat message only. Do not edit, create or delete files.';
function entregaDelPrompt(stream, args, { prompt, orden, sandbox, sinArchivos = false }) {
  const poner = texto => args.map(a => String(a).replaceAll('{prompt}', texto));
  if (stream === 'kimi') {
    const i = args.indexOf('--agent-file');
    if (i >= 0 && args[i + 1]) {
      const copia = path.join(sandbox, 'kimi-agente.md');
      fs.writeFileSync(copia, `${fs.readFileSync(String(args[i + 1]), 'utf8').trimEnd()}\n\n## This chat turn\n\n${prompt}\n`);
      const out = poner(ORDEN_AGENTE);
      out[i + 1] = copia;
      return { args: out, stdin: '' };
    }
  }
  if (sinArchivos && stream === 'claude') return { args: poner(ORDEN_STDIN), stdin: prompt };
  return { args: poner(orden), stdin: '' };
}

function readOnlyArgs(stream, args, { sinArchivos = false } = {}) {
  const rule = WRITE_FLAGS[stream];
  if (!rule) return [...args];
  if (sinArchivos && stream === 'claude') {
    const out = readOnlyArgs(stream, args);
    out[out.length - 1] = NO_FILE_TOOLS;
    return out;
  }
  // Desde Discord, Kimi solo busca en la web (lib/kimi/chat-sin-archivos.md): nada de leer el disco.
  if (sinArchivos && stream === 'kimi') {
    const out = readOnlyArgs(stream, args);
    out[out.length - 1] = path.join(__dirname, 'kimi', 'chat-sin-archivos.md');
    return out;
  }
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    const flag = a.split('=')[0];
    if (rule.drop.includes(a)) continue;
    if (rule.dropWithValue.includes(flag)) { if (!a.includes('=')) i++; continue; }
    out.push(args[i]);
  }
  return [...out, ...rule.add];
}

// Imágenes que una IA generó en este turno de chat (para Discord): las del cajón y las de la carpeta donde su CLI guarda
// lo que genera en ESA conversación (el id sale de su propio stream). Solo archivos nuevos del turno, hasta 4 y 8 MB en
// total (el límite de subida de Discord sin Nitro).
const IMAGEN_RE = /\.(png|jpe?g|webp|gif)$/i;
const IMAGEN_TIPOS = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
function imagenesDelTurno(dirs, desde, { max = 4, maxBytes = 8 * 1024 * 1024 } = {}) {
  const out = [];
  let total = 0;
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (out.length >= max || !IMAGEN_RE.test(name)) continue;
      const file = path.join(dir, name);
      try {
        const st = fs.statSync(file);
        if (!st.isFile() || st.mtimeMs < desde || total + st.size > maxBytes) continue;
        out.push({ name, data: fs.readFileSync(file), type: IMAGEN_TIPOS[name.split('.').pop().toLowerCase()] });
        total += st.size;
      } catch { /* una imagen ilegible no corta la respuesta */ }
    }
  }
  return out;
}
//   Antigravity (agy): ~/.gemini/antigravity-cli/brain/<conversation_id>/
//   Codex: $CODEX_HOME/generated_images/<thread_id>/ (CODEX_HOME por defecto ~/.codex)
const idsDe = (stdout, campo) => [...new Set((String(stdout).match(new RegExp(`"${campo}":"[0-9a-f-]{36}"`, 'g')) || []).map(s => s.slice(campo.length + 4, -1)))];
function carpetasDeImagenes(stream, stdout, env = process.env, home = os.homedir()) {
  if (stream === 'agy') return idsDe(stdout, 'conversation_id').map(id => path.join(home, '.gemini', 'antigravity-cli', 'brain', id));
  if (stream === 'codex') {
    const base = env.CODEX_HOME ? String(env.CODEX_HOME).replace(/^~(?=$|[\\/])/, home) : path.join(home, '.codex');
    return idsDe(stdout, 'thread_id').map(id => path.join(base, 'generated_images', id));
  }
  return [];
}

function memoryExcerpt(dir, max = 1500) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.startsWith('.')).sort(); } catch { return ''; }
  let out = '';
  for (const f of files.slice(0, 4)) {
    if (out.length >= max) break;
    try { out += `\n# ${f}\n${fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 400)}`; } catch { /* un archivo ilegible no corta el chat */ }
  }
  return out.slice(0, max);
}

function createOfficeChat(oficinas) {
  const dirOf = office => path.join(oficinas.dirs(office).root, 'chat');
  const fileOf = office => path.join(dirOf(office), 'mensajes.jsonl');
  const settingsOf = office => path.join(dirOf(office), 'ajustes.json');
  const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

  function readSettings(office) {
    return { anfitrion: null, ...readJson(settingsOf(office), {}) };
  }
  function setHost(office, anfitrion) {
    const next = { ...readSettings(office), anfitrion: anfitrion || null };
    fs.mkdirSync(dirOf(office), { recursive: true });
    const dest = settingsOf(office);
    fs.writeFileSync(dest + '.tmp', JSON.stringify(next, null, 2));
    fs.renameSync(dest + '.tmp', dest);
    return next;
  }
  function append(office, msg) {
    const row = {
      id: crypto.randomBytes(8).toString('hex'),
      ts: new Date().toISOString(),
      autor: msg.autor,
      texto: String(msg.texto || ''),
      menciones: msg.menciones || [],
      fallo: msg.fallo || null,
    };
    fs.mkdirSync(dirOf(office), { recursive: true });
    fs.appendFileSync(fileOf(office), JSON.stringify(row) + '\n');
    return row;
  }
  function list(office, secrets = []) {
    let raw = '';
    try { raw = fs.readFileSync(fileOf(office), 'utf8'); } catch { return []; }
    return raw.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean).map(m => ({ ...m, texto: redact(m.texto, secrets) }));
  }
  return { readSettings, setHost, append, list, dirOf };
}

module.exports = { createOfficeChat, redact, mentioned, recipients, draftMission, chatPrompt, memoryExcerpt, readOnlyArgs, entregaDelPrompt, imagenesDelTurno, carpetasDeImagenes, slug, HISTORY_N };
