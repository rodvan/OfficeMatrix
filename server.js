// OfficeMatrix: orquestador local que pone a varias CLIs de IA a trabajar por turnos
// sobre una carpeta de proyecto compartida, hasta que todas aprueban el resultado.
// Sin dependencias: solo módulos de Node. La lógica pura vive en lib/ (y tiene tests en tests/).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execSync } = require('child_process');

const { createStreamParser, sayText } = require('./lib/streams');
const { parseReport } = require('./lib/protocol');
const { addObjections, applyReplies, pendingFor, blocking, setObjectionStatus, isEnvironmentBlock } = require('./lib/debate');
const memory = require('./lib/memory');
const { snapshot, diffSnapshots, workChanges, textDiffs } = require('./lib/snapshot');
const { computeAgentStats } = require('./lib/stats');
const handoffLib = require('./lib/handoff');
const { normalizeCycleConfig, cycleOutcome, judgeVerdict, plateauOutcome, plateauSummary } = require('./lib/cycle');
const { buildTurnBrief, buildParallelBrief, PHASES } = require('./lib/brief');
const contexto = require('./lib/contexto');
const workflows = require('./lib/workflows');
const templates = require('./lib/templates');
const { classifyFailure, isPartial } = require('./lib/failure');
const i18n = require('./lib/i18n'); // idioma de la app y de los avisos del servidor (EN por defecto)
const adjuntos = require('./lib/adjuntos');
const preview = require('./lib/preview');
const { createRegistry, EDIFICIO } = require('./lib/oficinas');
const { createModels } = require('./lib/modelos');
const empleados = require('./lib/empleados');
const { createTraspasos } = require('./lib/traspaso');
const { createManifests, controlDir } = require('./lib/manifiestos');
const acceso = require('./lib/acceso-local');
const hoy = require('./lib/hoy');
const { createBots, MAX_BODY: BOT_MAX_BODY } = require('./lib/bots');
const { createOfficeChat, redact, recipients, draftMission, chatPrompt, memoryExcerpt, readOnlyArgs, slug: chatSlug, imagenesDelTurno, carpetasAgy } = require('./lib/chat-oficina');
const editorialLib = require('./lib/editorial');
const { createViralHunt } = require('./lib/viralhunt');
const rutinasLib = require('./lib/rutinas');
const cadenaLib = require('./lib/cadena');
const cierreLib = require('./lib/cierre');
const { createDiscord } = require('./lib/discord-oficinas');

const ROOT = __dirname;
const DATA = process.env.OFFICEMATRIX_HOME ? path.resolve(process.env.OFFICEMATRIX_HOME) : ROOT;
const CONFIG_FILE = process.env.OFFICEMATRIX_CONFIG ? path.resolve(process.env.OFFICEMATRIX_CONFIG) : path.join(ROOT, 'agents.json');
const PROJECTS_DIR = path.join(DATA, 'proyectos');
const MEMORY_DIR = path.join(DATA, 'memoria');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 4321;
const PROJECT_MEMORY_DIR = 'memoria-oficina'; // copia de la memoria global dentro de cada proyecto
const IGNORED = new Set(['node_modules', '.git', '.office', '__pycache__', '.venv', 'dist', 'build', '.historial']);
const ACTIVITY_FILE = 'actividad.jsonl';
const UPLOADS_DIR = path.join(DATA, '.subidas'); // adjuntos subidos que aún no tienen misión
const TEMPLATES_FILE = path.join(DATA, 'plantillas.json'); // plantillas propias guardadas desde la UI
const oficinas = createRegistry(DATA); // simulaciones aisladas (lib/oficinas.js); el edificio es proyectos/ + memoria/
const modelos = createModels(path.join(DATA, '.cuotas.json')); // modelos de reserva cuando se acaba la cuota (lib/modelos.js)
const CONTROL_DIR = controlDir(DATA); // manifiestos y entrantes; OFFICEMATRIX_CONTROL lo saca de la raíz de datos
const traspasos = createTraspasos(DATA, oficinas, CONTROL_DIR); // el único cruce de memoria entre oficinas (lib/traspaso.js)
const manifiestos = createManifests(DATA, CONTROL_DIR);
const bots = createBots(DATA, oficinas); // Grok Bots externos por webhook (lib/bots.js; la puerta pública es puerta-bots.js)
const officeChat = createOfficeChat(oficinas); // chat de oficina, aparte de las misiones (lib/chat-oficina.js)
// Un bot de Discord por oficina (lib/discord-oficinas.js, docs/DISCORD.md): habla solo con su oficina; el de la Nave coordina.
const discordBots = createDiscord({
  oficinas, EDIFICIO, t: (k, v) => i18n.t(k, v),
  deps: {
    chat: (office, texto, { autor } = {}) => runOfficeChat(office, texto, { autor, sinArchivos: true, anfitrionDefecto: true, conImagenes: true }),
    aprobar: (office, pid, input) => aprobarPropuesta(office, pid, input),
    rechazar: (office, pid, input) => rechazarPropuesta(office, pid, input),
    propuestas: office => (editorial.regla(office) ? editorial.galeria(office, {}) : []),
    archivo: (office, pid, nombre) => editorial.archivo(office, pid, nombre),
    officeOfChat: chatId => { try { return oficinas.officeOf(chatId); } catch { return null; } },
    resumenNave: () => resumenNave(),
    onState: office => broadcast({ type: 'discord-updated', oficina: office }),
  },
});
// Las llaves que nunca se escriben en el chat ni se reenvían: las de los bots y el token de Discord de la oficina.
const secretsOf = office => [...bots.secretValues(office), ...discordBots.secretos(office)];
const chatBusy = new Set();
// Una CLI tarda en arrancar (Gemini y Codex, más): 20 s cortaba respuestas normales.
const CHAT_CLI_MS = Number(process.env.OFFICEMATRIX_CHAT_CLI_MS) || 180000;
const CHAT_BOT_MS = Number(process.env.OFFICEMATRIX_CHAT_BOT_MS) || 20000;
// Orden fija y sin metacaracteres: el texto del usuario va en un archivo del cajón, no en la línea de órdenes.
const CHAT_ARGV = 'Read the file chat-prompt.md in the current directory and reply with the chat message only. Do not edit, create or delete files.';
const editorial = editorialLib.createEditorial(oficinas); // Editorial continua: regla, tandas, bandeja y gusto (lib/editorial.js)
const viralhunt = createViralHunt(oficinas); // el token de la oficina solo lo usa el servidor (lib/viralhunt.js)
// La cookie no está activa en contexto. OFFICEMATRIX_COOKIE=1 la exige en /api y /raw (prueba de S1F, sin activar la frontera).
const panel = process.env.OFFICEMATRIX_COOKIE === '1' ? acceso.crear() : null;

fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(MEMORY_DIR, { recursive: true });

// ---------- Plantillas propias ----------

function readCustomTemplates() {
  try { return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')).filter(t => t && /^u-/.test(t.id)); } catch { return []; }
}

function writeCustomTemplates(list) {
  fs.writeFileSync(TEMPLATES_FILE + '.tmp', JSON.stringify(list, null, 2));
  fs.renameSync(TEMPLATES_FILE + '.tmp', TEMPLATES_FILE);
  templates.setCustomTemplates(list);
}

templates.setCustomTemplates(readCustomTemplates());

// ---------- Configuración de agentes ----------

// agents.json es tuyo (está en .gitignore): si falta, nace de agents.example.json, que es el que viene con el repo.
// Así un `git pull` nunca pisa tus cambios. Una CLI que no está instalada no rompe nada: sale como «no instalada».
const EXAMPLE_CONFIG = path.join(ROOT, 'agents.example.json');
function ensureConfig() {
  if (fs.existsSync(CONFIG_FILE) || process.env.OFFICEMATRIX_CONFIG || !fs.existsSync(EXAMPLE_CONFIG)) return;
  fs.copyFileSync(EXAMPLE_CONFIG, CONFIG_FILE);
}
function loadConfig() {
  ensureConfig();
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

// La configuración vista desde una oficina. Con empleados (S1), el equipo son ellos: cada uno es un agente virtual con
// la CLI y el modelo de su ficha (lib/empleados.js). Sin empleados, solo las IAs de su «equipo» (vacío = todas).
function configFor(officeId, snapshot = null) {
  const config = loadConfig();
  const o = oficinas.read(officeId || EDIFICIO);
  const staff = snapshot || (o?.empleados?.some(e => e.activo !== false) ? o : null);
  // Los bots externos de la oficina (Grok Bots por webhook) se suman siempre: el filtro «equipo» es de las CLIs.
  const extra = o ? bots.agentsOf(o.id) : [];
  if (staff && o) return { ...config, agents: [...empleados.agentesDe({ ...o, ...staff, id: o.id }, config.agents), ...extra], empleados: true };
  const equipo = o?.equipo || [];
  return { ...config, agents: [...(equipo.length ? config.agents.filter(a => equipo.includes(a.id)) : config.agents), ...extra] };
}
const officeOfChat = chatId => oficinas.officeOf(chatId) || EDIFICIO;
// La de una misión: si nació con empleados, los de su instantánea (cambiar una ficha a mitad no cambia esta misión).
function configForChat(chatId, chat = null) {
  let snap = null;
  const office = officeOfChat(chatId);
  const manifest = manifiestos.read(office, chatId);
  if (manifest) snap = manifest.equipo;
  else {
    // Migración de misiones previas: adoptar una vez la instantánea que ya tenían.
    snap = (chat || readChat(chatId)).plantilla_equipo || null;
    if (snap) manifiestos.create(office, chatId, snap);
  }
  return configFor(office, snap);
}
const memDirOf = chatId => oficinas.dirs(officeOfChat(chatId)).memoria;

const availability = {};
function isInstalled(cmd) {
  if (cmd === bots.CMD) return true; // un bot externo no es una CLI: está «instalado» si está configurado
  if (cmd in availability) return availability[cmd];
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'ignore' });
    availability[cmd] = true;
  } catch {
    availability[cmd] = false;
  }
  return availability[cmd];
}

function agentsWithStatus() {
  return loadConfig().agents.map(a => ({
    id: a.id, name: a.name, role: a.role, color: a.color, stream: a.stream || 'text',
    enabled: a.enabled !== false, installed: isInstalled(a.cmd),
  }));
}

// ---------- Chats (cada chat = una carpeta de proyecto) ----------

function slugify(text) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'proyecto';
}

// Carpeta de una misión, en la oficina que esté.
function chatDir(id) {
  const dir = oficinas.chatPath(id);
  if (!dir) throw Object.assign(new Error(i18n.t('server.error.chatMissing')), { status: 404 });
  return dir;
}

function readChat(id) {
  const chat = JSON.parse(fs.readFileSync(path.join(chatDir(id), '.office', 'chat.json'), 'utf8'));
  chat.debate ||= [];
  return chat;
}

function writeChat(chat, dir = chatDir(chat.id)) {
  const file = path.join(dir, '.office', 'chat.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(chat, null, 2));
  fs.renameSync(file + '.tmp', file); // escritura atómica: nunca queda un chat.json a medias
}

function updateChat(id, fn) {
  const chat = readChat(id);
  const result = fn(chat);
  writeChat(chat);
  return result;
}

function createChat(title, config, officeId = EDIFICIO) {
  const stamp = new Date().toISOString().slice(0, 10);
  const id = oficinas.freeChatId(`${stamp}-${slugify(title)}`); // único en todas las oficinas
  const dir = path.join(oficinas.dirs(officeId).proyectos, id);
  fs.mkdirSync(path.join(dir, '.office', 'reportes'), { recursive: true });
  const chat = { id, title, created: new Date().toISOString(), oficina: officeId, config, messages: [], debate: [] };
  // Instantánea del equipo (S1-SNAPSHOT): las fichas y la marca con las que nace la misión.
  const o = oficinas.read(officeId);
  if (o?.empleados?.some(e => e.activo !== false)) chat.plantilla_equipo = { empleados: o.empleados, marca: o.marca || null };
  if (chat.plantilla_equipo) manifiestos.create(officeId,id,chat.plantilla_equipo);
  writeChat(chat, dir);
  oficinas.remember(id, officeId);
  return chat;
}

function chatOutcome(c, isRunning) {
  if (isRunning) return 'running';
  const agentMsgs = c.messages.filter(m => m.kind === 'agent');
  const lastCycleSys = [...c.messages].reverse().find(m => m.kind === 'system' && (m.outcome || /^Comienza el ciclo|Impecable|Consenso|Se usaron|Ciclo detenido|Todos los agentes|Error del orquestador|El usuario aceptó/.test(m.text || '')));
  if (lastCycleSys && (lastCycleSys.outcome === 'started' || /^Comienza el ciclo/.test(lastCycleSys.text || ''))) return 'interrupted';
  if (lastCycleSys?.userAccepted || lastCycleSys?.outcome === 'aceptado' || ['unanime', 'consenso'].includes(lastCycleSys?.outcome) || /Impecable|Consenso|El usuario aceptó/.test(lastCycleSys?.text || '')) return 'ok';
  return agentMsgs.length ? 'partial' : 'new';
}

// El usuario pulsó «lo acepto así». No es unanime ni consenso: el equipo no aprobó.
function missionAccepted(c) {
  const last = [...(c.messages || [])].reverse().find(m => m.kind === 'system' && m.outcome);
  return !!(last && last.outcome !== 'started' && (last.userAccepted || last.outcome === 'aceptado'));
}

// Campo aditivo: conservar outcome para consumidores externos (llaves y om.js).
function stopReason(c, isRunning) {
  if (isRunning) return null;
  const last = [...c.messages].reverse().find(m => m.kind === 'system' && m.outcome);
  if (last?.userAccepted) return null;
  return ['meseta', 'retroceso', 'agotado'].includes(last?.outcome) ? last.outcome : null;
}

function listChats(officeId = EDIFICIO) {
  const base = oficinas.dirs(officeId).proyectos;
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(base, d.name, '.office', 'chat.json')))
    .map(d => {
      try {
        const c = readChat(d.name);
        const agentMsgs = c.messages.filter(m => m.kind === 'agent');
        const last = agentMsgs[agentMsgs.length - 1];
        return {
          id: c.id, title: c.title, created: c.created, running: running.has(c.id),
          mode: c.config?.mode || 'rondas', workflow: c.config?.workflow || 'relevo', turns: agentMsgs.length, lastScore: last?.score ?? null,
          openObjections: c.debate.filter(o => o.status === 'abierta' || o.status === 'disputada').length,
          outcome: chatOutcome(c, running.has(c.id)),
          stopReason: stopReason(c, running.has(c.id)),
          accepted: !running.has(c.id) && missionAccepted(c),
          cierre: cierreLib.resumen(path.join(base, d.name)),
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.created.localeCompare(a.created));
}

function addMessage(chatId, msg) {
  updateChat(chatId, chat => chat.messages.push({ ts: new Date().toISOString(), ...msg }));
  broadcast({ type: 'chat-updated', chatId });
}

function fileTree(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= 500) break;
    if (IGNORED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      out.push({ path: rel, dir: true });
      fileTree(full, base, out);
    } else {
      const st = fs.statSync(full);
      out.push({ path: rel, dir: false, size: st.size, mtime: st.mtimeMs, kind: preview.kindOf(rel) });
    }
  }
  return out;
}

const readIfExists = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

// ---------- Memoria (shared brain) ----------
// La memoria global (memoria/) se copia a <proyecto>/memoria-oficina al empezar un ciclo, porque algunas CLIs solo
// pueden escribir dentro de su carpeta. Después de CADA turno, lo que cambió se fusiona (tres vías) con la memoria
// global y la copia del proyecto se refresca con lo que otros ciclos o el usuario hayan escrito mientras tanto.

const PROJECT_MEMORY_TEMPLATE = `# Memoria del proyecto

> Los agentes de OfficeMatrix leen este archivo antes de trabajar y lo actualizan al terminar.

## Objetivo

## Decisiones tomadas (y por qué)

## Preferencias del usuario en este proyecto

## Estado actual

## Pendientes
`;

function syncMemoryIn(projectDir, MEMORY_DIR = memDirOf(path.basename(projectDir))) {
  const target = path.join(projectDir, PROJECT_MEMORY_DIR);
  fs.mkdirSync(target, { recursive: true });
  const base = {};
  for (const file of memory.listMemoryFiles(MEMORY_DIR)) {
    const content = fs.readFileSync(path.join(MEMORY_DIR, file), 'utf8');
    fs.writeFileSync(path.join(target, file), content);
    base[file] = content;
  }
  const projectMemory = path.join(projectDir, 'MEMORIA.md');
  if (!fs.existsSync(projectMemory)) fs.writeFileSync(projectMemory, PROJECT_MEMORY_TEMPLATE);
  return base;
}

// Devuelve [{ file, merged }] de los archivos que cambiaron. Actualiza "base" para el siguiente turno.
function syncMemoryOut(projectDir, base, MEMORY_DIR = memDirOf(path.basename(projectDir))) {
  const source = path.join(projectDir, PROJECT_MEMORY_DIR);
  const changed = [];
  for (const file of memory.listMemoryFiles(source)) {
    if (!memory.validName(file)) continue;
    const ours = fs.readFileSync(path.join(source, file), 'utf8');
    if (ours === base[file]) continue;
    const globalFile = path.join(MEMORY_DIR, file);
    const theirs = fs.existsSync(globalFile) ? fs.readFileSync(globalFile, 'utf8') : null;
    const result = memory.mergeText(base[file] ?? '', ours, theirs);
    memory.writeWithHistory(MEMORY_DIR, file, result);
    if (result !== ours) fs.writeFileSync(path.join(source, file), result);
    changed.push({ file, merged: theirs != null && theirs !== (base[file] ?? null) && theirs !== ours });
    base[file] = result;
  }
  // Trae lo que otros escribieron en la memoria global mientras tanto.
  for (const file of memory.listMemoryFiles(MEMORY_DIR)) {
    const content = fs.readFileSync(path.join(MEMORY_DIR, file), 'utf8');
    if (content !== base[file]) {
      fs.writeFileSync(path.join(source, file), content);
      base[file] = content;
    }
  }
  return changed;
}

function memoryDocs(MEMORY_DIR) {
  return memory.listMemoryFiles(MEMORY_DIR).map(file => ({ file, scope: 'oficina', content: fs.readFileSync(path.join(MEMORY_DIR, file), 'utf8') }));
}

function projectDocs(PROJECTS_DIR) {
  const docs = [];
  if (!fs.existsSync(PROJECTS_DIR)) return docs;
  for (const d of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const name of ['MEMORIA.md', 'HANDOFF.md']) {
      const f = path.join(PROJECTS_DIR, d.name, name);
      if (fs.existsSync(f)) docs.push({ file: `${d.name}/${name}`, scope: d.name, content: fs.readFileSync(f, 'utf8') });
    }
  }
  return docs;
}

// ---------- Eventos en vivo (Server-Sent Events) ----------

const clients = new Set();
function broadcast(event) {
  if (event.type !== 'activity' && event.type !== 'progress' && event.type !== 'office-chat') { try { discordBots.alEvento(event); } catch { /* Discord nunca frena la app */ } }
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch { clients.delete(res); }
  }
}
setInterval(() => { for (const res of clients) { try { res.write(': ping\n\n'); } catch {} } }, 25000).unref();

// ---------- El ciclo de la oficina ----------

const running = new Map(); // chatId -> { proc, stopped, agentId, progress, activity }

const truncate = (s, n) => (s.length > n ? s.slice(0, n) + i18n.t('brief.clipped') : s);
// Idioma de lo que leen los agentes (prompt, HANDOFF, aportes): el del último pedido, como el brief (lib/brief.js).
const chatLang = chat => i18n.detectLang((chat?.messages || []).filter(m => m.kind === 'user' && !m.intervention).at(-1)?.text, i18n.getLang());
const leftNote = left => (left.length ? i18n.t('server.turn.leaves', { agents: left.join(', ') }) : i18n.t('server.turn.nobodyLeft'));
const cliOutput = result => i18n.t('server.turn.cliOutput', { code: result.code, output: truncate(result.stderr || result.stdout || i18n.t('server.turn.empty'), 2000) });
const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');

function quoteArg(arg) {
  if (process.platform !== 'win32') return arg;
  return /[\s,"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

// Un turno con modelos de reserva: si la CLI dice que se acabó la cuota del modelo, se marca agotado y el mismo turno
// se repite con el siguiente modelo de su lista en agents.json ("models"). Sin lista, es un turno normal.
// Si el servicio estaba saturado (529/503) o no hubo conexión, no es culpa de nadie: se espera y se repite el turno
// (RETRY_WAITS_MS, en ms; las pruebas lo acortan con OFFICEMATRIX_RETRY_MS) en vez de sacar al agente del ciclo.
const RETRY_WAITS_MS = process.env.OFFICEMATRIX_RETRY_MS ? process.env.OFFICEMATRIX_RETRY_MS.split(',').map(Number) : [60e3, 180e3];
const TRANSIENT = new Set(['saturado', 'red']);
const sleepUnlessStopped = (chatId, ms) => new Promise(resolve => {
  const t0 = Date.now();
  const tick = setInterval(() => { if (Date.now() - t0 >= ms || running.get(chatId)?.stopped) { clearInterval(tick); resolve(); } }, 500);
});

async function runTurn(chatId, agent, opts) {
  let model = modelos.pick(agent);
  let retries = 0;
  for (;;) {
    const result = await runAgent(chatId, agent, { ...opts, model });
    result.model = model;
    if (running.get(chatId)?.stopped) return result;
    const failure = classifyFailure({ ...result, report: (result.report || result.stdout).trim(), idleMinutes: opts.idleMin, timeoutMinutes: opts.timeoutMin });
    if (failure && TRANSIENT.has(failure.kind) && retries < RETRY_WAITS_MS.length) {
      const wait = RETRY_WAITS_MS[retries++];
      addMessage(chatId, { kind: 'system', text: `⏳ ${agent.name}: ${failure.label.toLowerCase()} (${failure.detail.slice(0, 120)}). No es tu cuota: reintento ${retries} de ${RETRY_WAITS_MS.length} en ${Math.round(wait / 1000)} s.` });
      await sleepUnlessStopped(chatId, wait);
      if (running.get(chatId)?.stopped) return result;
      continue;
    }
    if (!model) return result;
    if (!modelos.isQuota(failure)) return result;
    const next = modelos.exhaust(agent, model);
    addMessage(chatId, { kind: 'system', text: i18n.t(next ? 'server.turn.quotaNext' : 'server.turn.quotaNone', { name: agent.name, model, next }) });
    if (!next) return result;
    model = next;
  }
}

const TOOL_KINDS = new Set(['read', 'write', 'cmd', 'search', 'web', 'plan', 'agent', 'tool']);

// ---------- Turno de un bot externo (Grok Bot por webhook) ----------
// El bot no lee el disco: recibe el brief de su turno y el texto de los archivos que cita. Responde por POST a
// "responder_a" (puerta-bots.js → /api/bots/respuesta/<token>) y su texto se registra como su turno.
const BOT_FILE_MAX = 30000;   // por archivo citado
const BOT_FILES_MAX = 600000; // en total (el cuerpo no puede pasar de 1 MiB)
function botFiles(dir, brief) {
  const cited = new Set(['HANDOFF.md', 'MEMORIA.md']);
  for (const m of String(brief).matchAll(/`([^`\s]+\.[a-z0-9]{1,6})`/gi)) cited.add(m[1].replace(/^\.\//, ''));
  const out = [];
  let total = 0;
  for (const rel of cited) {
    const found = preview.resolveInside(dir, rel);
    if (found.error || found.size > 2e6 || !/\.(md|txt|html?|json|csv|js|css|py|ya?ml)$/i.test(rel)) continue;
    let text = fs.readFileSync(found.file, 'utf8');
    if (text.length > BOT_FILE_MAX) text = text.slice(0, BOT_FILE_MAX) + '\n…(recortado)';
    if (total + text.length > BOT_FILES_MAX) break;
    total += text.length;
    out.push({ ruta: rel, texto: text });
  }
  return out;
}


async function runBotTurn(chatId, agent, { timeoutMin, round, onEvent, briefFile = 'turno.md', phase = null, folder = null }) {
  const dir = chatDir(chatId);
  const chat = readChat(chatId);
  const office = agent.bot.oficina;
  const fail = (stderr, extra = {}) => ({ code: 1, stdout: '', stderr, report: '', streaming: false, usage: null, toolCounts: {}, toolErrors: 0, timedOut: false, idle: false, ...extra });
  const emit = ev => onEvent({ ts: new Date().toISOString(), agentId: agent.id, round, ...ev });
  const brief = readIfExists(path.join(dir, '.office', briefFile));
  const lang = chatLang(chat);
  const ttl = timeoutMin * 60000;
  const turn = bots.openTurn({ chatId, agentId: agent.id, round, phase }, ttl);
  const responder = bots.replyUrl(turn.token);
  if (!responder) {
    turn.cancel();
    return fail(i18n.t('server.bot.noTunnel'));
  }
  emit({ kind: 'tool', label: i18n.t('server.bot.sending', { name: agent.name }) });
  const payload = {
    tipo: 'turno', oficina: office, mision: { id: chatId, titulo: chat.title }, turno: { ronda: round, fase: phase || 'relevo' },
    bot: { id: agent.bot.id, nombre: agent.name, puesto: agent.role },
    brief, archivos: botFiles(dir, brief), responder_a: responder, caduca: new Date(Date.now() + ttl).toISOString(), formato: i18n.t('server.bot.format', {}, lang),
  };
  const sent = await bots.send(office, agent.bot.id, payload);
  if (!sent.ok) {
    turn.cancel();
    return fail(i18n.t('server.bot.rejected', { name: agent.name, why: sent.status ? `HTTP ${sent.status}` : sent.error }));
  }
  emit({ kind: 'think', label: i18n.t('server.bot.waiting', { name: agent.name }) });
  const reply = await Promise.race([turn.wait, sleepUnlessStopped(chatId, ttl).then(() => null)]);
  if (!reply) {
    turn.cancel();
    if (running.get(chatId)?.stopped) return fail(i18n.t('server.turn.stopped'));
    return fail(i18n.t('server.bot.noReply', { name: agent.name, min: timeoutMin }));
  }
  const texto = String(reply.texto || '').trim();
  // El aporte queda en el proyecto: el borrador o la síntesis en su carpeta; lo demás en aportes/.
  const rel = folder && ['borrador', 'sintesis'].includes(phase)
    ? `${folder.replace(/\/?$/, '/')}aporte-${agent.bot.id}.md`
    : `aportes/${agent.bot.id}-${phase || 'relevo'}-${round}.md`;
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), `${i18n.t('server.bot.contribution', { name: agent.name, phase: phase || 'relevo', round }, lang)}\n\n${texto}\n`);
  emit({ kind: 'write', label: i18n.t('server.bot.saving', { file: rel }), file: rel });
  emit({ kind: 'text', label: i18n.t('stream.drafting'), detail: texto });
  try { bots.touch(office, agent.bot.id, { ultimaRespuesta: new Date().toISOString() }); } catch {}
  return { code: 0, stdout: texto, stderr: '', report: texto, streaming: false, usage: null, toolCounts: { write: 1 }, toolErrors: 0, timedOut: false, idle: false, aporte: rel };
}

// ---------- Chat de oficina (no es una misión) ----------
// Una CLI contesta en un cajón temporal: su directorio de trabajo no es la oficina, así que un
// archivo que cree ahí no toca el proyecto. Un bot contesta por su webhook con tipo "chat".
function chatMembers(office) {
  const cfg = configFor(office);
  const clis = cfg.agents.filter(a => !a.bot).map(a => ({
    tipo: 'cli', id: a.id, sceneId: a.id, nombre: a.name, puesto: a.role || '', avatar: a.avatar || '', mencion: chatSlug(a.name), color: a.color,
  }));
  const botMembers = bots.list(office).map(b => ({
    tipo: 'bot', id: b.id, sceneId: `bot-${b.id}`, nombre: b.nombre, puesto: b.puesto || '', avatar: b.avatar || '', mencion: chatSlug(b.nombre), color: b.color, sinLlave: !!b.sinLlave,
  }));
  return [...clis, ...botMembers];
}

function chatFailure(stderr, extra = {}) {
  return classifyFailure({ code: 1, stdout: '', stderr, report: '', timedOut: false, ...extra }) || { kind: 'fallo', label: i18n.t('fail.fallo.label'), detail: String(stderr || '').slice(0, 200), hint: i18n.t('fail.fallo.hint') };
}

async function runChatBot(office, quien, mensaje, history) {
  const secrets = secretsOf(office);
  if (quien.sinLlave) return { texto: '', fallo: chatFailure(`[bot-webhook] ${i18n.t('bots.err.noWebhook')}`) };
  const ttl = CHAT_BOT_MS;
  const turn = bots.openTurn({ chat: true, oficina: office, bot: quien.id }, ttl);
  const responder = bots.replyUrl(turn.token);
  if (!responder) { turn.cancel(); return { texto: '', fallo: chatFailure(i18n.t('server.bot.noTunnel')) }; }
  const payload = {
    tipo: 'chat', oficina: office, bot: { id: quien.id, nombre: quien.nombre, puesto: quien.puesto },
    mensaje: redact(mensaje, secrets),
    historial: history.slice(-8).map(m => ({ de: m.autor?.nombre || '?', texto: m.texto })),
    responder_a: responder, caduca: new Date(Date.now() + ttl).toISOString(), formato: i18n.t('server.chat.format'),
  };
  const sent = await bots.send(office, quien.id, payload);
  if (!sent.ok) {
    turn.cancel();
    return { texto: '', fallo: chatFailure(i18n.t('server.bot.rejected', { name: quien.nombre, why: sent.status ? `HTTP ${sent.status}` : sent.error })) };
  }
  const reply = await Promise.race([turn.wait, new Promise(r => { const timer = setTimeout(() => r(null), ttl); timer.unref?.(); })]);
  if (!reply) {
    turn.cancel();
    return { texto: '', fallo: chatFailure(i18n.t('server.chat.noReply', { name: quien.nombre, s: Math.max(1, Math.round(ttl / 1000)) })) };
  }
  const texto = redact(String(reply.texto || '').trim(), secrets);
  try { bots.touch(office, quien.id, { ultimaRespuesta: new Date().toISOString() }); } catch { /* la marca es opcional */ }
  if (!texto) return { texto: '', fallo: chatFailure(i18n.t('server.chat.empty', { name: quien.nombre })) };
  return { texto, fallo: null };
}

function runChatCli(office, quien, mensaje, history, { sinArchivos = false, conImagenes = false } = {}) {
  const agent = configFor(office).agents.find(a => a.id === quien.id && !a.bot);
  if (!agent) return Promise.resolve({ texto: '', fallo: chatFailure(i18n.t('server.chat.empty', { name: quien.nombre })) });
  const prompt = chatPrompt({
    nombre: quien.nombre,
    historial: history.slice(-8).map(m => ({ de: m.autor?.nombre || '?', texto: m.texto })),
    memoria: memoryExcerpt(oficinas.dirs(office).memoria),
    mensaje,
    imagenes: conImagenes,
  });
  const desde = Date.now() - 1000;
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'om-chat-'));
  fs.writeFileSync(path.join(sandbox, 'chat-prompt.md'), prompt);
  const base = Array.isArray(agent.chatArgs) ? { ...agent, args: agent.chatArgs } : agent;
  const args = readOnlyArgs(agent.stream, modelos.argsFor(base, modelos.pick(agent)), { sinArchivos }).map(a => String(a).replaceAll('{prompt}', CHAT_ARGV));
  const timeoutMs = CHAT_CLI_MS;
  return new Promise(resolve => {
    let env = { ...process.env };
    delete env.CLAUDECODE;
    const isWin = process.platform === 'win32';
    const native = /(?:^|[\\/])node(?:\.exe)?$/i.test(agent.cmd) || /\.exe$/i.test(agent.cmd);
    const proc = isWin && !native
      ? spawn([agent.cmd, ...args.map(quoteArg)].join(' '), { cwd: sandbox, env, shell: true, windowsHide: true })
      : spawn(agent.cmd, args, { cwd: sandbox, env, windowsHide: true });
    proc.stdin.end();
    // Las CLIs reales hablan en stream-json: el globo y la respuesta salen del parser, no del JSON crudo.
    const parser = createStreamParser(agent.stream || 'text', { cwd: sandbox });
    let stdout = '', stderr = '', timedOut = false, settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Desde Discord: las imágenes que generó en este turno viajan con la respuesta (se leen antes de borrar el cajón).
      const imagenes = conImagenes ? imagenesDelTurno([sandbox, ...(agent.stream === 'agy' ? carpetasAgy(stdout) : [])], desde) : [];
      fs.rmSync(sandbox, { recursive: true, force: true });
      parser.end();
      const texto = redact(parser.finalText(), secretsOf(office));
      if (timedOut || code !== 0 || (!texto && !imagenes.length)) {
        const fallo = classifyFailure({ code: code || 1, stdout, stderr, report: texto, timedOut, timeoutMinutes: Math.round(timeoutMs / 6000) / 10 })
          || chatFailure(stderr || i18n.t('server.chat.empty', { name: quien.nombre }));
        return resolve({ texto, fallo, imagenes });
      }
      resolve({ texto, fallo: null, imagenes });
    };
    const timer = setTimeout(() => { timedOut = true; stderr += '\n[OfficeMatrix] Tiempo agotado.'; killTree(proc); }, timeoutMs);
    proc.stdout.on('data', c => {
      const text = stripAnsi(c.toString());
      if (stdout.length < 2e5) stdout += text;
      parser.feed(text);
      const safe = redact(parser.usedStreaming ? parser.finalText() : stdout, secretsOf(office));
      broadcast({ type: 'office-chat', oficina: office, fase: 'delta', quien: { sceneId: quien.sceneId, nombre: quien.nombre }, texto: safe.slice(-500) });
    });
    proc.stderr.on('data', c => { if (stderr.length < 2e4) stderr += stripAnsi(c.toString()); });
    proc.on('error', err => { stderr += `\n${err.message}`; finish(1); });
    proc.on('close', code => finish(code));
  });
}

async function runOfficeChat(office, texto, { autor = null, sinArchivos = false, anfitrionDefecto = false, conImagenes = false } = {}) {
  if (chatBusy.has(office)) { const err = new Error(i18n.t('chat.err.busy')); err.status = 409; throw err; }
  chatBusy.add(office);
  try {
    const members = chatMembers(office);
    const secrets = secretsOf(office);
    const clean = redact(String(texto || ''), secrets).trim();
    if (!clean) { const err = new Error(i18n.t('server.error.taskRequired')); err.status = 400; throw err; }
    // Desde Discord, sin anfitrión elegido contesta Claude (o la primera IA): un "hola" no debe quedarse sin respuesta.
    const porDefecto = anfitrionDefecto ? (members.find(m => m.tipo === 'cli' && m.id === 'claude') || members.find(m => m.tipo === 'cli')) : null;
    const route = recipients(clean, members, officeChat.readSettings(office).anfitrion || porDefecto?.id);
    const userMsg = officeChat.append(office, { autor: { tipo: 'owner', id: 'owner', nombre: autor || 'You' }, texto: clean, menciones: route.quienes.map(q => q.mencion) });
    broadcast({ type: 'office-chat', oficina: office, fase: 'mensaje', mensaje: userMsg });
    const produced = [userMsg];
    if (!route.quienes.length) {
      const note = officeChat.append(office, {
        autor: { tipo: 'system', id: 'system', nombre: 'OfficeMatrix' },
        texto: i18n.t(route.motivo === 'desconocida' ? 'chat.unknownMention' : 'chat.noHost'),
      });
      produced.push(note);
      broadcast({ type: 'office-chat', oficina: office, fase: 'mensaje', mensaje: note });
      return produced;
    }
    for (const quien of route.quienes) {
      broadcast({ type: 'office-chat', oficina: office, fase: 'hablando', quien: { sceneId: quien.sceneId, nombre: quien.nombre } });
      const history = officeChat.list(office, secrets);
      const result = quien.tipo === 'bot' ? await runChatBot(office, quien, clean, history) : await runChatCli(office, quien, clean, history, { sinArchivos, conImagenes });
      const msg = officeChat.append(office, {
        autor: { tipo: quien.tipo, id: quien.id, nombre: quien.nombre, avatar: quien.avatar, puesto: quien.puesto, sceneId: quien.sceneId },
        texto: redact(result.texto || (result.imagenes?.length ? `🖼️ ${result.imagenes.map(i => i.name).join(', ')}` : ''), secrets),
        fallo: result.fallo,
      });
      // Las imágenes no se guardan en el chat: solo viajan en lo que se devuelve (a Discord).
      produced.push(result.imagenes?.length ? { ...msg, imagenes: result.imagenes } : msg);
      broadcast({ type: 'office-chat', oficina: office, fase: 'mensaje', mensaje: msg });
      broadcast({ type: 'office-chat', oficina: office, fase: 'callado', quien: { sceneId: quien.sceneId } });
    }
    return produced;
  } finally {
    chatBusy.delete(office);
  }
}

async function assistantStatus() {
  const gate = await bots.gateUp();
  const tunnel = await bots.tunnelUp();
  const tunnelKey = tunnel.ok ? 'wizard.tunnel.ok' : tunnel.reason === 'missing' ? 'wizard.tunnel.missing' : tunnel.reason === 'bad' ? 'wizard.tunnel.bad' : 'wizard.tunnel.down';
  return {
    comprobaciones: [
      { id: 'puerta', ok: gate.ok, clave: gate.ok ? 'wizard.gate.ok' : 'wizard.gate.down', vars: { port: gate.port } },
      { id: 'tunel', ok: tunnel.ok, clave: tunnelKey, vars: { ms: tunnel.ms || 0, why: String(tunnel.error || tunnel.status || tunnel.reason || '') } },
    ],
    bloques: bots.blocks(i18n.getLang()),
    puerto: gate.port,
  };
}

function runAgent(chatId, agent, { timeoutMin, idleMin, round, onEvent, briefFile = 'turno.md', model = null, phase = null, folder = null }) {
  if (agent.bot) return runBotTurn(chatId, agent, { timeoutMin, round, onEvent, briefFile, phase, folder });
  return new Promise(resolve => {
    const dir = chatDir(chatId);
    const prompt = i18n.t('server.turn.prompt', { name: agent.name, file: briefFile }, chatLang(readChat(chatId)));
    const args = modelos.argsFor(agent, model).map(a => a.replace('{prompt}', prompt));
    let env = { ...process.env };
    delete env.CLAUDECODE; // permite lanzar claude aunque el servidor se inicie desde Claude Code
    if (agent.empleado) {
      // Empleado de una oficina: entorno con lista blanca (sin CLAUDE_CODE_*, claves ni tokens del servidor) y sin
      // instrucciones heredadas de carpetas padre. Se comprueba antes de crear el proceso: no se gasta un turno.
      env = empleados.envParaTurno(agent.oficina?.id || '', process.env);
      const padres = empleados.instruccionesEnPadres(dir);
      if (padres.length) {
        const msg = i18n.t('server.turn.parentInstructions', { paths: padres.join(', ') });
        return resolve({ code: 1, stdout: '', stderr: msg, report: '', streaming: false, usage: null, toolCounts: {}, toolErrors: 0, timedOut: false, idle: false, padre: padres });
      }
    }
    // Variables propias del perfil en agents.json, p. ej. una segunda cuenta de la misma CLI con su carpeta de sesión
    // aparte ({ "GROK_HOME": "~/.grok-personal" }). "~" al inicio es la carpeta del usuario.
    if (agent.env && typeof agent.env === 'object') {
      for (const [k, v] of Object.entries(agent.env)) env[k] = String(v).replace(/^~(?=$|[\\/])/, require('os').homedir());
    }

    const isWin = process.platform === 'win32';
    // En Windows las CLIs son .cmd/.ps1 y necesitan shell: se pasa una sola línea ya entrecomillada
    // (equivale a lo que hacía spawn con args + shell, sin el aviso DEP0190 de Node 24).
    const native = /(?:^|[\\/])node(?:\.exe)?$/i.test(agent.cmd) || /\.exe$/i.test(agent.cmd);
    const proc = isWin && !native
      ? spawn([agent.cmd, ...args.map(quoteArg)].join(' '), { cwd: dir, env, shell: true, windowsHide: true })
      : spawn(agent.cmd, args, { cwd: dir, env, windowsHide: true });
    proc.officeNative = native;
    proc.stdin.end();
    const state = running.get(chatId) || relatores.get(chatId); // el relator corre con el ciclo ya cerrado
    state.proc = proc;
    state.procs.add(proc); // en los modos paralelos hay varias CLIs a la vez: "Detener" las corta todas

    const parser = createStreamParser(agent.stream || 'text', { cwd: dir });
    let stdout = '', stderr = '';
    const toolCounts = {};
    let toolErrors = 0;
    const emit = events => {
      for (const ev of events) {
        if (TOOL_KINDS.has(ev.kind)) toolCounts[ev.kind] = (toolCounts[ev.kind] || 0) + 1;
        if (ev.kind === 'error') toolErrors++;
        onEvent({ ts: new Date().toISOString(), agentId: agent.id, round, ...ev });
      }
    };
    // Vigilante: una CLI colgada (esperando una confirmación, sin red…) no emite nada. Si pasa idleMin sin
    // ninguna salida, se corta y el ciclo sigue con el resto. 0 lo desactiva; el tope total sigue siendo timeoutMin.
    let timedOut = false, idle = false, idleTimer = null;
    const touch = () => {
      if (!idleMin) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { idle = true; stderr += `\n${i18n.t('server.turn.idleCut', { min: idleMin })}`; if (!killTree(proc)) stderr += `\n${i18n.t('server.turn.killUnconfirmed')}`; }, idleMin * 60000);
    };
    touch();
    proc.stdout.on('data', c => {
      touch();
      const text = stripAnsi(c.toString());
      if (stdout.length < 4e6) stdout += text;
      emit(parser.feed(text));
    });
    proc.stderr.on('data', c => {
      touch();
      const text = stripAnsi(c.toString());
      if (stderr.length < 2e5) stderr += text;
      for (const line of text.split(/\r?\n/).filter(l => l.trim())) {
        emit([{ kind: 'stderr', label: line.trim().slice(0, 60), detail: line.trim().slice(0, 500) }]);
      }
    });

    const timer = setTimeout(() => { timedOut = true; stderr += '\n[OfficeMatrix] Tiempo agotado.'; killTree(proc); }, timeoutMin * 60000);
    proc.on('error', err => { stderr += `\n[OfficeMatrix] ${err.message}`; });
    proc.on('close', code => {
      state.procs.delete(proc);
      clearTimeout(timer);
      clearTimeout(idleTimer);
      emit(parser.end());
      resolve({ code, stdout, stderr: stderr.trim(), report: parser.finalText(), streaming: parser.usedStreaming, usage: parser.usage, toolCounts, toolErrors, timedOut, idle });
    });
  });
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return true;
  if (process.platform === 'win32') {
    try { execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' }); return true; } catch {
      // El handle de spawn permite cortar el ejecutable nativo propio aunque taskkill falle.
      // Esto NO demuestra que hayan muerto sus descendientes: el llamador lo informa.
      if (proc.officeNative) { try { proc.kill('SIGKILL'); } catch {} }
      return false;
    }
  } else {
    return proc.kill('SIGTERM');
  }
}

function appendActivity(chatId, entry) {
  try {
    const file = path.join(chatDir(chatId), '.office', ACTIVITY_FILE);
    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch {}
}

function readActivity(chatId, limit = 600) {
  const file = path.join(chatDir(chatId), '.office', ACTIVITY_FILE);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const briefFileOf = agent => (agent.empleado ? `turno-${agent.id}.md` : 'turno.md');

// Reserva (§1.6): si la CLI de un empleado cae por saldo, límite o sesión, el turno se repite UNA vez con su reserva.
// La ficha es la misma; el reporte dice con qué modelo trabajó. Si la reserva coincide con el modelo de otro del
// equipo, el paso queda marcado «diversidad reducida» (se revisaría a sí mismo).
async function runAgentWithReserve(chatId, agent, opts, team = []) {
  const first = await runTurn(chatId, agent, opts); // con la lista de modelos de agents.json, si la tiene
  const out = { result: first, used: agent, reserva: null };
  if (!agent.reserva || running.get(chatId)?.stopped) return out;
  const failure = classifyFailure({ ...first, report: (first.report || first.stdout).trim(), idleMinutes: opts.idleMin, timeoutMinutes: opts.timeoutMin });
  if (!failure || !['saldo', 'limite', 'sesion'].includes(failure.kind)) return out;
  const used = { ...agent.reserva, empleado: agent.empleado, oficina: agent.oficina, avatar: agent.avatar };
  const same = m => team.some(t => t.id !== agent.id && t.modelo && t.modelo.cli === m.cli && (t.modelo.id ?? null) === (m.id ?? null));
  out.reserva = { motivo: failure.label, de: agent.modeloLabel, a: used.modeloLabel, diversidadReducida: same(used.modelo) };
  addMessage(chatId, { kind: 'system', text: i18n.t('server.turn.reserve', { name: agent.name, to: used.modeloLabel, from: agent.modeloLabel, reason: failure.label.toLowerCase() }) +
    (out.reserva.diversidadReducida ? i18n.t('server.turn.reserveSame') : '') });
  try { oficinas.bitacora(officeOfChat(chatId), i18n.t('server.turn.reserveLog', { name: agent.name, to: used.modeloLabel, from: agent.modeloLabel, reason: failure.label.toLowerCase() })); } catch {}
  out.result = await runAgent(chatId, used, opts);
  out.used = used;
  return out;
}

// Con qué modelo trabajó un turno de empleado (D6): el pedido y, si cayó, la reserva.
const modelInfo = (used, reserva) => (used?.modeloLabel ? { modelo: used.modeloLabel, ...(reserva ? { reserva } : {}) } : {});

// Continuidad (D56): en una oficina propia, las últimas misiones cerradas y su siguiente paso. El edificio mezcla
// encargos sin relación, así que ahí no se añade nada.
function previasDeOficina(chatId) {
  const office = officeOfChat(chatId);
  if (office === EDIFICIO) return [];
  try {
    const misiones = listChats(office).filter(c => c.id !== chatId && !c.running).map(c => {
      try {
        return { ...readChat(c.id), handoff: readIfExists(path.join(chatDir(c.id), 'HANDOFF.md')) };
      } catch { return null; }
    });
    return hoy.ultimasEntregas(misiones, { excluir: chatId, n: 3, lang: chatLang(readChat(chatId)) });
  } catch { return []; }
}

function writeTurnBrief(chatId, projectDir, { agent, team, info }) {
  const chat = readChat(chatId);
  const handoff = readIfExists(path.join(projectDir, 'HANDOFF.md'));
  const userText = chat.messages.filter(m => m.kind === 'user').map(m => m.text).join('\n');
  const activeIds = team.map(a => a.id);
  const relevant = memory.relevantEntries(userText, memoryDocs(memDirOf(chatId)), 6);
  const pending = pendingFor(chat.debate, agent.id);
  const body = buildTurnBrief({
    chat, agent, team, info, handoff,
    previas: previasDeOficina(chatId),
    pending,
    openCount: blocking(chat.debate, activeIds).length,
    memoryDir: PROJECT_MEMORY_DIR,
    memoryFiles: memory.listMemoryFiles(path.join(projectDir, PROJECT_MEMORY_DIR)),
    relevant,
    projectDir,
  });
  // Escritura atómica: el agente puede estar leyendo turno.md en este momento. Los empleados tienen cada uno el suyo.
  const file = path.join(projectDir, '.office', briefFileOf(agent));
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, file);

  // La misma página, para quien abra .office/contexto.md. No es un segundo paquete: es el brief.
  try { contexto.writeContextFiles(projectDir, agent.id, body); } catch {}
}

// Una directiva o una objeción nueva invalida la racha ya, no al terminar el turno,
// y reescribe el brief que el agente en curso puede volver a leer.
function markIntervened(chatId) {
  const state = running.get(chatId);
  if (!state) return;
  state.intervened = true;
  // La meseta no compara rondas en las que el usuario cambió el rumbo (D46).
  if (state.progress?.round) (state.intervenedRounds ||= new Set()).add(state.progress.round);
  if (state.progress) {
    state.progress.approvalsInRow = 0;
    state.progress.doneInRow = 0;
    try {
      state.progress.openObjections = blocking(readChat(chatId).debate, state.activeIds).length;
    } catch {}
    broadcast({ type: 'progress', chatId, progress: state.progress });
  }
  for (const rewrite of state.briefs?.values() || []) { try { rewrite(); } catch {} } // modos paralelos: cada turno-<id>.md en curso
  if (!state.turnCtx) return;
  try { writeTurnBrief(chatId, chatDir(chatId), state.turnCtx); } catch {}
}

function writeHandoffStatus(projectDir, chat, info, turns) {
  const file = path.join(projectDir, 'HANDOFF.md');
  // El HANDOFF lo leen los agentes: va en el idioma del pedido, como el brief.
  const lang = chatLang(chat);
  const block = handoffLib.statusBlock({
    lang, chatTitle: chat.title, mode: info.mode, round: info.round, maxRounds: info.maxRounds, turns,
    openObjections: chat.debate.filter(o => o.status === 'abierta' || o.status === 'disputada'),
  });
  fs.writeFileSync(file, handoffLib.upsertStatus(readIfExists(file), block, lang));
}

const BUBBLE_KINDS = new Set(['read', 'write', 'cmd', 'search', 'web', 'plan', 'agent', 'tool', 'think', 'text', 'error']);
// Lo último que el agente pensó o dijo (para su globo), o null si el evento no trae nada que decir.
const saidBy = e => ['say', 'think', 'text'].includes(e.kind) && e.detail?.trim() ? sayText(e.detail) : null;

async function runCycle(chatId) {
  const chat0 = readChat(chatId);
  const config = configForChat(chatId, chat0);
  const cfg = normalizeCycleConfig(chat0.config || {}, config);
  const { mode, maxRounds, minScore } = cfg;
  const team = cfg.team
    .map(t => {
      const a = config.agents.find(x => x.id === t.id);
      return a && { ...a, role: t.role || a.role };
    })
    .filter(a => a && isInstalled(a.cmd));
  if (!team.length) {
    addMessage(chatId, { kind: 'system', text: i18n.t('server.notice.noAgents') });
    return;
  }
  if (cfg.workflow !== 'relevo' && team.length > 1) return runParallelCycle(chatId, { config, chat0, cfg, team });
  const projectDir = chatDir(chatId);
  const state = { proc: null, procs: new Set(), live: new Map(), stopped: false, agentId: null, progress: null, activity: '' };
  cortarRelator(chatId);
  running.set(chatId, state);
  registrarBase(chatId);
  const cycle = Date.now();
  const failed = new Set();
  const lastScores = {};
  const cycleTurns = [];
  let approvalsInRow = 0, doneInRow = 0, turn = 0;
  let memoryBase = {};
  let outcome = { finished: false };
  let ending = null; // { outcome, summary } para el aviso de fin de ciclo

  const activeTeam = () => team.filter(a => !failed.has(a.id));
  const openBlocking = () => blocking(readChat(chatId).debate, activeTeam().map(a => a.id)).length;
  const openProductBlocking = () => blocking(readChat(chatId).debate, activeTeam().map(a => a.id), { excludeEnvironment: true }).length;
  const publishProgress = (round, extra = {}) => {
    state.progress = {
      mode, round, maxRounds, turn, totalTurns: maxRounds * team.length, approvalsInRow, doneInRow,
      needed: activeTeam().length, minScore, openObjections: openBlocking(), openProductObjections: openProductBlocking(), cycleStarted: cycle, ...extra,
    };
    broadcast({ type: 'progress', chatId, progress: state.progress });
  };

  addMessage(chatId, {
    kind: 'system', cycle, outcome: 'started',
    text: i18n.t('server.notice.start', {
      mode: i18n.t(mode === 'auto' ? 'server.notice.auto' : 'server.notice.rounds'),
      team: team.map(a => `${a.name} (${a.role})`).join(' → '), minScore,
      limit: i18n.t(mode === 'auto' ? 'server.notice.safety' : 'server.notice.maximum', { maxRounds }),
    }),
  });
  broadcast({ type: 'cycle-started', chatId });

  try {
    memoryBase = syncMemoryIn(projectDir);

    while (turn < maxRounds * team.length && !state.stopped) {
      if (!activeTeam().length) break;
      const agent = team[turn % team.length];
      const round = Math.floor(turn / team.length) + 1;
      turn++;
      if (failed.has(agent.id)) continue;

      const info = { round, maxRounds, turn, cycle, minScore, mode };
      const teamNow = activeTeam();
      state.turnCtx = { agent, team: teamNow, info };
      state.activeIds = teamNow.map(a => a.id);
      writeHandoffStatus(projectDir, readChat(chatId), info, cycleTurns);
      writeTurnBrief(chatId, projectDir, state.turnCtx);

      state.agentId = agent.id;
      state.activity = i18n.t('stream.readingTurn');
      const started = Date.now();
      publishProgress(round, { agentId: agent.id, turnStarted: started });
      broadcast({ type: 'agent-status', chatId, agentId: agent.id, status: 'working', round, activity: state.activity, started });
      state.live.set(agent.id, { activity: state.activity, started });
      let said = '';
      const onEvent = entry => {
        said = saidBy(entry) ?? said;
        if (BUBBLE_KINDS.has(entry.kind) || entry.kind === 'say') {
          if (entry.kind !== 'say') state.activity = entry.kind === 'text' ? i18n.t('stream.draftingReport') : entry.label;
          state.live.set(agent.id, { activity: state.activity, said, started });
          broadcast({ type: 'agent-status', chatId, agentId: agent.id, status: 'working', round, activity: state.activity, said, started });
        }
        if (entry.kind === 'say') return; // solo para el globo: el log ya recibe el texto completo al final
        appendActivity(chatId, entry);
        broadcast({ type: 'activity', chatId, entry });
      };

      const before = snapshot(projectDir);
      const timeoutMin = config.turnTimeoutMinutes || 20;
      const idleMin = config.idleTimeoutMinutes ?? 10;
      const { result, used, reserva } = await runAgentWithReserve(chatId, agent, { timeoutMin, idleMin, round, onEvent, briefFile: briefFileOf(agent) }, team);
      const seconds = Math.round((Date.now() - started) / 1000);
      const afterSnap = snapshot(projectDir);
      const diff = diffSnapshots(before, afterSnap);
      const files = [...diff.added, ...diff.modified, ...diff.deleted];
      let diffs = [];
      try { diffs = textDiffs(before, afterSnap, diff); } catch { diffs = []; }
      broadcast({ type: 'agent-status', chatId, agentId: agent.id, status: 'idle' });
      state.agentId = null;
      state.live.delete(agent.id);
      const base = `ronda-${round}-${agent.id}-${cycle}`;
      try { fs.writeFileSync(path.join(projectDir, '.office', 'reportes', `${base}.raw.log`), result.stdout.slice(-2e6)); } catch {}
      if (state.stopped) break;

      const report = (result.report || result.stdout).trim();
      const failure = classifyFailure({ ...result, report, idleMinutes: idleMin, timeoutMinutes: timeoutMin });
      const partial = failure && isPartial(failure, workChanges(diff));
      if (partial) {
        // Cortado a medias con trabajo hecho (D47): no se tira ni se da por bueno. Sigue en el ciclo y el brief
        // del siguiente le dice qué cambió para que lo verifique.
        const workFiles = workChanges(diff);
        const msg = {
          kind: 'agent', agentId: agent.id, agentName: agent.name, role: agent.role, round, cycle, seconds, verdict: 'PARCIAL', failure, files, diffs, ...modelInfo(used, reserva), model: result.model || null,
          workFiles, toolCounts: result.toolCounts, toolErrors: result.toolErrors + 1, usage: result.usage || null,
          text: `${i18n.t('server.turn.partial', { label: failure.label, detail: failure.detail, count: workFiles.length, files: workFiles.slice(0, 10).join(', ') + (workFiles.length > 10 ? '…' : '') })}\n\n${cliOutput(result)}`,
        };
        addMessage(chatId, msg);
        cycleTurns.push(msg);
        broadcast({ type: 'agent-failed', chatId, title: chat0.title, agentId: agent.id, agentName: agent.name, failure, partial: true, remaining: activeTeam().map(a => a.name) });
        approvalsInRow = 0; doneInRow = 0;
        writeHandoffStatus(projectDir, readChat(chatId), info, cycleTurns);
        publishProgress(round);
        continue;
      }
      if (failure) {
        // Sin saldo, sin sesión, colgada…: sale de este ciclo con la causa a la vista y el resto sigue.
        failed.add(agent.id);
        const left = activeTeam().map(a => a.name);
        const msg = {
          kind: 'agent', agentId: agent.id, agentName: agent.name, role: agent.role, round, cycle, seconds, verdict: 'ERROR', failure, files, diffs, ...modelInfo(used, reserva), model: result.model || null,
          workFiles: workChanges(diff), toolCounts: result.toolCounts, toolErrors: result.toolErrors + 1, usage: result.usage || null,
          text: `⛔ ${failure.label}: ${failure.detail}\n${failure.hint}\n\n${leftNote(left)}\n\n${cliOutput(result)}`,
        };
        addMessage(chatId, msg);
        cycleTurns.push(msg);
        broadcast({ type: 'agent-failed', chatId, title: chat0.title, agentId: agent.id, agentName: agent.name, failure, remaining: left });
        approvalsInRow = 0; doneInRow = 0;
        publishProgress(round);
        continue;
      }

      const parsed = parseReport(report);
      const { score, done } = parsed;
      const changedWork = workChanges(diff);
      const judged = judgeVerdict({ verdict: parsed.verdict, score, minScore, changedWork, objections: parsed.objections });
      const { verdict, downgraded } = judged;

      // Hilo de discusión: primero las respuestas (a objeciones anteriores), después las objeciones nuevas.
      const who = { agentId: agent.id, agentName: agent.name, round, cycle };
      const debateResult = updateChat(chatId, c => {
        const r = applyReplies(c.debate, who, parsed.replies);
        const created = addObjections(c.debate, who, parsed.objections);
        // Respuestas a objeciones del usuario: se le avisa (toast y aviso de escritorio) aunque esté en otra misión.
        const toUser = r.applied.map(x => c.debate.find(o => o.id === x.id)).filter(o => o && o.by === 'user')
          .map(o => ({ id: o.id, text: o.text, status: o.status, reply: o.replies[o.replies.length - 1] }));
        return { ...r, created, toUser };
      });
      if (parsed.objections.length || parsed.replies.length) broadcast({ type: 'debate-updated', chatId });
      for (const o of debateResult.toUser) {
        broadcast({ type: 'objection-answered', chatId, title: chat0.title, id: o.id, objection: o.text, status: o.status,
          agentId: agent.id, agentName: agent.name, stance: o.reply.stance, reply: o.reply.text });
      }

      const handoffContent = readIfExists(path.join(projectDir, 'HANDOFF.md'));
      const handoffUpdated = files.includes('HANDOFF.md');
      const handoffText = handoffUpdated ? handoffLib.agentHandoff(handoffContent) : '';
      const handoffCheck = handoffUpdated ? handoffLib.handoffQuality(handoffText) : { complete: false, missing: handoffLib.HANDOFF_SECTIONS };

      lastScores[agent.name] = score;
      if (state.intervened) {
        approvalsInRow = 0;
        doneInRow = 0;
        state.intervened = false;
      } else {
        approvalsInRow = verdict === 'APROBADO' ? approvalsInRow + 1 : 0;
        const doneOk = done === true && score !== null && score >= minScore && !parsed.objections.length;
        doneInRow = doneOk ? doneInRow + 1 : 0;
      }

      fs.mkdirSync(path.join(projectDir, '.office', 'reportes'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, '.office', 'reportes', `${base}.md`), report);
      const msg = {
        kind: 'agent', agentId: agent.id, agentName: agent.name, role: agent.role, round, cycle, seconds, verdict, score, done,
        downgraded, ...modelInfo(used, reserva), model: result.model || null, files, workFiles: changedWork, diffs, toolCounts: result.toolCounts, toolErrors: result.toolErrors,
        usage: result.usage || null,
        streaming: result.streaming, handoff: handoffUpdated, handoffComplete: handoffCheck.complete, handoffMissing: handoffCheck.missing,
        handoffText: truncate(handoffText, 4000),
        objections: debateResult.created.map(o => o.id), replies: debateResult.applied, ignoredReplies: debateResult.ignored,
        text: report,
      };
      addMessage(chatId, msg);
      cycleTurns.push(msg);

      // Memoria compartida: fusiona lo aprendido en este turno y trae lo que otros escribieron.
      try {
        const changed = syncMemoryOut(projectDir, memoryBase);
        if (changed.length) {
          addMessage(chatId, { kind: 'system', cycle, text: i18n.t('server.notice.memoryBy', { name: agent.name, files: changed.map(c => c.file + (c.merged ? i18n.t('server.turn.merged') : '')).join(', ') }) });
          broadcast({ type: 'memory-updated', oficina: officeOfChat(chatId) });
        }
      } catch (err) {
        addMessage(chatId, { kind: 'system', text: i18n.t('server.notice.memoryFailed', { message: err.message }) });
      }

      writeHandoffStatus(projectDir, readChat(chatId), info, cycleTurns);
      outcome = cycleOutcome({ mode, approvalsInRow, doneInRow, activeCount: activeTeam().length, blockingObjections: openProductBlocking() });
      // Al cerrar una ronda completa: meseta o retroceso
      if (!outcome.finished && turn % team.length === 0) {
        const p = plateauOutcome({ turns: cycleTurns, round, expected: activeTeam().length, intervenedRounds: [...(state.intervenedRounds || [])] });
        if (p) {
          if (p.reason === 'meseta' && !state.rondaCierre && round < maxRounds) {
            // Directiva nueva del dueño: la meseta ya no termina la misión en silencio.
            // Arma una «ronda de cierre» con las objeciones abiertas y los puntos del brief en ◐/✖ como lista numerada de directivas, y continúa sola.
            const chatActual = readChat(chatId);
            const deb = (chatActual.debate || []).filter(o => (o.status === 'abierta' || o.status === 'disputada') && !isEnvironmentBlock(o));
            const ultimoPedido = (chatActual.messages || []).filter(m => m.kind === 'user' && !m.intervention).pop()?.text || '';
            const briefInfo = cierreLib.briefDelPedido(projectDir, ultimoPedido, []);
            const corpus = cycleTurns.map(x => `${x.text || ''}\n${x.handoffText || ''}`).join('\n');
            const puntos = cierreLib.contrastarBrief(cierreLib.puntosDelBrief(briefInfo.texto), corpus);
            const pendientesBrief = puntos.filter(p => p.estado === 'falta' || p.estado === 'parcial');
            const msgTexto = cierreLib.mensajeRondaCierre({
              idioma: cierreLib.idiomaDe(ultimoPedido),
              ronda: round,
              objeciones: deb,
              puntos: pendientesBrief,
            });
            if (msgTexto) {
              state.rondaCierre = true;
              addMessage(chatId, { kind: 'system', cycle, text: msgTexto, intervention: true, rondaCierre: true });
              state.intervened = true;
              state.intervenedRounds = state.intervenedRounds || new Set();
              state.intervenedRounds.add(round);
            } else {
              outcome = p;
            }
          } else {
            outcome = p;
          }
        }
      }
      publishProgress(round);
      if (outcome.finished) break;
    }

    const minutes = Math.round((Date.now() - cycle) / 60000);
    const rounds = Math.ceil(turn / team.length);
    const scores = Object.entries(lastScores).map(([name, s]) => `${name} ${s ?? '?'}`).join(', ');
    const open = openBlocking();
    // Cortado a medias (PARCIAL) no es «fuera del ciclo»: siguió y pudo aprobar después (RF4).
    const down = cycleTurns.filter(m => m.verdict === 'ERROR').map(m => `${m.agentName} (${m.failure.label.toLowerCase()})`);
    const cut = cycleTurns.filter(m => m.verdict === 'PARCIAL').map(m => i18n.t('server.notice.cutItem', { name: m.agentName, reason: m.failure.label.toLowerCase(), round: m.round }));
    const downNote = `${down.length ? i18n.t('server.notice.down', { agents: down.join(', ') }) : ''}${cut.length ? i18n.t('server.notice.cut', { agents: cut.join(', ') }) : ''}`;
    let summary;
    const summaryVars = { rounds, turn, minutes, scores, downNote, maxRounds,
      open: open ? i18n.t('cycle.open', { open }) : '' };
    if (state.stopped) summary = i18n.t('server.notice.stopped');
    else if (outcome.reason === 'unanime') summary = i18n.t('server.summary.unanimous', summaryVars);
    else if (outcome.reason === 'consenso') summary = i18n.t('server.summary.consensus', summaryVars);
    else if (outcome.reason === 'meseta' || outcome.reason === 'retroceso') summary = i18n.t('server.summary.plateau', { ...summaryVars, plateau: plateauSummary(outcome, { open }) });
    else if (!activeTeam().length) summary = i18n.t('server.summary.failed', { agents: down.join(', ') || i18n.t('server.summary.noWork', { turn }) });
    else summary = i18n.t('server.summary.exhausted', summaryVars);
    ending = { outcome: outcome.reason || (state.stopped ? 'detenido' : 'agotado'), summary };
    addMessage(chatId, { kind: 'system', cycle, text: summary, outcome: ending.outcome });
  } catch (err) {
    ending = { outcome: 'error', summary: i18n.t('server.notice.error', { message: err.message }) };
    addMessage(chatId, { kind: 'system', cycle, outcome: 'error', text: ending.summary });
  } finally {
    try {
      const changed = syncMemoryOut(projectDir, memoryBase);
      if (changed.length) addMessage(chatId, { kind: 'system', text: i18n.t('server.notice.memory', { files: changed.map(c => c.file).join(', ') }) });
    } catch (err) {
      addMessage(chatId, { kind: 'system', text: i18n.t('server.notice.memoryFailed', { message: err.message }) });
    }
    running.delete(chatId);
    editorialAlCerrar(chatId);
    const cierre = generarCierre(chatId);
    broadcast({ type: 'cycle-ended', chatId, title: chat0.title, ...(ending || { outcome: 'detenido', summary: '' }), ...(cierre ? { cierre: cierreLib.resumenDe(cierre) } : {}) });
    broadcast({ type: 'memory-updated', oficina: officeOfChat(chatId) });
    relatarCierre(chatId, cierre, activeTeam(), { config });
  }
}

// ---------- Modos paralelos: Delphi (paralelo + rotación) y Consejo ----------
// Fase 1 igual en los dos: cada agente hace su borrador a la vez en borradores/<letra>/ (letras anónimas).
//  - delphi:  rondas de rotación; cada uno mejora el borrador de otro y lo califica. Converge cuando todos aprueban
//             lo que recibieron; el borrador con mejor media se copia a final/.
//  - consejo: evaluación cruzada (puntajes por letra), el presidente redacta final/ y el resto lo aprueba o pide cambios.
// Cada agente tiene su .office/turno-<id>.md, y solo se le atribuyen los cambios dentro de su zona (su carpeta o final/),
// porque mientras trabaja, otros cambian otras carpetas.

const PHASE_VERDICT = { borrador: 'BORRADOR', evaluacion: 'EVALUACION', sintesis: 'SINTESIS' };

function writeServerHandoff(projectDir, text, lang) {
  const file = path.join(projectDir, 'HANDOFF.md');
  const content = readIfExists(file) || '# HANDOFF\n';
  const i = content.search(/^## (?:Último traspaso|Latest handoff)/m);
  fs.writeFileSync(file, `${(i === -1 ? content.trimEnd() + '\n\n' : content.slice(0, i))}${i18n.t('server.parallel.handoffHeading', {}, lang)}\n\n${text}\n`);
}

async function runParallelCycle(chatId, { config, chat0, cfg, team }) {
  const { workflow, maxRounds, minScore, maxParallel } = cfg;
  const projectDir = chatDir(chatId);
  const state = { proc: null, procs: new Set(), live: new Map(), briefs: new Map(), stopped: false, agentId: null, progress: null, activity: '' };
  cortarRelator(chatId);
  running.set(chatId, state);
  registrarBase(chatId);
  const cycle = Date.now();
  const failed = new Set();
  const lastScores = {};
  const cycleTurns = [];
  const timeoutMin = config.turnTimeoutMinutes || 20;
  const idleMin = config.idleTimeoutMinutes ?? 10;
  const planned = workflows.plannedTurns(workflow, team.length, maxRounds);
  const anon = workflows.anonymize(team.map(a => a.id), cycle); // { A: 'gemini', … }: solo lo ven el servidor y el usuario
  const letter = id => workflows.letterOf(anon, id);
  const folderOf = id => `borradores/${letter(id)}/`;
  const nameOf = id => team.find(a => a.id === id)?.name || id;
  const active = () => team.filter(a => !failed.has(a.id));
  const userText = chat0.messages.filter(m => m.kind === 'user').map(m => m.text).join('\n');
  let memoryBase = {};
  let phase = 'borrador', round = 0, done = 0, approvals = 0, needed = team.length;
  let ending = null;

  const publishProgress = () => {
    state.progress = {
      mode: cfg.mode, workflow, phase, phaseLabel: PHASES[phase], round, maxRounds, turn: done, totalTurns: planned,
      approvalsInRow: approvals, doneInRow: 0, needed, minScore, openObjections: 0, cycleStarted: cycle, maxParallel,
      working: [...state.live.keys()], queued: [...queued],
    };
    broadcast({ type: 'progress', chatId, progress: state.progress });
  };
  // Quién espera turno en la fase actual (con "A la vez, máx." menor que el equipo, el resto hace cola).
  let queued = [];
  const job = (agent, t) => Object.assign(() => runTask(agent, t), { agentId: agent.id });

  // Un turno de un agente en una fase. Devuelve el mensaje guardado, o null si falló o se detuvo el ciclo.
  async function runTask(agent, t) {
    if (state.stopped) return null;
    const briefFile = `turno-${agent.id}.md`;
    const projMemory = path.join(projectDir, PROJECT_MEMORY_DIR);
    const info = { round, maxRounds, minScore, workflow, cycle };
    // Se reescribe también si el usuario interviene a mitad del turno (markIntervened), como en el relevo.
    const writeBrief = () => {
      const body = buildParallelBrief({
        chat: readChat(chatId), agent, info, phase: t.phase,
        folder: t.folder, target: t.target, drafts: t.drafts, feedback: t.feedback,
        memoryDir: PROJECT_MEMORY_DIR, memoryFiles: memory.listMemoryFiles(projMemory), relevant: memory.relevantEntries(userText, memoryDocs(memDirOf(chatId)), 6),
      });
      const briefPath = path.join(projectDir, '.office', briefFile);
      fs.writeFileSync(briefPath + '.tmp', body);
      fs.renameSync(briefPath + '.tmp', briefPath);
    };
    writeBrief();
    state.briefs.set(agent.id, writeBrief);
    if (t.folder) fs.mkdirSync(path.join(projectDir, t.folder), { recursive: true });

    const qi = queued.indexOf(agent.id);
    if (qi >= 0) queued.splice(qi, 1);
    const started = Date.now();
    let activity = i18n.t('stream.readingTurn'), said = '';
    const setActivity = () => {
      state.live.set(agent.id, { activity, said, started, phase: t.phase });
      broadcast({ type: 'agent-status', chatId, agentId: agent.id, status: 'working', round, phase: t.phase, activity, said, started });
    };
    setActivity();
    publishProgress();
    const onEvent = entry => {
      entry.phase = t.phase;
      said = saidBy(entry) ?? said;
      if (BUBBLE_KINDS.has(entry.kind) || entry.kind === 'say') {
        if (entry.kind !== 'say') activity = entry.kind === 'text' ? i18n.t('stream.draftingReport') : entry.label;
        setActivity();
      }
      if (entry.kind === 'say') return; // solo para el globo: el log ya recibe el texto completo al final
      appendActivity(chatId, entry);
      broadcast({ type: 'activity', chatId, entry });
    };

    const before = snapshot(projectDir);
    const { result, used, reserva } = await runAgentWithReserve(chatId, agent, { timeoutMin, idleMin, round, onEvent, briefFile, phase: t.phase, folder: t.folder }, team);
    const seconds = Math.round((Date.now() - started) / 1000);
    const after = snapshot(projectDir);
    state.live.delete(agent.id);
    state.briefs.delete(agent.id);
    broadcast({ type: 'agent-status', chatId, agentId: agent.id, status: 'idle' });
    const base = `${t.phase}-${round}-${agent.id}-${cycle}`;
    try { fs.writeFileSync(path.join(projectDir, '.office', 'reportes', `${base}.raw.log`), result.stdout.slice(-2e6)); } catch {}
    if (state.stopped) { publishProgress(); return null; }

    const diff = diffSnapshots(before, after);
    const inZone = f => !!t.zone && f.startsWith(t.zone);
    const files = [...diff.added, ...diff.modified, ...diff.deleted].filter(inZone);
    const workFiles = workChanges(diff).filter(inZone);
    let diffs = [];
    try { diffs = textDiffs(before, after, diff).filter(d => inZone(d.file)); } catch {}
    const common = {
      kind: 'agent', agentId: agent.id, agentName: agent.name, role: agent.role, round, cycle, seconds, workflow, phase: t.phase,
      target: t.target?.letter || null, targetOwner: t.target?.owner || null, files, workFiles, diffs, ...modelInfo(used, reserva), model: result.model || null,
      toolCounts: result.toolCounts, usage: result.usage || null, streaming: result.streaming,
    };

    const report = (result.report || result.stdout).trim();
    const failure = classifyFailure({ ...result, report, idleMinutes: idleMin, timeoutMinutes: timeoutMin });
    if (failure) {
      // Cortado con trabajo en su zona: PARCIAL (D47). No cuenta como revisión ni como voto, pero sigue en el ciclo.
      const partial = isPartial(failure, workFiles);
      if (!partial) failed.add(agent.id);
      const left = active().map(a => a.name);
      const msg = {
        ...common, verdict: partial ? 'PARCIAL' : 'ERROR', failure, toolErrors: result.toolErrors + 1,
        text: `${partial ? `⏸ ${i18n.t('server.turn.partialTag')} · ${failure.label}` : `⛔ ${failure.label}`}: ${failure.detail}\n${failure.hint}\n\n` +
          `${partial ? i18n.t('server.turn.partialZone', { count: workFiles.length, zone: t.zone }) : leftNote(left)}\n\n${cliOutput(result)}`,
      };
      addMessage(chatId, msg);
      cycleTurns.push(msg);
      broadcast({ type: 'agent-failed', chatId, title: chat0.title, agentId: agent.id, agentName: agent.name, failure, partial, remaining: left });
      done++;
      publishProgress();
      return null;
    }

    const parsed = parseReport(report);
    let verdict = PHASE_VERDICT[t.phase] || parsed.verdict, downgraded = null;
    if (t.phase === 'revision' || t.phase === 'aprobacion') {
      // La nota de revisión en LEEME.md no es un cambio del trabajo.
      const changed = workFiles.filter(f => !(t.phase === 'revision' && f === `${t.zone}LEEME.md`));
      ({ verdict, downgraded } = judgeVerdict({ verdict: parsed.verdict, score: parsed.score, minScore, changedWork: changed, objections: parsed.objections }));
      if (verdict === 'APROBADO') approvals++;
    }
    // Una autoevaluación no cuenta: el brief no le muestra su borrador, pero si aun así lo califica se descarta.
    const ratings = t.phase === 'evaluacion'
      ? Object.fromEntries(Object.entries(workflows.parseRatings(report)).filter(([l]) => anon[l] && anon[l] !== agent.id)) : null;
    const handoffUpdated = t.phase === 'sintesis' && diff.modified.concat(diff.added).includes('HANDOFF.md');
    const msg = {
      ...common, verdict, score: parsed.score, downgraded, toolErrors: result.toolErrors, text: report,
      ratings, ratingOwners: ratings ? Object.fromEntries(Object.entries(ratings).filter(([l]) => anon[l]).map(([l, s]) => [anon[l], s])) : null,
      objectionTexts: parsed.objections,
      handoff: handoffUpdated, handoffComplete: handoffUpdated ? handoffLib.handoffQuality(handoffLib.agentHandoff(readIfExists(path.join(projectDir, 'HANDOFF.md')))).complete : false,
    };
    fs.mkdirSync(path.join(projectDir, '.office', 'reportes'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.office', 'reportes', `${base}.md`), report);
    lastScores[agent.name] = parsed.score;
    addMessage(chatId, msg);
    cycleTurns.push(msg);
    try {
      const changed = syncMemoryOut(projectDir, memoryBase);
      if (changed.length) {
        addMessage(chatId, { kind: 'system', cycle, text: i18n.t('server.notice.memoryBy', { name: agent.name, files: changed.map(c => c.file + (c.merged ? i18n.t('server.turn.mergedShort') : '')).join(', ') }) });
        broadcast({ type: 'memory-updated', oficina: officeOfChat(chatId) });
      }
    } catch (err) {
      addMessage(chatId, { kind: 'system', text: i18n.t('server.notice.memoryFailed', { message: err.message }) });
    }
    done++;
    publishProgress();
    return msg;
  }

  const runPhase = (name, jobs) => {
    phase = name;
    queued = jobs.map(j => j.agentId);
    publishProgress();
    return workflows.pool(jobs, maxParallel);
  };

  const describe = avgs => Object.entries(avgs).sort((a, b) => b[1] - a[1]).map(([l, s]) => `${l} (${nameOf(anon[l])}) ${s}`).join(', ');

  async function delphi(drafts) {
    let converged = false, lastEntries = [], used = 0, plateau = null;
    for (round = 1; round <= maxRounds && !state.stopped; round++) {
      const reviewers = active().map(a => a.id);
      if (!reviewers.length) break;
      approvals = 0;
      needed = reviewers.length;
      used = round;
      const plan = workflows.rotation(reviewers, drafts, d => d.owner, round);
      const msgs = await runPhase('revision', plan.map(p => job(team.find(a => a.id === p.reviewer), {
        phase: 'revision', folder: p.draft.folder, zone: p.draft.folder, target: p.draft, drafts,
      })));
      const ok = msgs.filter(Boolean);
      if (ok.length) lastEntries = ok.map(m => ({ draft: m.target, score: m.score }));
      if (ok.length && ok.length === plan.length && ok.every(m => m.verdict === 'APROBADO')) { converged = true; break; }
      // Revisiones de borradores ajenos: no hay autonota. Meseta o retroceso detienen sin aprobar (D46).
      plateau = plateauOutcome({ turns: cycleTurns.filter(m => m.phase === 'revision'), round, expected: plan.length, intervenedRounds: [...(state.intervenedRounds || [])] });
      if (plateau) break;
    }
    const avgs = workflows.averageByDraft(lastEntries);
    const best = workflows.bestDraft(avgs) || drafts[0].letter;
    const src = path.join(projectDir, 'borradores', best);
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.join(projectDir, 'final'), { recursive: true });
      fs.cpSync(src, path.join(projectDir, 'final'), { recursive: true, force: true });
    }
    const hl = chatLang(chat0);
    writeServerHandoff(projectDir, [
      i18n.t('server.parallel.handoffFrom', { rounds: used }, hl),
      '',
      i18n.t('server.parallel.handoffDone', { count: drafts.length, best, owner: nameOf(anon[best]) }, hl),
      '',
      i18n.t('server.parallel.handoffScores', { scores: describe(avgs) || i18n.t('server.parallel.noScores', {}, hl) }, hl),
      '',
      i18n.t(converged ? 'server.parallel.handoffNextOk' : 'server.parallel.handoffNextMore', {}, hl),
    ].join('\n'), hl);
    return { converged, used, avgs, best, plateau };
  }

  async function consejo(drafts) {
    approvals = 0;
    needed = active().length;
    const evals = (await runPhase('evaluacion', active().map(a => job(a, { phase: 'evaluacion', folder: folderOf(a.id), zone: null, drafts })))).filter(Boolean);
    const avgs = workflows.averageByDraft(evals.flatMap(m => Object.entries(m.ratings || {}).map(([draft, score]) => ({ draft, score }))));
    const fl = chatLang(chat0);
    let feedback = `${i18n.t('server.parallel.avgByDraft', { scores: Object.entries(avgs).sort((a, b) => b[1] - a[1]).map(([l, s]) => `${l} ${s}`).join(', ') || i18n.t('server.parallel.noRatings', {}, fl) }, fl)}\n\n` +
      evals.map((m, i) => `${i18n.t('server.parallel.evaluation', { n: i + 1 }, fl)}\n${truncate(m.text, 3000)}`).join('\n\n');
    let approved = false, used = 0, chair = null, plateau = null;
    for (round = 1; round <= maxRounds && !state.stopped; round++) {
      chair = team.find(a => a.id === cfg.chair && !failed.has(a.id)) || active()[0];
      if (!chair) break;
      used = round;
      approvals = 0;
      needed = 1;
      const synth = await runPhase('sintesis', [job(chair, { phase: 'sintesis', folder: 'final/', zone: 'final/', drafts, feedback })]);
      if (!synth[0]) { if (state.stopped) break; round--; continue; } // el presidente cayó: lo reemplaza el siguiente activo
      const voters = active().filter(a => a.id !== chair.id);
      if (!voters.length) break;
      needed = voters.length;
      const votes = (await runPhase('aprobacion', voters.map(a => job(a, { phase: 'aprobacion', folder: 'final/', zone: 'final/', drafts })))).filter(Boolean);
      if (votes.length && votes.length === voters.length && votes.every(m => m.verdict === 'APROBADO')) { approved = true; break; }
      // Solo votan los demás: la nota del presidente a su propia síntesis es autonota y no cuenta (D46).
      plateau = plateauOutcome({ turns: cycleTurns.filter(m => m.phase === 'aprobacion'), round, expected: voters.length, intervenedRounds: [...(state.intervenedRounds || [])] });
      if (plateau) break;
      feedback = votes.filter(m => m.verdict !== 'APROBADO').map(m => `### ${m.agentName} · NOTA ${m.score ?? '?'}/10\n${truncate(m.text, 3000)}`).join('\n\n') ||
        i18n.t('server.parallel.missingReview', {}, fl);
    }
    return { approved, used, avgs, chair, plateau };
  }

  addMessage(chatId, {
    kind: 'system', cycle, outcome: 'started',
    text: i18n.t('server.parallel.start', {
      mode: i18n.t(`server.parallel.${workflow}`), team: team.map(a => `${a.name} (${a.role})`).join(', '),
      chair: workflow === 'consejo' ? i18n.t('server.parallel.chair', { name: nameOf(cfg.chair) }) : '', parallel: maxParallel, maxRounds, minScore,
    }),
  });
  broadcast({ type: 'cycle-started', chatId });
  updateChat(chatId, c => { (c.anon ||= {})[cycle] = anon; });

  try {
    memoryBase = syncMemoryIn(projectDir);
    writeHandoffStatus(projectDir, readChat(chatId), { mode: cfg.mode, round: 1, maxRounds }, cycleTurns);
    await runPhase('borrador', active().map(a => job(a, { phase: 'borrador', folder: folderOf(a.id), zone: folderOf(a.id), drafts: [] })));
    const drafts = team.filter(a => !failed.has(a.id)).map(a => ({ letter: letter(a.id), folder: folderOf(a.id), owner: a.id }))
      .sort((a, b) => a.letter.localeCompare(b.letter));
    const minutes = () => Math.round((Date.now() - cycle) / 60000);
    // Cortado a medias (PARCIAL) no es «fuera del ciclo» (RF4).
    const down = () => cycleTurns.filter(m => m.verdict === 'ERROR').map(m => `${m.agentName} (${m.failure.label.toLowerCase()})`);
    const cut = () => cycleTurns.filter(m => m.verdict === 'PARCIAL').map(m => `${m.agentName} (${m.failure.label.toLowerCase()})`);
    const downNote = () => `${down().length ? i18n.t('server.parallel.down', { agents: down().join(', ') }) : ''}${cut().length ? i18n.t('server.notice.cut', { agents: cut().join(', ') }) : ''}`;
    let summary, outcome;
    if (state.stopped) { summary = i18n.t('server.notice.stopped'); outcome = 'detenido'; }
    else if (drafts.length < 2) {
      summary = i18n.t('server.parallel.fewDrafts', { count: drafts.length, downNote: downNote() });
      outcome = 'sin-agentes';
    } else if (workflow === 'delphi') {
      const r = await delphi(drafts);
      outcome = state.stopped ? 'detenido' : r.converged ? 'unanime' : r.plateau ? r.plateau.reason : 'agotado';
      updateChat(chatId, c => { c.modoDetalle = { modo: 'delphi', borrador: r.best, autor: nameOf(anon[r.best]) || null, avgs: r.avgs }; });
      summary = state.stopped ? i18n.t('server.notice.stopped')
        : r.plateau ? i18n.t('server.parallel.delphiPlateau', { plateau: plateauSummary(r.plateau), best: r.best, owner: nameOf(anon[r.best]), turns: done, minutes: minutes(), downNote: downNote() })
        : i18n.t('server.parallel.delphiEnd', {
          head: r.converged ? i18n.t('server.parallel.delphiConverged', { rounds: r.used }) : i18n.t('server.parallel.delphiExhausted', { maxRounds }),
          turns: done, minutes: minutes(), best: r.best, owner: nameOf(anon[r.best]), scores: describe(r.avgs) || i18n.t('server.parallel.noScores'), downNote: downNote(),
        });
    } else {
      const r = await consejo(drafts);
      outcome = state.stopped ? 'detenido' : r.approved ? 'unanime' : r.plateau ? r.plateau.reason : 'agotado';
      updateChat(chatId, c => { c.modoDetalle = { modo: 'consejo', borrador: 'final', autor: r.chair?.name || null, avgs: r.avgs }; });
      summary = state.stopped ? i18n.t('server.notice.stopped')
        : r.plateau ? i18n.t('server.parallel.councilPlateau', { plateau: plateauSummary(r.plateau), turns: done, minutes: minutes(), downNote: downNote() })
        : i18n.t('server.parallel.councilEnd', {
          head: r.approved ? i18n.t('server.parallel.councilApproved', { name: r.chair?.name, rounds: r.used }) : i18n.t('server.parallel.councilExhausted', { maxRounds }),
          turns: done, minutes: minutes(), scores: describe(r.avgs) || i18n.t('server.parallel.noRatings'), downNote: downNote(),
        });
    }
    writeHandoffStatus(projectDir, readChat(chatId), { mode: cfg.mode, round: Math.max(round, 1), maxRounds }, cycleTurns);
    ending = { outcome, summary };
    addMessage(chatId, { kind: 'system', cycle, text: summary, outcome });
  } catch (err) {
    ending = { outcome: 'error', summary: i18n.t('server.notice.error', { message: err.message }) };
    addMessage(chatId, { kind: 'system', cycle, outcome: 'error', text: ending.summary });
  } finally {
    try {
      const changed = syncMemoryOut(projectDir, memoryBase);
      if (changed.length) addMessage(chatId, { kind: 'system', text: i18n.t('server.notice.memory', { files: changed.map(c => c.file).join(', ') }) });
    } catch (err) {
      addMessage(chatId, { kind: 'system', text: i18n.t('server.notice.memoryFailed', { message: err.message }) });
    }
    running.delete(chatId);
    editorialAlCerrar(chatId);
    const cierre = generarCierre(chatId);
    broadcast({ type: 'cycle-ended', chatId, title: chat0.title, ...(ending || { outcome: 'detenido', summary: '' }), ...(cierre ? { cierre: cierreLib.resumenDe(cierre) } : {}) });
    broadcast({ type: 'memory-updated', oficina: officeOfChat(chatId) });
    relatarCierre(chatId, cierre, team.filter(a => !failed.has(a.id)), { config, presidente: workflow === 'consejo' ? cfg.chair : null });
  }
}

function stopCycle(chatId) {
  const state = running.get(chatId);
  if (!state) return;
  state.stopped = true;
  killTree(state.proc);
  for (const proc of state.procs) killTree(proc);
}

// ---------- Servidor HTTP ----------

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.zip': 'application/zip' };

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > 2e6) { reject(Object.assign(new Error(i18n.t('server.error.bodyTooLarge')), { status: 413 })); req.destroy(); }
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(Object.assign(new Error(i18n.t('server.error.invalidJson')), { status: 400 })); } });
  });
}

// Cuerpo binario (un adjunto), con tope de tamaño.
function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error(i18n.t('server.error.fileTooLarge', { mb: Math.round(max / 1048576) })), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Mueve los adjuntos subidos a la misión y devuelve el texto del pedido con la lista para los agentes.
function withAttachments(chatId, text, ids) {
  const items = adjuntos.attach(UPLOADS_DIR, Array.isArray(ids) ? ids : [], chatDir(chatId));
  const block = adjuntos.describe(items, i18n.detectLang(text, chatLang(readChat(chatId))));
  return { text: block ? `${text}\n\n${block}` : text, items };
}

// Acepta el formato antiguo ({ text, maxRounds }) y el nuevo ({ text, config: { mode, maxRounds, minScore, team } }).
const cycleInput = body => ({ ...(body.config || {}), ...(body.maxRounds && !body.config?.maxRounds ? { maxRounds: body.maxRounds } : {}) });

// Una misión nueva en una oficina (desde el panel, una llave de agente o un bot externo por puerta-bots.js).
// `extra` (solo desde el servidor, nunca del cuerpo HTTP): { editorial, archivos: { ruta: texto }, copiar: { from, to } }.
function createMission(office, body, extra = {}) {
  const text = String(body.text || '').trim();
  if (!text) throw Object.assign(new Error(i18n.t('server.error.taskRequired')), { status: 400 });
  const cfg = normalizeCycleConfig(cycleInput(body), configFor(office)); // solo IAs permitidas en la oficina
  // Una oficina con empleados no hereda instrucciones de carpetas padre: se dice ANTES de gastar un turno.
  if (configFor(office).empleados) {
    const padres = empleados.instruccionesEnPadres(path.join(oficinas.dirs(office).proyectos, 'mision'));
    if (padres.length) throw Object.assign(new Error(i18n.t('server.error.parentInstructions', { paths: padres.join(', ') })), { status: 409, codigo: 'INSTRUCCION_PADRE', rutas: padres });
  }
  const chat = createChat(text.split('\n')[0].slice(0, 60), cfg, office);
  if (extra.editorial) updateChat(chat.id, c => { c.editorial = extra.editorial; });
  prepararCarpeta(chatDir(chat.id), extra);
  const att = withAttachments(chat.id, text, body.attachments);
  addMessage(chat.id, { kind: 'user', text: att.text, config: cfg, ...(att.items.length ? { attachments: att.items } : {}), ...(body.from ? { from: body.from } : {}) });
  runCycle(chat.id);
  return chat;
}

// Directiva u objeción a mitad de ciclo. Adjuntos: quedan en adjuntos/ y el siguiente turno los ve en la directiva.
function interveneMission(id, body, { by = { agentId: 'user', agentName: 'Usuario' } } = {}) {
  const raw = String(body.text || '').trim();
  if (!raw) throw Object.assign(new Error(i18n.t('server.error.directiveRequired')), { status: 400 });
  const { text, items } = withAttachments(id, raw, body.attachments);
  const state = running.get(id);
  const cycle = state?.progress?.cycleStarted || Date.now();
  const round = state?.progress?.round || 1;
  const asObjection = body.asObjection !== false;
  const created = updateChat(id, c => {
    c.messages.push({ ts: new Date().toISOString(), kind: 'user', intervention: true, cycle, text, ...(items.length ? { attachments: items } : {}), ...(by.agentId !== 'user' ? { from: by.agentName } : {}) });
    return asObjection ? addObjections(c.debate, { ...by, round, cycle }, [text]) : [];
  });
  if (state) markIntervened(id);
  broadcast({ type: 'chat-updated', chatId: id });
  if (created.length) broadcast({ type: 'debate-updated', chatId: id });
  // Sin ciclo en marcha nadie la lee ahora: queda en el hilo y la verán en la próxima pasada. Se dice, para no creer que
  // llegó a un turno (pasó el 24-oct: una objeción enviada a una misión ya cerrada).
  return { ok: true, objection: created[0] || null, enCurso: !!state,
    ...(state ? {} : { aviso: i18n.t('server.notice.notRunning') }) };
}

// ---------- Editorial continua (lib/editorial.js, lib/viralhunt.js; D66-ED a D70-ED) ----------

// Archivos que el servidor deja en la misión antes del primer turno (la investigación de ViralHunt, la propuesta a cambiar).
function prepararCarpeta(dir, { archivos = {}, copiar = null, binarios = [] } = {}) {
  for (const b of binarios) {
    const to = path.join(dir, b.to);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(b.from, to);
  }
  for (const [rel, content] of Object.entries(archivos)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  if (copiar) {
    const to = path.join(dir, copiar.to);
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(copiar.from)) if (/\.(png|jpe?g|webp)$/i.test(f) || f === 'investigacion.md') fs.copyFileSync(path.join(copiar.from, f), path.join(to, f));
    if (copiar.propuesta) fs.writeFileSync(path.join(to, 'propuesta.json'), JSON.stringify(copiar.propuesta, null, 2));
  }
}

const lanzando = new Set(); // oficinas con una tanda en preparación (la investigación tarda: que el reloj no lance otra)
const aprobando = new Set(); // propuestas enviándose a ViralHunt (un doble clic no crea dos posts)
const tandaAbierta = office => lanzando.has(office) || (editorial.estado(office).tandas || []).some(t => !t.fin && running.has(t.chatId));

const rutinaDe = (regla, tipo) => (regla?.rutinas || []).find(r => r.tipo === tipo) || null;
// El equipo de una rutina: el suyo si lo tiene; si no, el de la regla. Siempre dentro de los que la regla conoce.
const equipoRutina = (regla, rut) => {
  const ids = rut?.equipo?.length ? rut.equipo : regla.equipo.map(e => e.id);
  const eq = regla.equipo.filter(e => ids.includes(e.id));
  return eq.length ? eq : regla.equipo;
};
// Las referencias visuales de la marca viajan a la misión (marca/<archivo>) para el generador de imágenes (§4).
const archivosMarca = (office, regla) => (regla.marca?.referencias || []).map(f => path.join(editorial.dir(office), 'marca', f)).filter(f => fs.existsSync(f));

async function lanzarTanda(office, { franja = null, manual = false } = {}) {
  const o = oficinas.read(office);
  const regla = editorial.regla(office);
  if (!o || office === EDIFICIO) throw Object.assign(new Error(i18n.t('server.error.editorialPerOffice')), { status: 400 });
  if (!regla) throw Object.assign(new Error(i18n.t('server.error.editorialNoRuleYet')), { status: 409 });
  if (tandaAbierta(office)) throw Object.assign(new Error(i18n.t('server.error.batchOpen')), { status: 409, codigo: 'tanda_abierta' });
  lanzando.add(office);
  try {
    if (franja) editorial.saltarFranja(office, franja); // la franja queda tomada antes de esperar a ViralHunt
    let investigacion = null;
    if (viralhunt.hasToken(office)) {
      investigacion = await viralhunt.investigar(office, regla).catch(err => ({ pedido: new Date().toISOString(), tendencias: [], mejorHora: [], errores: [{ llamada: 'investigación', error: err.message }] }));
    }
    const rut = rutinaDe(regla, 'redaccion');
    const equipo = equipoRutina(regla, rut);
    const semillas = editorial.semillas.elegir(office, regla.propuestasPorTanda);
    const text = editorialLib.briefTanda({ regla: { ...regla, equipo }, oficina: o, franja, gusto: editorial.gusto(office), investigacion, semillas });
    const chat = createMission(office, {
      text, config: { mode: 'auto', maxRounds: regla.rondas, workflow: regla.modo, team: equipo.map(e => ({ id: e.id, role: e.rol || undefined })) },
    }, {
      editorial: { tipo: 'tanda', rutina: 'redaccion', franja: franja?.clave || null, manual, semillas: semillas.map(s => s.id) },
      archivos: {
        ...(investigacion ? { 'investigacion/viralhunt.json': JSON.stringify(investigacion, null, 2) } : {}),
        ...(semillas.length ? { 'investigacion/semillas.json': JSON.stringify(semillas, null, 2) } : {}),
      },
      binarios: archivosMarca(office, regla).map(f => ({ from: f, to: path.join('marca', path.basename(f)) })),
    });
    if (semillas.length) editorial.semillas.marcar(office, semillas.map(s => s.id), 'en-tanda', { chatId: chat.id });
    editorial.apuntarTanda(office, { franja, chatId: chat.id, manual });
    const coste = rutinasLib.costeEstimado({ tipo: 'redaccion', equipo: equipo.map(e => e.id) });
    editorial.rutinas.empezar(office, 'redaccion', { clave: franja?.clave || `manual:${new Date().toISOString()}`, manual, chatId: chat.id, zona: regla.zona, coste });
    oficinas.bitacora(office, `Editorial: tanda ${manual ? 'manual' : franja?.clave} lanzada (misión ${chat.id})`);
    broadcast({ type: 'editorial-updated', oficina: office });
    return chat;
  } finally { lanzando.delete(office); }
}

// Radar (§6): misión corta (1 a 3 temas que suben). Sus temas pasan a editorial/radar/<fecha>.json y a las semillas.
async function lanzarRadar(office, { franja = null, manual = false } = {}) {
  const o = oficinas.read(office);
  const regla = editorial.regla(office);
  if (!regla) throw Object.assign(new Error(i18n.t('server.error.editorialNoRuleYet')), { status: 409 });
  if (rutinaAbierta(office, 'radar')) throw Object.assign(new Error(i18n.t('server.error.routineOpen')), { status: 409, codigo: 'rutina_abierta' });
  const rut = rutinaDe(regla, 'radar');
  const clave = franja?.clave || `manual:${new Date().toISOString()}`;
  if (franja) editorial.rutinas.tomar(office, 'radar', franja.clave);
  let investigacion = null;
  if (viralhunt.hasToken(office)) investigacion = await viralhunt.investigar(office, { ...regla, redes: [] }).catch(() => null);
  const equipo = equipoRutina(regla, rut);
  const ganadores = editorial.ultimoDia(office, 'desempeno')?.ganadores || [];
  const chat = createMission(office, {
    text: editorialLib.briefRadar({ regla, oficina: o, cantidad: rut?.cantidad || 3, investigacion, ganadores }),
    config: { mode: 'rondas', maxRounds: 1, workflow: 'relevo', team: equipo.slice(0, 2).map(e => ({ id: e.id, role: e.rol || undefined })) },
  }, {
    editorial: { tipo: 'radar', rutina: 'radar', franja: clave, manual },
    archivos: investigacion ? { 'investigacion/viralhunt.json': JSON.stringify(investigacion, null, 2) } : {},
  });
  editorial.rutinas.empezar(office, 'radar', { clave, manual, chatId: chat.id, zona: regla.zona, coste: rutinasLib.costeEstimado({ tipo: 'radar', equipo: equipo.map(e => e.id) }) });
  broadcast({ type: 'editorial-updated', oficina: office });
  return chat;
}

// ---------- Rutinas del servidor: sin agentes, solo ViralHunt con el token (§6) ----------
const hoyEn = zona => editorialLib.diaLocal(zona, Date.now());

// Desempeño: stats.php → ganadores frente a la media. Con ready:false lo dice y no inventa números.
async function rutinaDesempeno(office, regla) {
  const stats = await viralhunt.stats(office, regla);
  const d = cadenaLib.analizarDesempeno(stats, editorial.propuestas(office), { zona: regla.zona, lang: editorialLib.briefLangOf(regla) });
  editorial.guardarDia(office, 'desempeno', hoyEn(regla.zona), d);
  return { ready: d.ready, ganadores: d.ganadores.length, motivo: d.motivo };
}

// Más como este: por cada ganador, search.php con su tema → semillas con su origen. Sin ganadores, la cadena sigue con el radar.
async function rutinaMasComoEste(office, regla) {
  const d = editorial.ultimoDia(office, 'desempeno');
  if (!d?.ganadores?.length) return { semillas: 0, motivo: i18n.t('server.routine.noWinners') };
  const busquedas = {};
  const errores = [];
  for (const g of d.ganadores.slice(0, 3)) {
    if (!g.tema) continue;
    try { busquedas[g.tema] = cadenaLib.filasBusqueda(await viralhunt.buscar(office, g.tema.split(/\s+/).slice(0, 4).join(' '))); } catch (err) { errores.push(err.message); }
  }
  const nuevas = editorial.semillas.anadir(office, cadenaLib.semillasMasComoEste(d, busquedas));
  return { semillas: nuevas.length, errores };
}

// Aprender: edit_log desde la última lectura → gusto; y el estado de vuelta de los posts aprobados (publicado o no).
async function rutinaAprender(office, regla, st) {
  const since = st?.ultima?.inicio && st.ultima.informe?.ok ? st.ultima.inicio : new Date(Date.now() - 7 * 864e5).toISOString();
  const log = await viralhunt.editLog(office, since);
  let ediciones = 0;
  if (log.disponible && log.filas.length) {
    const prev = editorial.ediciones(office);
    const filas = cadenaLib.unirEdiciones(prev?.filas, log.filas);
    ediciones = Math.max(0, filas.length - (prev?.filas?.length || 0));
    if (ediciones) editorial.guardarEdiciones(office, { ...cadenaLib.resumirEdiciones(filas), filas });
  }
  let revisados = 0;
  for (const p of editorial.propuestas(office).filter(x => x.estado === 'aprobada' && x.viralhunt?.id != null && x.viralhunt?.remoto?.status !== 'published').slice(0, 10)) {
    try { editorial.marcar(office, p.id, { viralhunt: { ...p.viralhunt, remoto: await viralhunt.estadoPost(office, p.viralhunt.id) } }, { evento: 'estado-viralhunt' }); revisados++; } catch { /* la siguiente pasada lo reintenta */ }
  }
  return { ediciones, editLog: log.disponible, revisados, motivo: log.disponible ? null : log.motivo };
}

const RUTINAS_SERVIDOR = { desempeno: rutinaDesempeno, 'mas-como-este': rutinaMasComoEste, aprender: rutinaAprender };
const ejecutandoServidor = new Set(); // `${office}/${tipo}`

async function ejecutarRutinaServidor(office, tipo, { franja = null, manual = false } = {}) {
  const regla = editorial.regla(office);
  const key = `${office}/${tipo}`;
  if (ejecutandoServidor.has(key)) throw Object.assign(new Error(i18n.t('server.error.routineOpen')), { status: 409, codigo: 'rutina_abierta' });
  ejecutandoServidor.add(key);
  const st = editorial.rutinas.de(office, tipo);
  editorial.rutinas.empezar(office, tipo, { clave: franja?.clave || `manual:${new Date().toISOString()}`, manual, zona: regla.zona });
  broadcast({ type: 'editorial-updated', oficina: office });
  let informe;
  try {
    if (!viralhunt.hasToken(office)) informe = { ok: false, motivo: i18n.t('server.error.viralhuntToken') };
    else informe = { ok: true, ...(await RUTINAS_SERVIDOR[tipo](office, regla, st)) };
  } catch (err) {
    informe = { ok: false, motivo: err.message }; // nunca se apaga: la siguiente franja lo reintenta
  } finally { ejecutandoServidor.delete(key); }
  editorial.rutinas.terminar(office, tipo, informe, { zona: regla.zona });
  oficinas.bitacora(office, i18n.t('server.log.routineDone', { routine: i18n.t(`ed.routine.${tipo}`), result: informe.ok ? 'ok' : informe.motivo }));
  broadcast({ type: 'editorial-updated', oficina: office });
  return informe;
}

const rutinaAbierta = (office, tipo) => {
  if (tipo === 'redaccion') return tandaAbierta(office);
  if (RUTINAS_SERVIDOR[tipo]) return ejecutandoServidor.has(`${office}/${tipo}`);
  const ch = editorial.rutinas.de(office, tipo).ultima?.chatId;
  return !!(ch && running.has(ch));
};

function ejecutarRutina(office, tipo, opts = {}) {
  if (tipo === 'redaccion') return lanzarTanda(office, opts);
  if (tipo === 'radar') return lanzarRadar(office, opts);
  if (RUTINAS_SERVIDOR[tipo]) return ejecutarRutinaServidor(office, tipo, opts);
  throw Object.assign(new Error(i18n.t('server.error.notFound')), { status: 404 });
}

// El reloj: cada minuto mira qué rutina toca en cada oficina. Tras dormir, cada una lanza su última franja una vez.
// La «redaccion» lleva su franja en estado.json (compatible con la v1); las demás, en rutinas.json.
function relojEditorial(ahora = Date.now()) {
  const lanzadas = [];
  for (const o of oficinas.list()) {
    if (o.id === EDIFICIO) continue;
    const regla = editorial.regla(o.id);
    if (!regla?.activa) continue;
    for (const rut of regla.rutinas || []) {
      const rst = editorial.rutinas.de(o.id, rut.tipo);
      const v1 = rut.tipo === 'redaccion' ? editorial.estado(o.id) : null;
      const st = v1 ? { ...rst, ultimaClave: v1.ultimaFranja, activadaEn: v1.activadaEn } : rst;
      const coste = rutinasLib.costeEstimado({ ...rut, equipo: equipoRutina(regla, rut).map(e => e.id) });
      const d = rutinasLib.rutinaDebida({ maestra: true, rut, st, zona: regla.zona, ahora, abierta: rutinaAbierta(o.id, rut.tipo), predecesor: rut.tras ? editorial.rutinas.de(o.id, rut.tras) : null, coste });
      if (d.lanzar) {
        lanzadas.push(Promise.resolve().then(() => ejecutarRutina(o.id, rut.tipo, { franja: d.franja })).catch(err => {
          oficinas.bitacora(o.id, i18n.t('server.log.routineFailed', { routine: i18n.t(`ed.routine.${rut.tipo}`), slot: d.franja.clave, msg: err.message }));
          return null;
        }));
      } else if (d.motivo === 'anterior-abierta' || d.motivo === 'tope') {
        if (v1) editorial.saltarFranja(o.id, d.franja); else editorial.rutinas.tomar(o.id, rut.tipo, d.franja.clave);
        oficinas.bitacora(o.id, d.motivo === 'tope'
          ? i18n.t('server.log.routineCap', { routine: i18n.t(`ed.routine.${rut.tipo}`), slot: d.franja.clave, used: d.usados, cap: rut.topeDiario })
          : i18n.t('server.log.slotSkipped', { slot: d.franja.clave }));
      }
    }
  }
  return Promise.all(lanzadas);
}

// Pausar / reanudar una rutina: cambia su `activa` en la regla (al reanudar no se lanza la franja ya pasada).
function pausarRutina(office, tipo, activa) {
  const regla = editorial.regla(office);
  if (!regla) throw Object.assign(new Error(i18n.t('server.error.editorialNoRuleYet')), { status: 409 });
  if (!rutinaDe(regla, tipo)) throw Object.assign(new Error(i18n.t('server.error.notFound')), { status: 404 });
  editorial.guardarRegla(office, { rutinas: regla.rutinas.map(r => (r.tipo === tipo ? { ...r, activa } : r)) });
  broadcast({ type: 'editorial-updated', oficina: office });
}

// ---------- Informe de cierre (lib/cierre.js, RF1–RF8) ----------
// HEAD al empezar la misión: los números del informe se cuentan contra él aunque los agentes hagan commits.
function registrarBase(chatId) {
  try {
    const chat = readChat(chatId);
    const base = cierreLib.registrarBase(chatDir(chatId), chat);
    if (base) updateChat(chatId, c => { c.base ||= base; });
  } catch { /* sin git: el informe usa las instantáneas de cada turno */ }
}

// La parte objetiva, sin ninguna CLI. Se guarda en .office/cierre.json y .office/CIERRE.md. Nunca rompe el cierre del ciclo.
function generarCierre(chatId) {
  try {
    const dir = chatDir(chatId);
    const chat = readChat(chatId);
    const cierre = cierreLib.conRelato(cierreLib.construirCierre({ chat, dir, enCurso: running.has(chatId) }), chat, dir);
    cierreLib.guardar(dir, cierre);
    broadcast({ type: 'cierre-updated', chatId, cierre: cierreLib.resumenDe(cierre) });
    return cierre;
  } catch (err) {
    try { addMessage(chatId, { kind: 'system', text: i18n.t('server.cierre.failedWhy', { error: err.message }) }); } catch {}
    return null;
  }
}

// Relator (RF2): con el ciclo ya cerrado, un turno corto del de mejor nota (o del presidente en Consejo) reescribe lo
// subjetivo en palabras llanas. Solo devuelve JSON; fusionarRelato lo valida contra el disco. Si falla, tarda, cambia
// archivos del trabajo o empieza otro ciclo mientras tanto, se queda la plantilla y el informe dice por qué. Nunca bloquea
// el cierre ni escribe en el chat: el último mensaje del ciclo sigue siendo su resumen. relatorMinutes: 0 lo apaga.
const relatores = new Map(); // chatId → estado mínimo para runAgent (procs), fuera de `running`: la misión ya no está en curso

function cortarRelator(chatId) {
  const st = relatores.get(chatId);
  if (!st) return;
  st.stopped = true;
  for (const proc of st.procs) killTree(proc);
}

async function relatarCierre(chatId, cierre, equipo, { config = {}, presidente = null } = {}) {
  const minutos = config.relatorMinutes ?? 3;
  let agente;
  try { agente = minutos > 0 && cierreLib.elegirRelator(cierre, equipo, { presidente }); } catch { return; }
  if (!agente || relatores.has(chatId) || running.has(chatId)) return;
  const dir = chatDir(chatId);
  const st = { proc: null, procs: new Set(), stopped: false };
  relatores.set(chatId, st);
  // El relato (o el motivo por el que no lo hay) se guarda en el chat, atado a su ciclo: así sobrevive a cada
  // regeneración del informe («Aceptar así», Exportar) y no se aplica a un ciclo posterior.
  let ciclo = null;
  const guardarRelato = r => {
    updateChat(chatId, c => { c.relato = { ciclo, autor: agente.name, ...r }; });
    generarCierre(chatId);
  };
  try {
    ciclo = cierreLib.ultimoCiclo(readChat(chatId))?.id ?? null;
    const briefFile = 'relator.md';
    fs.writeFileSync(path.join(dir, '.office', briefFile), cierreLib.briefRelator(cierre, { minutos }));
    broadcast({ type: 'agent-status', chatId, agentId: agente.id, status: 'working', round: 0, activity: i18n.t('server.cierre.narrating'), started: Date.now() });
    const before = snapshot(dir);
    const result = await runAgent(chatId, agente, {
      timeoutMin: minutos, idleMin: Math.min(minutos, config.idleTimeoutMinutes ?? minutos), round: 0, briefFile,
      model: modelos.pick(agente), onEvent: entry => { if (entry.kind !== 'say') appendActivity(chatId, entry); },
    });
    broadcast({ type: 'agent-status', chatId, agentId: agente.id, status: 'idle' });
    if (st.stopped || running.has(chatId)) return; // empezó otro ciclo: su informe ya no es este
    if (workChanges(diffSnapshots(before, snapshot(dir))).length) return guardarRelato({ fallo: 'tocoArchivos' });
    if (result.code !== 0 || result.timedOut || result.idle) return guardarRelato({ fallo: 'cayo' });
    const datos = cierreLib.leerRelato(result.report || result.stdout);
    guardarRelato(datos ? { datos } : { fallo: 'sinJson' });
  } catch {
    try { if (!running.has(chatId)) guardarRelato({ fallo: 'cayo' }); } catch { /* la misión ya no existe */ }
  } finally {
    relatores.delete(chatId);
  }
}

// Al cerrar una misión editorial, sus propuestas pasan a la bandeja (o reemplazan la que pidió cambios).
function editorialAlCerrar(chatId) {
  let chat, office;
  try { chat = readChat(chatId); office = officeOfChat(chatId); } catch { return; }
  const meta = chat.editorial;
  if (!meta || office === EDIFICIO) return;
  try {
    const dir = chatDir(chatId);
    if (meta.tipo === 'tanda') {
      const r = editorial.cosechar(office, dir, { chatId, tanda: meta.franja || chatId });
      const st = editorial.estado(office);
      const t = (st.tandas || []).find(x => x.chatId === chatId);
      if (t) { t.fin = new Date().toISOString(); t.propuestas = r.creadas.length; t.descartadas = r.descartadas.length; editorial.guardarEstado(office, st); }
      updateChat(chatId, c => {
        c.modoDetalle = {
          modo: 'editorial',
          tipo: 'tanda',
          franja: meta.franja || null,
          creadas: r.creadas.length,
          descartadas: r.descartadas.length,
          temas: r.creadas.map(p => p.tema).filter(Boolean),
        };
      });
      oficinas.bitacora(office, `Editorial: ${r.creadas.length} propuesta(s) en la bandeja${r.descartadas.length ? `, ${r.descartadas.length} descartada(s) (${r.descartadas.map(d => d.motivo).join('; ')})` : ''}`);
      editorial.semillas.liberar(office, chatId); // las semillas que no salieron vuelven a la cola
      terminarRutinaAgentes(office, 'redaccion', chatId, { propuestas: r.creadas.length, descartadas: r.descartadas.length });
    } else if (meta.tipo === 'radar') {
      const regla = editorial.regla(office) || editorialLib.DEFAULT;
      let raw = null;
      try { raw = JSON.parse(fs.readFileSync(path.join(dir, 'radar.json'), 'utf8')); } catch { /* sin radar.json: el informe lo dice */ }
      const nuevas = cadenaLib.semillasRadar(raw, rutinaDe(regla, 'radar')?.cantidad || 3);
      const dia = editorialLib.diaLocal(regla.zona, Date.now());
      const previo = editorial.leerDia(office, 'radar', dia) || { fecha: dia, pasadas: [] };
      previo.pasadas = [...(previo.pasadas || []), { ts: new Date().toISOString(), chatId, temas: nuevas }].slice(-48);
      editorial.guardarDia(office, 'radar', dia, previo);
      const creadas = editorial.semillas.anadir(office, nuevas);
      terminarRutinaAgentes(office, 'radar', chatId, { temas: nuevas.length, semillas: creadas.length, ...(raw ? {} : { motivo: i18n.t('server.routine.noRadarFile') }) });
    } else if (meta.tipo === 'cambios') {
      const r = fs.existsSync(path.join(dir, 'propuestas', '1', 'propuesta.json'))
        ? editorial.cosechar(office, dir, { chatId, reemplaza: meta.propuesta }) : { creadas: [], descartadas: [] };
      if (!r.creadas.length && !r.descartadas.length) {
        editorial.marcar(office, meta.propuesta, { estado: 'pendiente', avisos: [i18n.t('server.editorial.changesMissing')] }, { evento: 'cambios-sin-entrega', chatId });
      }
    }
  } catch (err) {
    try { oficinas.bitacora(office, i18n.t('server.log.collectFailed', { id: chatId, msg: err.message })); } catch { /* sin bitácora */ }
  }
  broadcast({ type: 'editorial-updated', oficina: office });
}

// El informe de una ejecución con agentes: qué salió, qué CLI cayó (la tanda siguió con las demás) y los turnos reales,
// que corrigen el estimado del tope diario. Si cayeron todas, la rutina sigue viva: la siguiente franja lo reintenta.
function terminarRutinaAgentes(office, tipo, chatId, datos) {
  try {
    const regla = editorial.regla(office) || editorialLib.DEFAULT;
    const st = editorial.rutinas.de(office, tipo);
    if (st.ultima?.chatId !== chatId) return;
    const turnos = readChat(chatId).messages.filter(m => m.kind === 'agent');
    const cayeron = [...new Set(turnos.filter(m => m.verdict === 'ERROR').map(m => `${m.agentName} (${m.failure?.label?.toLowerCase() || '?'})`))];
    const trabajaron = turnos.filter(m => m.verdict !== 'ERROR').length;
    const informe = { ok: trabajaron > 0, ...datos, turnos: turnos.length, cayeron, ...(trabajaron ? {} : { motivo: i18n.t('server.routine.allDown') }) };
    const rut = rutinaDe(regla, tipo);
    const estimado = rutinasLib.costeEstimado({ tipo, equipo: equipoRutina(regla, rut).map(e => e.id) });
    editorial.rutinas.terminar(office, tipo, informe, { turnosReales: turnos.length, estimado, zona: regla.zona });
  } catch { /* el informe nunca rompe el cierre */ }
}

// Los campos que escriben los agentes (para la copia que reciben al pedir cambios: sin estado ni historial del servidor).
const camposAgente = p => ({ tema: p.tema, porQue: p.porQue, hook: p.hook, copy: p.copy, hashtags: p.hashtags, hora: p.hora, idiomas: p.idiomas, tipo: p.tipo, fuente: p.fuente });

function pedirCambios(office, pid, input) {
  const { p, nota, casillas } = editorial.decidir(office, pid, 'cambios', input);
  const regla = editorial.regla(office) || editorialLib.DEFAULT;
  const o = oficinas.read(office);
  const team = regla.equipo.slice(0, 2).map(e => ({ id: e.id, role: e.rol || undefined })); // mini ciclo: 1 a 2 turnos
  const chat = createMission(office, {
    text: editorialLib.briefCambios({ regla, oficina: o, propuesta: p, nota, casillas }),
    config: { mode: 'rondas', maxRounds: 1, workflow: 'relevo', team },
  }, { editorial: { tipo: 'cambios', propuesta: pid }, copiar: { from: editorial.carpeta(office, pid), to: path.join('propuestas', '1'), propuesta: camposAgente(p) } });
  const next = editorial.marcar(office, pid, { estado: 'en-cambios', cambiosPedidos: { nota, casillas, chatId: chat.id } }, { evento: 'cambios-pedidos', nota, casillas, chatId: chat.id });
  editorial.apuntarDecision(office, p, 'cambios', { nota, casillas });
  broadcast({ type: 'editorial-updated', oficina: office });
  return { propuesta: next, mision: chat.id };
}

async function aprobarPropuesta(office, pid, input) {
  const { p, nota } = editorial.decidir(office, pid, 'aprobar', input);
  // Semáforo (§3): una roja no se aprueba nunca; una amarilla pide confirmación explícita ({ confirmarAmarillo: true }).
  const puede = cadenaLib.puedeAprobar(p, { confirmarAmarillo: input.confirmarAmarillo === true });
  if (!puede.ok) throw Object.assign(new Error(puede.mensaje), { status: 409, codigo: puede.codigo });
  const regla = editorial.regla(office);
  if (!regla) throw Object.assign(new Error(i18n.t('server.error.editorialNoRule')), { status: 409 });
  if (!viralhunt.hasToken(office)) throw Object.assign(new Error(i18n.t('server.error.viralhuntToken')), { status: 409, codigo: 'sin_token' });
  const key = `${office}/${pid}`;
  if (aprobando.has(key)) throw Object.assign(new Error(i18n.t('server.error.proposalSending')), { status: 409 });
  aprobando.add(key);
  try {
    const nombre = p.imagenes?.[Math.max(0, Math.min(Number(input.imagen) || 0, (p.imagenes?.length || 1) - 1))];
    const imagen = nombre ? editorial.archivo(office, pid, nombre) : null;
    let vh;
    try { vh = await viralhunt.publicar(office, regla, p, imagen); } catch (err) {
      editorial.marcar(office, pid, { ultimoError: err.message }, { evento: 'error-viralhunt', error: err.message });
      broadcast({ type: 'editorial-updated', oficina: office });
      throw err;
    }
    const next = editorial.marcar(office, pid, { estado: 'aprobada', viralhunt: vh, ultimoError: null, notaAprobacion: nota || null, ...(p.verificacion?.semaforo === 'amarillo' ? { amarilloConfirmado: true } : {}) }, { evento: 'aprobada', destino: vh.donde, viralhuntId: vh.id });
    editorial.apuntarDecision(office, p, 'aprobar', { nota });
    oficinas.bitacora(office, `Editorial: propuesta ${pid} aprobada → ViralHunt #${vh.id} (${vh.donde})`);
    broadcast({ type: 'editorial-updated', oficina: office });
    return next;
  } finally { aprobando.delete(key); }
}

function rechazarPropuesta(office, pid, input) {
  const { p, nota } = editorial.decidir(office, pid, 'rechazar', input);
  const next = editorial.marcar(office, pid, { estado: 'rechazada', motivoRechazo: nota }, { evento: 'rechazada', nota });
  editorial.apuntarDecision(office, p, 'rechazar', { nota });
  broadcast({ type: 'editorial-updated', oficina: office });
  return next;
}

// El «estado» que pide el bot de la Nave en Discord: por oficina, misiones en curso, propuestas pendientes y su bot.
// De una oficina que no comparte con la Nave solo se dice eso.
function resumenNave() {
  const lineas = [i18n.t('discord.status.title')];
  for (const o of oficinas.list()) {
    const d = discordBots.vista(o.id);
    if (o.id !== EDIFICIO && !d.permitirNave) { lineas.push(i18n.t('discord.status.private', { office: o.nombre })); continue; }
    const enCurso = [...running.keys()].filter(id => { try { return oficinas.officeOf(id) === o.id; } catch { return false; } }).length;
    let pendientes = 0;
    try { pendientes = editorial.regla(o.id) ? editorial.propuestas(o.id).filter(p => p.estado === 'pendiente').length : 0; } catch { /* sin editorial */ }
    const bot = !d.configurado ? '—' : d.estado === 'conectado' ? '🟢' : '🟠';
    lineas.push(i18n.t('discord.status.line', { office: o.nombre, running: enCurso, pending: pendientes, bot }));
  }
  return lineas.join('\n');
}

function editorialResumen(office) {
  const regla = editorial.regla(office);
  const estado = editorial.estado(office);
  return {
    configurada: !!regla, regla: regla || { ...editorialLib.DEFAULT }, estado, abierta: tandaAbierta(office),
    proxima: regla ? editorialLib.proximaFranja(regla, Date.now()) : null, viralhunt: viralhunt.estado(office),
    rutinas: (regla?.rutinas || editorialLib.normalizarRegla({}).rutinas).map(r => rutinasLib.vistaRutina(r, editorial.rutinas.de(office, r.tipo), {
      zona: (regla || editorialLib.DEFAULT).zona, ahora: Date.now(), ejecutando: rutinaAbierta(office, r.tipo),
    })),
    semillasPendientes: editorial.semillas.leer(office).filter(s => s.estado === 'pendiente').length,
    opciones: { redes: editorialLib.REDES, fuentes: editorialLib.FUENTES, casillas: editorialLib.CASILLAS, proporciones: editorialLib.PROPORCIONES, rutinas: Object.keys(rutinasLib.TIPOS), minCada: rutinasLib.MIN_CADA },
  };
}

const IMG_NOMBRE = /^[\w.-]{1,80}\.(png|jpe?g|webp)$/i;
// Referencias visuales de la marca (§4): las sube el dueño; viven en editorial/marca/ y se listan en regla.marca.referencias.
async function subirReferencia(office, nombre, req) {
  if (!IMG_NOMBRE.test(nombre || '')) throw Object.assign(new Error(i18n.t('server.error.refName')), { status: 400 });
  const regla = editorial.regla(office);
  if (!regla) throw Object.assign(new Error(i18n.t('server.error.editorialNoRuleYet')), { status: 409 });
  const refs = regla.marca.referencias.filter(f => f !== nombre);
  if (refs.length >= 8) throw Object.assign(new Error(i18n.t('server.error.refMax', { n: 8 })), { status: 409 });
  const buf = await readRaw(req, 8 * 1048576);
  if (!buf.length) throw Object.assign(new Error(i18n.t('server.error.refName')), { status: 400 });
  const dir = path.join(editorial.dir(office), 'marca');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, nombre), buf);
  editorial.guardarRegla(office, { marca: { ...regla.marca, referencias: [...refs, nombre] } });
  return editorial.regla(office).marca;
}
function quitarReferencia(office, nombre) {
  const regla = editorial.regla(office);
  if (!regla || !IMG_NOMBRE.test(nombre || '')) throw Object.assign(new Error(i18n.t('server.error.fileMissing')), { status: 404 });
  fs.rmSync(path.join(editorial.dir(office), 'marca', nombre), { force: true });
  editorial.guardarRegla(office, { marca: { ...regla.marca, referencias: regla.marca.referencias.filter(f => f !== nombre) } });
  return editorial.regla(office).marca;
}

function chatDetail(id) {
  const dir = chatDir(id);
  const chat = readChat(id);
  const state = running.get(id);
  const config = configForChat(id, chat);
  const files = fileTree(dir);
  return {
    ...chat,
    config: normalizeCycleConfig(chat.config || {}, config),
    running: !!state, outcome: chatOutcome(chat, !!state),
    stopReason: stopReason(chat, !!state),
    accepted: !state && missionAccepted(chat),
    workingAgent: state?.agentId || null, activity: state?.activity || '', progress: state?.progress || null,
    workingAgents: state ? [...state.live].map(([agentId, l]) => ({ agentId, ...l })) : [],
    oficina: officeOfChat(id), files, path: dir, deliverables: preview.deliverables(files, chat.messages),
    handoff: readIfExists(path.join(dir, 'HANDOFF.md')),
    stats: computeAgentStats(chat.messages, config.agents, chat.debate),
  };
}

function exportChatMarkdown(detail) {
  const mode = detail.config.mode === 'auto'
    ? i18n.t('server.export.autoMode', { max: detail.config.maxRounds })
    : i18n.t('server.export.roundsMode', { max: detail.config.maxRounds });
  const wfName = workflows.WORKFLOWS.find(w => w.id === detail.config.workflow)?.name || i18n.t('server.export.relay');
  const chair = detail.config.workflow === 'consejo' ? i18n.t('server.export.chair', { name: detail.config.chair }) : '';
  const lines = [
    `# ${i18n.t('server.export.title', { title: detail.title })}`,
    '',
    i18n.t('server.export.created', { id: detail.id, created: detail.created }),
    i18n.t('server.export.modeLine', { mode, score: detail.config.minScore }),
    i18n.t('server.export.workflow', { name: wfName, chair }),
    i18n.t('server.export.team', { team: detail.config.team.map(tm => `${tm.id} (${tm.role})`).join(' → ') }),
    ...(detail.config.template ? [i18n.t('server.export.template', { name: templates.templateById(detail.config.template)?.name || detail.config.template })] : []),
    '',
    i18n.t('server.export.handoffTitle'),
    '',
    detail.handoff || i18n.t('server.export.noHandoff'),
    '',
    i18n.t('server.export.debateTitle'),
    '',
    ...(detail.debate.length
      ? detail.debate.map(o => [
        i18n.t('server.export.objection', { id: o.id, name: o.byName, round: o.round, status: o.status.toUpperCase() }),
        o.text,
        ...(o.replies || []).map(r => `- **${r.byName}** [${r.stance}]: ${r.text}`),
        '',
      ].join('\n'))
      : [i18n.t('server.export.noObjections'), '']),
    i18n.t('server.export.statsTitle'),
    '',
    i18n.t('server.export.statsHeader'),
    i18n.t('server.export.statsSep'),
    ...detail.stats.filter(s => s.turns).map(s => `| ${s.name} | ${s.turns} | ${s.avgScore ?? '–'} | ${s.approvals} | ${s.changes} | ${s.tokens || '–'} | ${s.seconds}s |`),
    '',
    i18n.t('server.export.historyTitle'),
    '',
    ...detail.messages.map(m => {
      if (m.kind === 'user') return `### ${m.intervention ? i18n.t('server.export.intervention', { ts: m.ts }) : i18n.t('server.export.request', { ts: m.ts })}\n\n${m.text}\n`;
      if (m.kind === 'system') return `> **${i18n.t('server.export.system', { ts: m.ts })}:** ${m.text}\n`;
      return `### ${m.agentName} (${m.role || ''}) · ${i18n.t('server.export.round', { n: m.round })} · ${i18n.t('server.export.score', { score: m.score ?? '–' })} · ${m.verdict}\n` +
        `${m.files?.length ? `${i18n.t('server.export.files', { files: m.files.join(', ') })}\n` : ''}` +
        `${m.diffs?.length ? m.diffs.map(d => `\n\`\`\`diff\n# ${d.file} (${d.status})\n${d.patch}\n\`\`\`\n`).join('') : ''}` +
        `${m.usage ? `${i18n.t('server.export.tokens', { total: m.usage.totalTokens, input: m.usage.inputTokens, output: m.usage.outputTokens })}\n` : ''}\n${m.text}\n`;
    }),
  ];
  return lines.join('\n');
}

async function handleMemory(req, res, url, office) {
  // Cada oficina tiene su cerebro: aquí no se ve el de ninguna otra.
  const MEMORY_DIR = oficinas.dirs(office).memoria;
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  if (url.pathname === '/api/memory' && req.method === 'GET') {
    return sendJson(res, 200, memory.listMemoryFiles(MEMORY_DIR).map(name => {
      const full = path.join(MEMORY_DIR, name);
      const st = fs.statSync(full);
      return { name, size: st.size, mtime: st.mtimeMs, entries: memory.splitEntries(name, fs.readFileSync(full, 'utf8')).length, versions: memory.listHistory(MEMORY_DIR, name).length };
    }));
  }
  if (url.pathname === '/api/memory/search') {
    const q = url.searchParams.get('q') || '';
    const scope = url.searchParams.get('scope') || 'todo';
    const docs = scope === 'oficina' ? memoryDocs(MEMORY_DIR) : [...memoryDocs(MEMORY_DIR), ...projectDocs(oficinas.dirs(office).proyectos)];
    return sendJson(res, 200, { hits: memory.searchDocs(q, docs), relevant: memory.relevantEntries(q, memoryDocs(MEMORY_DIR), 5) });
  }
  // Traspaso (herencia cero): solo desde el panel; ninguna llave de agente llega aquí (agentDenied).
  if (url.pathname === '/api/memory/entradas' && req.method === 'GET') {
    return sendJson(res, 200, traspasos.entradas(office, url.searchParams.get('name')));
  }
  if (url.pathname === '/api/memory/traspaso' && req.method === 'POST') {
    const r = traspasos.traspasar(office, await readBody(req));
    broadcast({ type: 'entrantes-updated', oficina: r.destino });
    return sendJson(res, 201, r);
  }
  if (url.pathname === '/api/memory/entrantes') {
    if (req.method === 'GET') return sendJson(res, 200, traspasos.listar(office));
    if (req.method === 'DELETE') {
      traspasos.descartar(office, url.searchParams.get('archivo'));
      broadcast({ type: 'entrantes-updated', oficina: office });
      return sendJson(res, 200, { ok: true });
    }
  }
  if (url.pathname === '/api/memory/entrantes/aceptar' && req.method === 'POST') {
    const body = await readBody(req);
    const r = traspasos.aceptar(office, body.archivo, body.tema);
    broadcast({ type: 'entrantes-updated', oficina: office });
    broadcast({ type: 'memory-updated', oficina: office });
    return sendJson(res, 200, r);
  }
  if (url.pathname === '/api/memory/file') {
    const name = memory.validName(url.searchParams.get('name'));
    if (req.method === 'GET') {
      if (!name || !fs.existsSync(path.join(MEMORY_DIR, name))) return sendJson(res, 404, { error: i18n.t('server.error.fileMissing') });
      const version = url.searchParams.get('version');
      if (version) {
        const v = path.join(MEMORY_DIR, memory.HISTORY_DIR, name.replace(/\.md$/, ''), path.basename(version));
        if (!fs.existsSync(v)) return sendJson(res, 404, { error: i18n.t('server.error.versionMissing') });
        return sendJson(res, 200, { content: fs.readFileSync(v, 'utf8'), version });
      }
      return sendJson(res, 200, { content: fs.readFileSync(path.join(MEMORY_DIR, name), 'utf8'), history: memory.listHistory(MEMORY_DIR, name) });
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readBody(req);
      const target = memory.validName(body.name || url.searchParams.get('name'));
      if (!target) return sendJson(res, 400, { error: i18n.t('server.error.invalidFileName') });
      if (typeof body.content !== 'string') return sendJson(res, 400, { error: i18n.t('server.error.contentRequired') });
      const file = path.join(MEMORY_DIR, target);
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (req.method === 'POST' && current != null) return sendJson(res, 409, { error: i18n.t('server.error.topicExists') });
      // Si alguien (un ciclo) escribió mientras el usuario editaba, se fusiona en vez de pisarlo.
      const merged = current == null ? body.content : memory.mergeText(body.base ?? current, body.content, current);
      memory.writeWithHistory(MEMORY_DIR, target, merged);
      broadcast({ type: 'memory-updated', oficina: office });
      return sendJson(res, 200, { content: merged, merged: merged !== body.content, name: target });
    }
  }
  return null;
}

// Las escrituras en la API solo valen desde la propia app. El HTML de un proyecto (en el visor, origen "null") u otra
// web abierta en el navegador no pueden lanzar ciclos, borrar plantillas ni editar el cerebro.
function sameOriginWrite(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const origin = req.headers.origin;
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site'])) return false;
  return !origin || origin === `http://${req.headers.host}`;
}

// Con llave de agente (Authorization: Bearer om_…) solo se puede trabajar con misiones de SU oficina: crearlas,
// seguirlas, intervenir, detenerlas y leer sus archivos y su cerebro. Nada de eventos en vivo de todo el edificio,
// abrir carpetas, plantillas ni oficinas ajenas. Devuelve el motivo si se niega, o null.
function agentDenied(agent, req, url, parts) {
  const m = req.method, p = url.pathname;
  const mine = id => { try { return oficinas.officeOf(decodeURIComponent(id || '')) === agent.oficina; } catch { return false; } };
  if (parts[0] === 'raw') return mine(parts[1]) ? null : i18n.t('server.error.notYourMission');
  if (parts[0] !== 'api') return i18n.t('server.error.agentKeyApiOnly');
  if (m === 'GET' && ['/api/agents', '/api/oficinas', '/api/memory', '/api/memory/search', '/api/memory/file', '/api/stats'].includes(p)) return null;
  if (m === 'POST' && p === '/api/adjuntos') return null;
  if (m === 'POST' && p === '/api/bots/mensaje') return null; // un bot externo inicia algo en SU oficina (puerta-bots.js)
  if (parts[1] === 'chats') {
    if (parts.length === 2) return ['GET', 'POST'].includes(m) ? null : 'No permitido';
    if (!mine(parts[2])) return i18n.t('server.error.notYourMission');
    const sub = parts[3] || '';
    if (m === 'GET' && ['', 'activity', 'file', 'export'].includes(sub)) return null;
    // «Lo acepto así» lo decide el usuario en el panel. Una llave no puede fingir ese cierre.
    if (m === 'POST' && ['messages', 'intervene', 'stop'].includes(sub)) return null;
  }
  return i18n.t('server.error.agentKeyForbidden');
}

// GET /raw/<misión>/<ruta>: un archivo del proyecto tal cual, en streaming, con su tipo MIME y aislado (ver lib/preview.js).
// Las rutas relativas de un HTML (img/, estilos.css) se resuelven solas porque la ruta del archivo va en la URL.
function serveRaw(req, res, parts) {
  if (!['GET', 'HEAD'].includes(req.method)) return sendJson(res, 405, { error: i18n.t('server.error.readOnly') });
  let dir, rel;
  try {
    dir = chatDir(decodeURIComponent(parts[1] || ''));
    rel = parts.slice(2).map(decodeURIComponent).join('/');
  } catch (err) { return sendJson(res, err.status || 400, { error: err.status ? err.message : i18n.t('server.error.invalidPath') }); }
  const found = preview.resolveInside(dir, rel);
  if (found.error) return sendJson(res, found.status, { error: found.error });
  res.writeHead(200, preview.rawHeaders(found.file, found.size));
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(found.file).on('error', () => res.destroy()).pipe(res);
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const parts = url.pathname.split('/').filter(Boolean);

  // Llave de agente (Authorization: Bearer om_…): acceso solo a su oficina (ver agentDenied).
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1];
  const agentKey = bearer ? oficinas.checkKey(bearer) : null;
  if (bearer) {
    if (!agentKey) return sendJson(res, 401, { error: i18n.t('server.error.invalidAgentKey') });
    const denied = agentDenied(agentKey, req, url, parts);
    if (denied) return sendJson(res, 403, { error: denied });
  }
  // Sin cookie, un curl a la API local lee el panel. La llave de agente sigue valiendo para su oficina.
  // La respuesta de un bot llega por puerta-bots.js sin cookie: su autorización es el token de un solo uso.
  const botReply = req.method === 'POST' && parts[0] === 'api' && parts[1] === 'bots' && parts[2] === 'respuesta';
  if (panel && (parts[0] === 'api' || parts[0] === 'raw') && !agentKey && !botReply && !acceso.acepta(panel, req)) {
    return sendJson(res, 401, { error: i18n.t('server.error.cookieRequired') });
  }
  // La oficina de la petición: la de la llave, o ?oficina= (por defecto, el edificio).
  const office = agentKey ? agentKey.oficina : url.searchParams.get('oficina') || EDIFICIO;
  if (!oficinas.read(office)) return sendJson(res, 404, { error: i18n.t('server.error.officeMissing') });

  if (parts[0] === 'raw') return serveRaw(req, res, parts);
  if (parts[0] === 'api' && !sameOriginWrite(req)) return sendJson(res, 403, { error: i18n.t('server.error.crossOrigin') });

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': conectado\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  // Idioma de la app (EN por defecto): lo lee la interfaz al arrancar y lo cambia el selector EN | ES.
  if (url.pathname === '/api/preferencias') {
    if (req.method === 'GET') return sendJson(res, 200, { idioma: i18n.getLang(), idiomas: i18n.LANGS });
    if (req.method === 'PUT' || req.method === 'POST') return sendJson(res, 200, { idioma: i18n.setLang((await readBody(req)).idioma) });
  }
  if (url.pathname === '/api/agents') {
    const config = loadConfig();
    // En una oficina con empleados, «los agentes» son ellos (con su CLI, modelo y ficha).
    const staff = configFor(office);
    const botOf = a => ({ id: a.id, name: a.name, role: a.role, color: a.color, stream: 'text', enabled: true, installed: true,
      avatar: a.avatar, modeloLabel: a.modeloLabel, bot: true });
    const list = staff.empleados
      ? staff.agents.map(a => (a.bot ? botOf(a) : { id: a.id, name: a.name, role: a.role, color: a.color, stream: a.stream || 'text', enabled: true,
        installed: isInstalled(a.cmd), cli: a.cli, modelo: a.modelo, modeloLabel: a.modeloLabel, reserva: a.reserva ? a.reserva.modeloLabel : null,
        avatar: a.avatar, empleado: true }))
      : [...agentsWithStatus(), ...staff.agents.filter(a => a.bot).map(botOf)];
    return sendJson(res, 200, {
      agents: list, empleados: !!staff.empleados, maxRounds: config.maxRounds || 3, minScore: config.minScore || 9,
      autoMaxRounds: config.autoMaxRounds || 6, turnTimeoutMinutes: config.turnTimeoutMinutes || 20, idleTimeoutMinutes: config.idleTimeoutMinutes ?? 10,
      workflows: workflows.WORKFLOWS, maxParallel: workflows.DEFAULT_PARALLEL,
    });
  }
  if (url.pathname === '/api/workflows/suggest') {
    return sendJson(res, 200, { workflow: workflows.suggestWorkflow(url.searchParams.get('q') || '') });
  }
  if (parts[0] === 'api' && parts[1] === 'templates') {
    if (parts.length === 2 && req.method === 'GET') return sendJson(res, 200, templates.allTemplates());
    if (parts.length === 2 && req.method === 'POST') {
      const { template, error } = templates.normalizeCustomTemplate(await readBody(req), loadConfig().agents);
      if (error) return sendJson(res, 400, { error });
      const list = readCustomTemplates();
      const replaced = list.some(t => t.id === template.id);
      writeCustomTemplates([...list.filter(t => t.id !== template.id), template]);
      broadcast({ type: 'templates-updated' });
      return sendJson(res, replaced ? 200 : 201, { template, replaced });
    }
    if (parts.length === 3 && req.method === 'DELETE') {
      const list = readCustomTemplates();
      if (!list.some(t => t.id === parts[2])) return sendJson(res, 404, { error: i18n.t('server.error.customOnly') });
      writeCustomTemplates(list.filter(t => t.id !== parts[2]));
      broadcast({ type: 'templates-updated' });
      return sendJson(res, 200, { ok: true });
    }
  }
  if (url.pathname === '/api/clis/modelos') {
    // Los modelos que se pueden elegir por CLI (lista de SIMULACIONES.md §3, verificada con las ayudas el 23-oct-2026).
    const agentsList = loadConfig().agents;
    return sendJson(res, 200, agentsList.map(a => ({ id: a.id, name: a.name, cmd: a.cmd, kind: empleados.kindOf(a), installed: isInstalled(a.cmd),
      modelos: empleados.KNOWN_MODELS[empleados.kindOf(a)] || [], flag: empleados.MODEL_FLAG[empleados.kindOf(a)] || null })));
  }
  // ---------- Bots externos (Grok Bots por webhook) ----------
  if (parts[0] === 'api' && parts[1] === 'bots') {
    // Respuesta de un turno (la reenvía puerta-bots.js desde /bots/r/<token>): 200, 404 si no existe, 410 si ya se usó o caducó.
    if (parts[2] === 'respuesta' && parts.length === 4 && req.method === 'POST') {
      const raw = (await readRaw(req, BOT_MAX_BODY)).toString('utf8');
      let texto = raw;
      if (/json/i.test(req.headers['content-type'] || '')) {
        try { const j = JSON.parse(raw); texto = typeof j === 'string' ? j : j.texto ?? j.text ?? j.respuesta ?? j.message ?? JSON.stringify(j); } catch { return sendJson(res, 400, { error: i18n.t('server.error.invalidJson') }); }
      }
      const r = bots.deliver(decodeURIComponent(parts[3]), { texto: String(texto) });
      if (r.status === 200 && r.meta?.ping) {
        bots.touch(r.meta.oficina, r.meta.bot, { ultimaRespuesta: new Date().toISOString() });
        broadcast({ type: 'oficinas-updated' });
      }
      return sendJson(res, r.status, r.status === 200 ? { ok: true } : { error: r.status === 404 ? i18n.t('server.error.unknownToken') : i18n.t('server.error.expiredToken') });
    }
    // Un bot inicia algo en SU oficina con una llave de agente (puerta-bots.js: /bots/o/<oficina>/<llave>).
    // Con "mision" (en curso, de su oficina) es una directiva; sin ella, una misión nueva.
    if (parts[2] === 'mensaje' && parts.length === 3 && req.method === 'POST') {
      if (!agentKey) return sendJson(res, 401, { error: i18n.t('server.error.agentKeyRequired') });
      const body = await readBody(req);
      const text = String(body.texto ?? body.text ?? '').trim();
      const from = `${agentKey.nombre} (bot)`;
      if (body.mision) {
        if (oficinas.officeOf(String(body.mision)) !== agentKey.oficina) return sendJson(res, 404, { error: i18n.t('server.error.missionMissing') });
        if (!running.has(String(body.mision))) return sendJson(res, 409, { error: i18n.t('server.error.missionIdle') });
        return sendJson(res, 200, interveneMission(String(body.mision), { text, asObjection: body.objecion === true }, { by: { agentId: `bot:${agentKey.nombre}`, agentName: from } }));
      }
      const chat = createMission(agentKey.oficina, { text, config: body.config || {}, from });
      return sendJson(res, 201, { id: chat.id, oficina: chat.oficina, titulo: chat.title });
    }
    // La URL pública (túnel) a la que los bots responden. Solo desde el panel.
    if (parts[2] === 'ajustes' && parts.length === 3) {
      if (req.method === 'GET') return sendJson(res, 200, { publicUrl: bots.publicUrl() });
      if (req.method === 'PUT' || req.method === 'POST') return sendJson(res, 200, { publicUrl: bots.setPublicUrl((await readBody(req)).publicUrl) });
    }
    // Arranca la puerta en este PC, sin permisos de administrador. Si ya escucha, no lanza otra.
    if (parts[2] === 'puerta' && parts.length === 3 && req.method === 'POST') {
      const before = await bots.gateUp();
      if (before.ok) return sendJson(res, 200, { ok: true, already: true, port: before.port });
      const started = bots.startGate();
      let up = { ok: false, port: before.port };
      for (let i = 0; i < 20 && !up.ok; i++) {
        await new Promise(r => setTimeout(r, 100));
        up = await bots.gateUp();
      }
      return sendJson(res, up.ok ? 200 : 502, { ok: up.ok, already: false, pid: started.pid, port: up.port, error: up.ok ? null : i18n.t('bots.err.gateStart', { port: up.port }) });
    }
  }
  // ---------- Editorial continua: regla, tanda, bandeja y token de ViralHunt (solo desde el panel) ----------
  if (parts[0] === 'api' && parts[1] === 'oficinas' && ['editorial', 'viralhunt'].includes(parts[3])) {
    const o = oficinas.read(parts[2]);
    if (!o || o.id === EDIFICIO) return sendJson(res, 404, { error: i18n.t('server.error.officeMissing') });
    if (parts[3] === 'viralhunt') {
      if (parts.length === 4 && req.method === 'GET') return sendJson(res, 200, viralhunt.estado(o.id));
      if (parts.length === 4 && (req.method === 'PUT' || req.method === 'POST')) {
        const r = viralhunt.setToken(o.id, (await readBody(req)).token);
        oficinas.bitacora(o.id, i18n.t('server.log.vhTokenSaved'));
        broadcast({ type: 'editorial-updated', oficina: o.id });
        return sendJson(res, 200, r);
      }
      if (parts.length === 4 && req.method === 'DELETE') {
        const r = viralhunt.removeToken(o.id);
        oficinas.bitacora(o.id, i18n.t('server.log.vhTokenDeleted'));
        broadcast({ type: 'editorial-updated', oficina: o.id });
        return sendJson(res, 200, r);
      }
      // Probar: quién es el token (plan, permisos, consultas de hoy) y a dónde puede publicar. Nunca devuelve el token.
      if (parts[4] === 'probar' && parts.length === 5 && req.method === 'POST') {
        const [cuenta, destinos] = await Promise.all([viralhunt.cuenta(o.id), viralhunt.destinos(o.id).catch(err => ({ error: err.message }))]);
        return sendJson(res, 200, {
          ok: true, plan: cuenta?.plan?.key || null, puedePublicar: cuenta?.plan?.can_publish ?? null, permisos: cuenta?.permissions || null,
          consultasHoy: cuenta?.daily_queries || null, proyectos: (destinos.projects || []).map(p => ({ id: p.id, name: p.name, lang: p.lang || null })),
          cuentas: (destinos.accounts || []).map(a => ({ account_id: a.account_id, network: a.network, name: a.name })),
          mustDraft: destinos.must_draft ?? null, reviewStageReady: destinos.review_stage_ready ?? null, error: destinos.error || null,
        });
      }
    }
    if (parts[3] === 'editorial') {
      if (parts.length === 4 && req.method === 'GET') return sendJson(res, 200, editorialResumen(o.id));
      if (parts.length === 4 && (req.method === 'PUT' || req.method === 'PATCH')) {
        editorial.guardarRegla(o.id, await readBody(req));
        broadcast({ type: 'editorial-updated', oficina: o.id });
        return sendJson(res, 200, editorialResumen(o.id));
      }
      if (parts[4] === 'tanda' && parts.length === 5 && req.method === 'POST') {
        const chat = await lanzarTanda(o.id, { manual: true });
        return sendJson(res, 201, { id: chat.id, titulo: chat.title });
      }
      if (parts[4] === 'gusto' && parts.length === 5 && req.method === 'GET') return sendJson(res, 200, { contenido: editorial.gusto(o.id), notas: editorial.notasGusto(o.id) });
      // Editar el gusto a mano: lo escrito son las notas del dueño, que encabezan el resumen y nunca se pisan.
      if (parts[4] === 'gusto' && parts.length === 5 && req.method === 'PUT') {
        const contenido = editorial.guardarNotasGusto(o.id, (await readBody(req)).notas);
        broadcast({ type: 'editorial-updated', oficina: o.id });
        return sendJson(res, 200, { contenido, notas: editorial.notasGusto(o.id) });
      }
      // ---------- v2: rutinas, semillas, encargos, escritores, galería, desempeño y marca ----------
      if (parts[4] === 'rutinas') {
        const tipo = parts[5];
        if (parts.length === 5 && req.method === 'GET') return sendJson(res, 200, editorialResumen(o.id).rutinas);
        if (parts.length === 7 && req.method === 'POST' && rutinasLib.TIPOS[tipo]) {
          if (parts[6] === 'pausar' || parts[6] === 'reanudar') {
            pausarRutina(o.id, tipo, parts[6] === 'reanudar');
            return sendJson(res, 200, editorialResumen(o.id).rutinas.find(r => r.tipo === tipo));
          }
          if (parts[6] === 'ejecutar') {
            if (rutinaAbierta(o.id, tipo)) throw Object.assign(new Error(i18n.t('server.error.routineOpen')), { status: 409, codigo: 'rutina_abierta' });
            const r = ejecutarRutina(o.id, tipo, { manual: true });
            // Las del servidor responden al terminar; las de agentes, al lanzar la misión.
            const out = await r;
            return sendJson(res, 202, out?.id ? { mision: out.id } : { informe: out });
          }
        }
      }
      if (parts[4] === 'semillas') {
        if (parts.length === 5 && req.method === 'GET') return sendJson(res, 200, editorial.semillas.leer(o.id).slice().reverse());
        if (parts.length === 6 && req.method === 'DELETE') {
          const s = editorial.semillas.quitar(o.id, decodeURIComponent(parts[5]));
          if (!s) return sendJson(res, 404, { error: i18n.t('server.error.notFound') });
          broadcast({ type: 'editorial-updated', oficina: o.id });
          return sendJson(res, 200, s);
        }
      }
      if (parts[4] === 'encargos' && parts.length === 5 && req.method === 'POST') {
        const s = editorial.encargar(o.id, await readBody(req));
        broadcast({ type: 'editorial-updated', oficina: o.id });
        return sendJson(res, 201, s);
      }
      if (parts[4] === 'escritores' && parts.length === 5 && req.method === 'GET') return sendJson(res, 200, editorial.escritores(o.id));
      if (parts[4] === 'galeria' && parts[5] === 'exportar' && parts.length === 6 && req.method === 'GET') {
        const ids = (url.searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean);
        const buf = editorial.exportarGaleriaZip(o.id, ids);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="editorial-${o.id}-${Date.now()}.zip"`,
          'Content-Length': buf.length,
          'Cache-Control': 'no-cache',
        });
        return res.end(buf);
      }
      if (parts[4] === 'galeria' && parts.length === 5 && req.method === 'GET') {
        const q = Object.fromEntries(['estado', 'red', 'tema', 'escritor', 'rutina'].map(k => [k, url.searchParams.get(k) || '']));
        return sendJson(res, 200, editorial.galeria(o.id, q));
      }
      if (parts[4] === 'desempeno' && parts.length === 5 && req.method === 'GET') return sendJson(res, 200, editorial.ultimoDia(o.id, 'desempeno') || { ready: null });
      if (parts[4] === 'radar' && parts.length === 5 && req.method === 'GET') return sendJson(res, 200, editorial.ultimoDia(o.id, 'radar') || { pasadas: [] });
      if (parts[4] === 'marca' && parts[5] === 'referencias' && parts.length === 7) {
        const nombre = decodeURIComponent(parts[6]);
        if (req.method === 'PUT' || req.method === 'POST') { const m = await subirReferencia(o.id, nombre, req); broadcast({ type: 'editorial-updated', oficina: o.id }); return sendJson(res, 200, m); }
        if (req.method === 'DELETE') { const m = quitarReferencia(o.id, nombre); broadcast({ type: 'editorial-updated', oficina: o.id }); return sendJson(res, 200, m); }
        if (req.method === 'GET') {
          const file = IMG_NOMBRE.test(nombre) ? path.join(editorial.dir(o.id), 'marca', nombre) : null;
          if (!file || !fs.existsSync(file)) return sendJson(res, 404, { error: i18n.t('server.error.fileMissing') });
          res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
          return fs.createReadStream(file).pipe(res);
        }
      }
      if (parts[4] === 'propuestas') {
        if (parts.length === 5 && req.method === 'GET') return sendJson(res, 200, editorial.propuestas(o.id));
        const pid = decodeURIComponent(parts[5] || '');
        if (parts.length === 6 && req.method === 'GET') {
          const p = editorial.leer(o.id, pid);
          return p ? sendJson(res, 200, p) : sendJson(res, 404, { error: i18n.t('server.error.proposalMissing') });
        }
        if (parts[6] === 'archivo' && parts.length === 8 && req.method === 'GET') {
          const file = editorial.archivo(o.id, pid, decodeURIComponent(parts[7]));
          if (!file) return sendJson(res, 404, { error: i18n.t('server.error.fileMissing') });
          const type = MIME[path.extname(file).toLowerCase()] || (file.endsWith('.md') ? 'text/markdown' : 'application/octet-stream');
          res.writeHead(200, { 'Content-Type': type.startsWith('image/') ? type : `${type}; charset=utf-8`, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
          return fs.createReadStream(file).pipe(res);
        }
        if (parts.length === 7 && req.method === 'POST') {
          const body = await readBody(req);
          if (parts[6] === 'aprobar') return sendJson(res, 200, await aprobarPropuesta(o.id, pid, body));
          if (parts[6] === 'cambios') return sendJson(res, 202, pedirCambios(o.id, pid, body));
          if (parts[6] === 'rechazar') return sendJson(res, 200, rechazarPropuesta(o.id, pid, body));
          if (parts[6] === 'reusar') { const s = editorial.reusar(o.id, pid); broadcast({ type: 'editorial-updated', oficina: o.id }); return sendJson(res, 201, s); }
        }
        // Calendario: mover la hora de una pendiente antes de enviarla.
        if (parts.length === 7 && parts[6] === 'hora' && (req.method === 'PATCH' || req.method === 'PUT')) {
          const p = editorial.cambiarHora(o.id, pid, (await readBody(req)).hora);
          broadcast({ type: 'editorial-updated', oficina: o.id });
          return sendJson(res, 200, p);
        }
      }
    }
    return sendJson(res, 404, { error: i18n.t('server.error.notFound') });
  }
  // Discord de una oficina, o de la Nave con /api/oficinas/edificio/discord. Solo desde el panel (una llave de agente no
  // llega aquí: agentDenied). El token se guarda en discord.secreto.json y nunca se devuelve.
  if (parts[0] === 'api' && parts[1] === 'oficinas' && parts[3] === 'discord') {
    const o = oficinas.read(parts[2]);
    if (!o) return sendJson(res, 404, { error: i18n.t('server.error.officeMissing') });
    if (parts.length === 4 && req.method === 'GET') return sendJson(res, 200, discordBots.vista(o.id));
    if (parts.length === 4 && (req.method === 'PUT' || req.method === 'POST')) {
      try { return sendJson(res, 200, discordBots.guardar(o.id, await readBody(req))); } catch (err) {
        if (err.codigo === 'token_invalido') throw Object.assign(new Error(i18n.t('discord.err.token')), { status: 400, codigo: err.codigo });
        throw err;
      }
    }
    if (parts.length === 4 && req.method === 'DELETE') return sendJson(res, 200, discordBots.borrar(o.id));
    if (parts.length === 5 && parts[4] === 'probar' && req.method === 'POST') return sendJson(res, 200, await discordBots.probar(o.id));
    return sendJson(res, 404, { error: i18n.t('server.error.notFound') });
  }
  // Bots de una oficina: listar, añadir, quitar y probar (ping de ida y vuelta). Nunca se devuelven URL ni llave.
  if (parts[0] === 'api' && parts[1] === 'oficinas' && parts[3] === 'bots') {
    const o = oficinas.read(parts[2]);
    if (!o) return sendJson(res, 404, { error: i18n.t('server.error.officeMissing') });
    if (parts.length === 4 && req.method === 'GET') return sendJson(res, 200, bots.list(o.id));
    if (parts.length === 4 && req.method === 'POST') {
      const bot = bots.add(o.id, await readBody(req));
      broadcast({ type: 'oficinas-updated' });
      return sendJson(res, 201, bot);
    }
    if (parts.length === 5 && req.method === 'DELETE') {
      bots.remove(o.id, decodeURIComponent(parts[4]));
      broadcast({ type: 'oficinas-updated' });
      return sendJson(res, 200, { ok: true });
    }
    if (parts.length === 5 && parts[4] === 'asistente' && req.method === 'GET') return sendJson(res, 200, await assistantStatus());
    if (parts.length === 6 && parts[5] === 'copiar' && req.method === 'POST') {
      const body = await readBody(req);
      const bot = bots.copyTo(o.id, decodeURIComponent(parts[4]), { destino: body.destino, incluirLlave: body.incluirLlave === true });
      broadcast({ type: 'oficinas-updated' });
      return sendJson(res, 201, bot);
    }
    if (parts.length === 6 && parts[5] === 'secreto' && req.method === 'POST') {
      const bot = bots.setSecret(o.id, decodeURIComponent(parts[4]), await readBody(req));
      broadcast({ type: 'oficinas-updated' });
      return sendJson(res, 200, bot);
    }
    if (parts.length === 6 && parts[5] === 'probar' && req.method === 'POST') {
      const botId = decodeURIComponent(parts[4]);
      const bot = bots.list(o.id).find(b => b.id === botId);
      if (!bot) return sendJson(res, 404, { error: i18n.t('server.error.botMissing') });
      const t0 = Date.now();
      const waitMs = Math.min(20000, Number(process.env.OFFICEMATRIX_PING_MS) || 20000);
      const turn = bots.openTurn({ ping: true, oficina: o.id, bot: botId }, waitMs);
      const responder = bots.replyUrl(turn.token);
      if (!responder) { turn.cancel(); return sendJson(res, 400, { error: i18n.t('server.error.tunnelRequired') }); }
      const sent = await bots.send(o.id, botId, {
        tipo: 'ping', oficina: o.id, bot: { id: botId, nombre: bot.nombre }, responder_a: responder,
        formato: i18n.t('server.bot.ping'),
      });
      if (!sent.ok) {
        turn.cancel();
        return sendJson(res, 200, { enviado: false, status: sent.status || null, error: sent.error || null, texto: null, pong: false, ms: Date.now() - t0 });
      }
      const reply = await Promise.race([turn.wait, new Promise(r => setTimeout(() => r(null), waitMs))]);
      if (!reply) turn.cancel();
      const texto = reply ? redact(String(reply.texto || '').trim(), secretsOf(o.id)) : null;
      return sendJson(res, 200, { enviado: true, status: sent.status || null, error: null, texto, pong: (texto || '').toLowerCase() === 'pong', ms: Date.now() - t0 });
    }
  }
  // Chat de la oficina. El edificio no tiene: mezcla encargos sin relación.
  if (parts[0] === 'api' && parts[1] === 'oficinas' && parts[3] === 'chat') {
    const o = oficinas.read(parts[2]);
    if (!o || o.id === EDIFICIO) return sendJson(res, 404, { error: i18n.t('chat.err.building') });
    const secrets = secretsOf(o.id);
    if (parts.length === 4 && req.method === 'GET') {
      return sendJson(res, 200, { mensajes: officeChat.list(o.id, secrets), anfitrion: officeChat.readSettings(o.id).anfitrion, miembros: chatMembers(o.id) });
    }
    if (parts.length === 4 && req.method === 'PUT') {
      const body = await readBody(req);
      const id = body.anfitrion ? String(body.anfitrion) : null;
      if (id && !chatMembers(o.id).some(m => m.sceneId === id || m.id === id)) return sendJson(res, 400, { error: i18n.t('chat.err.host') });
      return sendJson(res, 200, officeChat.setHost(o.id, id));
    }
    if (parts.length === 4 && req.method === 'POST') {
      const body = await readBody(req);
      const mensajes = await runOfficeChat(o.id, body.texto ?? body.text ?? '');
      return sendJson(res, 200, { mensajes });
    }
    if (parts[4] === 'mision' && parts.length === 5 && req.method === 'POST') {
      const body = await readBody(req);
      const ids = new Set((body.ids || []).map(String));
      const all = officeChat.list(o.id, secrets);
      const picked = ids.size ? all.filter(m => ids.has(m.id)) : [];
      if (!picked.length) return sendJson(res, 400, { error: i18n.t('chat.pick') });
      return sendJson(res, 200, draftMission(picked));
    }
    return sendJson(res, 404, { error: i18n.t('server.error.notFound') });
  }
  if (parts[0] === 'api' && parts[1] === 'oficinas') {
    const agentIds = loadConfig().agents; // objetos: la validación de empleados mira cmd y modelos
    const summary = o => {
      const chats = listChats(o.id);
      return { ...oficinas.pub(o), misiones: chats.length, enCurso: chats.filter(c => c.running).length };
    };
    if (parts[2] === 'plantillas' && parts.length === 3 && req.method === 'GET') return sendJson(res, 200, [empleados.plantillaRedaccion()]);
    if (parts[2] === 'validar' && parts.length === 3 && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, empleados.validar({ marca: body.marca, empleados: body.empleados }, agentIds));
    }
    if (parts[3] === 'bitacora' && parts.length === 4 && req.method === 'GET') {
      if (agentKey && agentKey.oficina !== parts[2]) return sendJson(res, 404, { error: i18n.t('server.error.officeMissing') });
      return sendJson(res, 200, oficinas.leerBitacora(parts[2]));
    }
    // «Hoy en la oficina» (§4.5): solo lo que confirmó el servidor. ?dia=AAAA-MM-DD para otro día.
    if (parts[3] === 'hoy' && parts.length === 4 && req.method === 'GET') {
      const o = oficinas.read(parts[2]);
      if (!o) return sendJson(res, 404, { error: i18n.t('server.error.officeMissing') });
      const misiones = listChats(o.id).map(c => { try { return { ...readChat(c.id), running: c.running, outcome: c.outcome }; } catch { return null; } }).filter(Boolean);
      return sendJson(res, 200, hoy.tablero({ oficina: o, equipo: configFor(o.id).agents, misiones, entrantes: traspasos.listar(o.id), dia: url.searchParams.get('dia'), lang: i18n.LANGS.includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : i18n.getLang() }));
    }
    if (parts.length === 2 && req.method === 'GET') return sendJson(res, 200, oficinas.list().filter(o => !agentKey || o.id === agentKey.oficina).map(summary));
    if (parts.length === 2 && req.method === 'POST') {
      const o = oficinas.create(await readBody(req), agentIds);
      broadcast({ type: 'oficinas-updated' });
      return sendJson(res, 201, summary(o));
    }
    if (parts.length === 3 && (req.method === 'PATCH' || req.method === 'PUT')) {
      const o = oficinas.update(parts[2], await readBody(req), agentIds);
      broadcast({ type: 'oficinas-updated' });
      return sendJson(res, 200, summary(o));
    }
    // Llaves de agente: la llave se muestra una sola vez.
    if (parts[3] === 'llaves' && parts.length === 4 && req.method === 'POST') {
      const k = oficinas.addKey(parts[2], (await readBody(req)).nombre);
      broadcast({ type: 'oficinas-updated' });
      return sendJson(res, 201, k);
    }
    if (parts[3] === 'llaves' && parts.length === 5 && req.method === 'DELETE') {
      oficinas.removeKey(parts[2], decodeURIComponent(parts[4]));
      broadcast({ type: 'oficinas-updated' });
      return sendJson(res, 200, { ok: true });
    }
  }
  if (url.pathname === '/api/stats') {
    const config = configFor(office); // con empleados, los expedientes van por empleado
    const all = listChats(office).map(c => readChat(c.id));
    return sendJson(res, 200, computeAgentStats(all.flatMap(c => c.messages), config.agents, all.flatMap(c => c.debate)));
  }
  if (parts[0] === 'api' && parts[1] === 'memory') {
    const handled = await handleMemory(req, res, url, office);
    if (handled !== null) return;
  }

  // Subir un adjunto: cuerpo binario, ?nombre=archivo.pdf. Devuelve su id para el pedido.
  if (url.pathname === '/api/adjuntos' && req.method === 'POST') {
    const buf = await readRaw(req, adjuntos.MAX_BYTES);
    return sendJson(res, 201, adjuntos.stage(UPLOADS_DIR, url.searchParams.get('nombre'), buf));
  }

  if (parts[0] === 'api' && parts[1] === 'chats') {
    if (parts.length === 2 && req.method === 'GET') return sendJson(res, 200, listChats(office));
    if (parts.length === 2 && req.method === 'POST') return sendJson(res, 201, createMission(office, await readBody(req)));

    const id = parts[2];
    const dir = chatDir(id);
    if (parts.length === 3 && req.method === 'GET') return sendJson(res, 200, chatDetail(id));
    if (parts[3] === 'messages' && req.method === 'POST') {
      const body = await readBody(req);
      if (running.has(id)) return sendJson(res, 409, { error: i18n.t('server.error.chatBusy') });
      const chat = readChat(id);
      const input = cycleInput(body);
      const cfg = normalizeCycleConfig(Object.keys(input).length ? { ...(chat.config || {}), ...input } : chat.config || {}, configForChat(id, chat));
      updateChat(id, c => { c.config = cfg; });
      const text = String(body.text || '').trim();
      // Reanudar no es un pedido nuevo: el brief seguiría tratando el original como "ya trabajado".
      if (body.resume === true || (!text && chatOutcome(readChat(id), false) === 'interrupted')) {
        addMessage(id, { kind: 'system', text: i18n.t('server.notice.resume') });
        runCycle(id);
        return sendJson(res, 202, { ok: true, resumed: true });
      }
      const att = withAttachments(id, text || i18n.t('server.anotherPass', {}, chatLang(readChat(id))), body.attachments);
      addMessage(id, { kind: 'user', text: att.text, config: cfg, ...(att.items.length ? { attachments: att.items } : {}) });
      runCycle(id);
      return sendJson(res, 202, { ok: true });
    }
    if (parts[3] === 'intervene' && req.method === 'POST') return sendJson(res, 200, interveneMission(id, await readBody(req)));
    if (parts[3] === 'debate' && req.method === 'POST') {
      const body = await readBody(req);
      const state = running.get(id);
      const round = state?.progress?.round || 1;
      const cycle = state?.progress?.cycleStarted || Date.now();
      if (body.id != null && body.status) {
        const updated = updateChat(id, c => setObjectionStatus(c.debate, body.id, body.status, { text: String(body.text || '') }));
        if (!updated) return sendJson(res, 404, { error: i18n.t('server.error.invalidObjection') });
        if (state && body.status === 'abierta') markIntervened(id);
        broadcast({ type: 'debate-updated', chatId: id });
        broadcast({ type: 'chat-updated', chatId: id });
        return sendJson(res, 200, { ok: true, objection: updated });
      }
      const text = String(body.text || '').trim();
      if (!text || text.length <= 3) return sendJson(res, 400, { error: i18n.t('server.error.objectionRequired') });
      const created = updateChat(id, c => addObjections(c.debate, { agentId: 'user', agentName: 'Usuario', round, cycle }, [text]));
      if (state && created.length) markIntervened(id);
      broadcast({ type: 'debate-updated', chatId: id });
      broadcast({ type: 'chat-updated', chatId: id });
      return sendJson(res, 201, { ok: true, objection: created[0] || null });
    }
    if (parts[3] === 'export' && req.method === 'GET') {
      const detail = chatDetail(id);
      const mdText = exportChatMarkdown(detail);
      const filename = `${id}-expediente.md`;
      if (url.searchParams.get('format') === 'json') return sendJson(res, 200, { filename, markdown: mdText });
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      });
      return res.end(mdText);
    }
    if (parts[3] === 'stop' && req.method === 'POST') {
      stopCycle(id);
      return sendJson(res, 200, { ok: true });
    }
    if (parts[3] === 'accept' && req.method === 'POST') {
      if (running.has(id)) return sendJson(res, 409, { error: i18n.t('server.error.cycleBusy') });
      const chat = readChat(id);
      const reason = stopReason(chat, false);
      if (!['meseta', 'retroceso', 'agotado'].includes(reason)) {
        return sendJson(res, 409, { error: i18n.t('server.error.acceptStopped') });
      }
      const porque = i18n.t(`server.accepted.${reason}`);
      addMessage(id, {
        kind: 'system', userAccepted: true, outcome: 'aceptado',
        text: i18n.t('server.accepted.text', { why: porque }),
      });
      broadcast({ type: 'chat-updated', chatId: id });
      generarCierre(id); // el veredicto pasa a «aceptado por ti»
      // No es un progress: el panel trata cualquier progress como ciclo en marcha.
      broadcast({ type: 'cycle-ended', chatId: id, title: chat.title, outcome: 'aceptado', summary: i18n.t('server.accepted.summary') });
      return sendJson(res, 200, { ok: true, outcome: 'aceptado' });
    }
    if (parts[3] === 'cierre' && parts.length === 4 && req.method === 'GET') {
      const cierre = cierreLib.leer(dir);
      if (!cierre) return sendJson(res, 404, { error: i18n.t('server.cierre.missing'), puedeGenerar: !running.has(id) });
      if (url.searchParams.get('format') === 'md') {
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${id}-cierre.md"`, 'Cache-Control': 'no-store' });
        return res.end(cierreLib.aMarkdown(cierre));
      }
      return sendJson(res, 200, cierre);
    }
    if (parts[3] === 'cierre' && parts.length === 4 && req.method === 'POST') {
      // «Generar informe de cierre» para misiones viejas, o rehacerlo. No con el ciclo en marcha: aún no terminó.
      if (running.has(id)) return sendJson(res, 409, { error: i18n.t('server.cierre.running') });
      const cierre = generarCierre(id);
      return cierre ? sendJson(res, 201, cierre) : sendJson(res, 500, { error: i18n.t('server.cierre.failed') });
    }
    if (parts[3] === 'activity' && req.method === 'GET') {
      return sendJson(res, 200, readActivity(id, Math.min(Number(url.searchParams.get('limit')) || 600, 5000)));
    }
    if (parts[3] === 'file' && req.method === 'GET') {
      const found = preview.resolveInside(dir, url.searchParams.get('path') || '');
      if (found.error) return sendJson(res, found.status, { error: found.error });
      if (found.size > 512 * 1024) return sendJson(res, 413, { error: i18n.t('server.error.textTooLarge') });
      const st = fs.statSync(found.file);
      return sendJson(res, 200, { content: fs.readFileSync(found.file, 'utf8'), size: found.size, mtime: st.mtimeMs });
    }
    if (parts[3] === 'open' && req.method === 'POST') {
      // Con "path", abre la carpeta con ese archivo seleccionado (el entregable); sin él, la carpeta del proyecto.
      const body = await readBody(req);
      const found = body.path ? preview.resolveInside(dir, body.path) : null;
      if (found?.error) return sendJson(res, found.status, { error: found.error });
      const args = !found ? [dir] : process.platform === 'win32' ? [`/select,${found.file}`] : process.platform === 'darwin' ? ['-R', found.file] : [path.dirname(found.file)];
      spawn(process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open', args, { detached: true }).on('error', () => {});
      return sendJson(res, 200, { ok: true, path: found?.file || dir });
    }
  }

  // Archivos estáticos
  const isEd = url.pathname === '/editorial' || url.pathname === '/editorial/';
  const file = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : isEd ? 'editorial.html' : path.normalize(decodeURIComponent(url.pathname)));
  if (file.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const type = MIME[path.extname(file).toLowerCase()] || 'text/plain';
    const headers = { 'Content-Type': type.startsWith('image/') && !type.includes('svg') ? type : `${type}; charset=utf-8`, 'Cache-Control': 'no-cache' };
    if (panel && (url.pathname === '/' || url.pathname === '/index.html' || isEd || url.pathname === '/editorial.html')) headers['Set-Cookie'] = acceso.cabecera(panel);
    res.writeHead(200, headers);
    return fs.createReadStream(file).pipe(res);
  }
  sendJson(res, 404, { error: i18n.t('server.error.notFound') });
}

const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (err) {
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message, ...(err.errores ? { errores: err.errores, avisos: err.avisos } : {}), ...(err.codigo ? { codigo: err.codigo, rutas: err.rutas } : {}) });
    else res.end();
  }
});

if (require.main === module) {
  adjuntos.sweep(UPLOADS_DIR);
  // Reloj de la editorial: una mirada por minuto. Tras dormir el PC, la primera mirada lanza la franja perdida, una vez.
  setInterval(() => { relojEditorial().catch(() => {}); }, Number(process.env.OFFICEMATRIX_EDITORIAL_TICK_MS) || 60e3).unref();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`\n  🏢 OfficeMatrix abierta en http://localhost:${PORT}\n`);
    for (const a of agentsWithStatus()) {
      console.log(`  ${a.installed ? '✅' : '❌'} ${a.name.padEnd(8)} ${a.enabled ? '' : '(desactivado)'} streaming: ${a.stream}`);
    }
    console.log('');
    discordBots.arrancarTodas();
  });
}

module.exports = { server, discordBots, runCycle, stopCycle, running, relatores, readChat, PROJECTS_DIR, MEMORY_DIR, syncMemoryIn, syncMemoryOut, relojEditorial, lanzarTanda };
