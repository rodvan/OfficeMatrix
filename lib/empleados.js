// Empleados de una oficina (simulación nivel «contexto», S1 de docs/simulaciones/SIMULACIONES.md).
// Un empleado es un personaje (nombre, puesto, carácter, poderes) con un modelo elegible: { cli, id }. El personaje no
// es el modelo (D6): cambiar de modelo no le cambia la ficha ni la memoria.
// Para no duplicar el motor, cada empleado activo se convierte en un «agente virtual» con la forma de agents.json
// (id = id del empleado, cmd/stream de su CLI, args + modelo + aislamiento). El ciclo, los expedientes, las estaciones
// y la nave trabajan con esos agentes igual que con las cuatro IAs del edificio.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { t, getLang, LANGS } = require('./i18n');
const { norm } = require('../public/i18n');

// Flags vistos en el --help de las CLIs instaladas el 23-oct-2026 (Claude Code 2.1.308, codex-cli 0.163.0, grok 1.0.67,
// agy 1.4.6, gemini 0.65.0). No se inventan: lo que no aparece en la ayuda no se pasa.
const MODEL_FLAG = { claude: '--model', agy: '--model', codex: '-m', grok: '-m', gemini: '-m' };
const ISOLATION = {
  claude: ['--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence'], // sin MCPs, skills ni sesión guardada
  codex: ['--ephemeral', '--ignore-user-config', '--ignore-rules'],                         // `codex exec`: sin config ni reglas del usuario
  grok: ['--no-subagents'],
  agy: ['--disable-slash-commands'],
};
// Reanudar una sesión o abrir carpetas extra rompería la herencia cero. `-c` es «continuar» salvo en Codex (allí es --config).
const FORBIDDEN = ['--continue', '--resume', '-r', '--add-dir', 'resume'];
const FORBIDDEN_NOT_CODEX = ['-c'];

// Modelos conocidos hoy (SIMULACIONES.md §3). Fuera de la lista: aviso «modelo sin verificar», no error.
const KNOWN_MODELS = {
  claude: ['opus', 'sonnet', 'fable', 'haiku'],
  agy: ['gemini-4-argon-low', 'gemini-4-argon-medium', 'gemini-4-argon-high', 'gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high'],
  grok: ['grok-4.7', 'grok-4.7-build-fast', 'grok-4.6', 'grok-4.5'],
  codex: [null],
};

const PODERES = ['moderar', 'aprobar_interno', 'vetar'];
const EMP_KEYS = ['id', 'nombre', 'puesto', 'modelo', 'modelo_rapido', 'degradable', 'reserva', 'objetivo', 'estilo', 'no_hace',
  'poderes', 'activo', 'activo_en_copia_compartida', 'avatar', 'voz'];
const MARCA_KEYS = ['nombre', 'idioma', 'publico', 'voz', 'evitar', 'zona', 'sitio'];
// Personajes con sprites en public/oficina/ (la lista vive en public/escenas.js, que comparten el motor y la ficha).
const AVATARES = require('../public/escenas').PERSONAJES;
const VESTUARIOS = ['gabardina-oficina', 'chaqueta-trabajo', 'blazer-ribete', 'rebeca-corbata', 'camisa-corbata', 'sudadera-blazer'];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;
const FICHA_MAX = 600;

// Qué CLI es (para elegir sus flags): el ejecutable, o "kind" en agents.json si se lanza con un envoltorio.
const kindOf = agentDef => agentDef?.kind || path.basename(String(agentDef?.cmd || '')).toLowerCase().replace(/\.(cmd|exe|ps1|bat)$/, '');

// El cli de un empleado puede nombrar el id de agents.json («gemini») o el ejecutable («agy»).
const resolveCli = (cli, agents) => agents.find(a => a.id === cli) || agents.find(a => kindOf(a) === cli) || null;

// Ficha corta: entra en CADA turno, con redacción fija (mismo prefijo entre turnos, para la caché). Las etiquetas van
// en el idioma de la marca si lo tiene; si no, en el del servidor.
function ficha(emp, lang = getLang()) {
  const lines = [
    `${emp.nombre} · ${emp.puesto}`,
    emp.objetivo && t('emp.ficha.goal', { v: emp.objetivo }, lang),
    emp.estilo && t('emp.ficha.style', { v: emp.estilo }, lang),
    emp.no_hace?.length && t('emp.ficha.doesNot', { v: emp.no_hace.join('; ') }, lang),
    emp.poderes?.length && t('emp.ficha.powers', { v: emp.poderes.join(', ') }, lang),
  ];
  return lines.filter(Boolean).join('\n');
}

function marcaBlock(marca, lang = getLang()) {
  if (!marca || !marca.nombre) return '';
  return [
    t('emp.brand.name', { name: marca.nombre, lang: marca.idioma ? t('emp.brand.lang', { lang: marca.idioma }, lang) : '' }, lang),
    marca.publico && t('emp.brand.audience', { v: marca.publico }, lang),
    marca.voz && t('emp.brand.voice', { v: marca.voz }, lang),
    marca.evitar?.length && t('emp.brand.avoid', { v: marca.evitar.join('; ') }, lang),
  ].filter(Boolean).join('\n');
}

// ---------- Validación ----------

function validar({ marca, empleados } = {}, agents = []) {
  const errores = [], avisos = [];
  const unknown = (obj, keys, where) => {
    for (const k of Object.keys(obj || {})) if (!k.startsWith('_') && !keys.includes(k)) errores.push(t('emp.v.unknownKey', { where, key: k }));
  };
  if (marca != null) {
    if (typeof marca !== 'object' || Array.isArray(marca)) errores.push(t('emp.v.mustObject', { where: 'marca' }));
    else {
      unknown(marca, MARCA_KEYS, 'marca');
      if (marca.evitar != null && !Array.isArray(marca.evitar)) errores.push(t('emp.v.mustList', { where: 'marca.evitar' }));
    }
  }
  if (empleados == null) return { errores, avisos };
  if (!Array.isArray(empleados)) return { errores: [...errores, t('emp.v.mustList', { where: 'empleados' })], avisos };
  const seen = new Set();
  const modelOf = (m, where, e) => {
    if (m == null) return null;
    if (typeof m !== 'object' || !('cli' in m)) { errores.push(t('emp.v.modelShape', { e, where })); return null; }
    unknown(m, ['cli', 'id'], `${e}.${where}`);
    const base = resolveCli(m.cli, agents);
    if (!base) {
      // Un puesto apagado puede reservar una CLI que aún no está (p. ej. el taller local de Ollama).
      (e.activo === false ? avisos : errores).push(t('emp.v.cliMissing', { e, where, cli: m.cli }));
      return null;
    }
    const known = KNOWN_MODELS[kindOf(base)];
    if (!known || !known.includes(m.id ?? null)) avisos.push(t('emp.v.unverified', { e, cli: m.cli, id: m.id ?? t('emp.v.accountModel') }));
    return base;
  };
  empleados.forEach((emp, i) => {
    const e = t('emp.v.employee', { id: emp?.id || i + 1 });
    if (!emp || typeof emp !== 'object') { errores.push(t('emp.v.notObject', { e })); return; }
    unknown(emp, EMP_KEYS, e);
    if (!ID_RE.test(String(emp.id || ''))) errores.push(t('emp.v.badId', { e }));
    else if (seen.has(emp.id)) errores.push(t('emp.v.dupId', { e }));
    seen.add(emp.id);
    if (!String(emp.nombre || '').trim()) errores.push(t('emp.v.noName', { e }));
    if (!String(emp.puesto || '').trim()) errores.push(t('emp.v.noRole', { e }));
    if (!emp.modelo) errores.push(t('emp.v.noModel', { e }));
    const ctx = Object.assign(new String(e), { activo: emp.activo });
    const main = modelOf(emp.modelo, 'modelo', ctx);
    modelOf(emp.modelo_rapido, 'modelo_rapido', ctx);
    const res = modelOf(emp.reserva, 'reserva', ctx);
    if (main && res && main.id === res.id) avisos.push(t('emp.v.sameCli', { e }));
    const poderes = emp.poderes || [];
    if (!Array.isArray(poderes) || poderes.some(p => !PODERES.includes(p))) errores.push(t('emp.v.powers', { e, list: PODERES.join(', ') }));
    if (emp.degradable === true && Array.isArray(poderes) && poderes.includes('vetar')) errores.push(t('emp.v.vetoDegradable', { e }));
    if (emp.degradable === true && !emp.modelo_rapido) errores.push(t('emp.v.degradableNeedsFast', { e }));
    if (emp.degradable === false && emp.modelo_rapido) errores.push(t('emp.v.notDegradableFast', { e }));
    if (emp.no_hace != null && !Array.isArray(emp.no_hace)) errores.push(t('emp.v.noHaceList', { e }));
    // El personaje es opcional (sin él, la oficina reparte la tripulación). Si viene, tiene que existir: si no, la escena
    // pintaría a otro sin avisar.
    if (emp.avatar != null && (typeof emp.avatar !== 'object' || Array.isArray(emp.avatar))) errores.push(t('emp.v.avatarShape', { e }));
    else if (emp.avatar?.base != null && !AVATARES.includes(emp.avatar.base)) errores.push(t('emp.v.unknownCharacter', { e, base: emp.avatar.base, list: AVATARES.join(', ') }));
    if (emp.avatar?.vestuario && !VESTUARIOS.includes(emp.avatar.vestuario)) avisos.push(t('emp.v.unknownOutfit', { e, outfit: emp.avatar.vestuario }));
    // Los tipos inválidos ya tienen diagnóstico; no intentar formatearlos con join().
    if (emp.nombre && emp.puesto && Array.isArray(poderes) &&
        (emp.no_hace == null || Array.isArray(emp.no_hace)) && ficha(emp).length > FICHA_MAX) errores.push(t('emp.v.profileTooLong', { e, max: FICHA_MAX }));
  });
  // Falsa diversidad: dos empleados activos con el mismo cli + modelo se revisan a sí mismos.
  const act = empleados.filter(x => x && x.activo !== false && x.modelo);
  const byModel = new Map();
  for (const x of act) {
    const k = `${resolveCli(x.modelo.cli, agents)?.id || x.modelo.cli}:${x.modelo.id ?? ''}`;
    byModel.set(k, [...(byModel.get(k) || []), x.nombre || x.id]);
  }
  for (const [k, names] of byModel) if (names.length > 1) avisos.push(t('emp.v.falseDiversity', { names: names.join(t('emp.v.and')), model: k.replace(':', ' ') }));
  const byAvatar = new Map();
  for (const x of act) if (AVATARES.includes(x.avatar?.base)) byAvatar.set(x.avatar.base, [...(byAvatar.get(x.avatar.base) || []), x.nombre || x.id]);
  for (const [av, names] of byAvatar) if (names.length > 1) avisos.push(t('emp.v.sameCharacter', { names: names.join(t('emp.v.and')), avatar: av }));
  return { errores, avisos };
}

// Deja solo lo conocido (y las notas `_`) y normaliza tipos. Supone validar() sin errores.
function limpiar(empleados = []) {
  return empleados.map(e => {
    const out = {};
    for (const k of Object.keys(e)) if (EMP_KEYS.includes(k) || k.startsWith('_')) out[k] = e[k];
    out.nombre = String(e.nombre).trim().slice(0, 60);
    out.puesto = String(e.puesto).trim().slice(0, 60);
    out.poderes = e.poderes || [];
    out.no_hace = e.no_hace || [];
    out.activo = e.activo !== false;
    return out;
  });
}

// ---------- Lanzar ----------

// Quita un --model/-m que ya traiga agents.json, para no pasar dos.
function stripModel(args, flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag || args[i] === '--model' || (flag === '-m' && args[i] === '-m')) { i++; continue; }
    out.push(args[i]);
  }
  return out;
}

function argsParaEmpleado(base, modelo) {
  const kind = kindOf(base);
  const flag = MODEL_FLAG[kind];
  let args = [...(base.args || [])];
  const extra = [];
  if (flag && modelo && modelo.id != null) { args = stripModel(args, flag); extra.push(flag, String(modelo.id)); }
  for (const f of ISOLATION[kind] || []) if (!args.includes(f)) extra.push(f);
  // Codex: las opciones van detrás de `exec`. El resto admite flags al final.
  const at = kind === 'codex' && args.indexOf('exec') !== -1 ? args.indexOf('exec') + 1 : args.length;
  args.splice(at, 0, ...extra);
  const bad = args.filter(a => FORBIDDEN.includes(a) || (kind !== 'codex' && FORBIDDEN_NOT_CODEX.includes(a)));
  if (bad.length) throw Object.assign(new Error(t('emp.flagForbidden', { flags: bad.join(', ') })), { status: 400, code: 'FLAG_PROHIBIDO' });
  return args;
}

const modelLabel = (base, m) => `${base.name}${m && m.id != null ? ` ${m.id}` : ''}`;

// Agentes virtuales de una oficina a partir de sus empleados activos (o de una instantánea de la misión).
function agentesDe(oficina, agents) {
  const out = [];
  const lang = norm(oficina?.marca?.idioma) || getLang();
  for (const emp of oficina?.empleados || []) {
    if (emp.activo === false) continue;
    const base = resolveCli(emp.modelo?.cli, agents);
    if (!base || base.enabled === false) continue;
    const make = (def, m) => ({
      id: emp.id, name: emp.nombre, role: emp.puesto, color: def.color, enabled: true,
      cmd: def.cmd, stream: def.stream, args: argsParaEmpleado(def, m), cli: def.id, modelo: { cli: def.id, id: m?.id ?? null },
      modeloLabel: modelLabel(def, m),
    });
    const agent = make(base, emp.modelo);
    const resBase = emp.reserva && resolveCli(emp.reserva.cli, agents);
    if (resBase && resBase.enabled !== false) agent.reserva = make(resBase, emp.reserva);
    agent.empleado = { ficha: ficha(emp, lang), fichas: Object.fromEntries(LANGS.map(l => [l, ficha(emp, l)])), poderes: emp.poderes || [], avatar: emp.avatar || null };
    agent.avatar = emp.avatar?.base || null;
    agent.oficina = { id: oficina.id, nombre: oficina.nombre, marca: marcaBlock(oficina.marca, lang),
      marcas: Object.fromEntries(LANGS.map(l => [l, marcaBlock(oficina.marca, l)])) };
    out.push(agent);
  }
  return out;
}

// ---------- Entorno limpio (P-ENTORNO) ----------
// Lista blanca: nada de CLAUDE_CODE_*, *_API_KEY, tokens ni secretos del servidor. HOME/USERPROFILE siguen siendo los
// tuyos: las CLIs encuentran su sesión de suscripción como siempre (los hogares propios por CLI van apagados, §1.5).
const PASAN = ['SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'PATHEXT', 'PATH', 'Path', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'HOMEDRIVE',
  'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles',
  'SystemDrive', 'USERNAME', 'USERDOMAIN', 'COMPUTERNAME', 'OS', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'LANG', 'LC_ALL',
  'TERM', 'SHELL', 'USER', 'LOGNAME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'];
const SECRETO = /^CLAUDE_CODE_|^CLAUDECODE$|API_KEY|TOKEN|SECRET|PASSWORD|^OM_/i;

function envParaTurno(oficinaId, base = process.env, extra = {}) {
  const env = {};
  for (const k of PASAN) if (base[k] != null && !SECRETO.test(k)) env[k] = base[k];
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'; // la memoria propia de Claude no mezcla oficinas
  env.GROK_MEMORY = '0';
  env.OFFICEMATRIX_OFICINA = oficinaId;      // solo para logs
  return { ...env, ...extra };
}

// ---------- Instrucciones en carpetas padre (P-PADRE) ----------
// Claude, Codex y Grok leen CLAUDE.md / AGENTS.md de las carpetas padre: una oficina no puede heredar instrucciones
// de fuera. Se mira desde la carpeta de la misión hasta la raíz del disco. `~/.grok` es el hogar global de Grok
// (config y sesión), no instrucciones de una carpeta: en tu perfil no cuenta; en cualquier otro padre, sí.
const PADRE = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'AGENTS.override.md', 'GEMINI.md'];
function instruccionesEnPadres(projectDir, { home = os.homedir() } = {}) {
  const found = [];
  let dir = path.dirname(path.resolve(projectDir));
  const homeN = path.resolve(home).toLowerCase();
  for (;;) {
    for (const f of PADRE) if (fs.existsSync(path.join(dir, f))) found.push(path.join(dir, f));
    if (fs.existsSync(path.join(dir, '.grok')) && path.resolve(dir).toLowerCase() !== homeN) found.push(path.join(dir, '.grok'));
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return found;
}

// ---------- Plantilla «Redacción de contenido» ----------
// El ejemplo de Acme Ciencia (docs/simulaciones/simulacion.ejemplo.json) sin rutinas ni conexiones: eso es S2+.
function plantillaRedaccion() {
  const file = path.join(__dirname, '..', 'docs', 'simulaciones', 'simulacion.ejemplo.json');
  const def = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    id: 'redaccion', nombre: t('emp.tpl.name'),
    descripcion: t('emp.tpl.desc'),
    oficina: { nombre: def.nombre, descripcion: t('emp.tpl.officeDesc', { brand: def.marca.nombre }), marca: def.marca, empleados: def.empleados, escena: def.escena },
  };
}

module.exports = {
  validar, limpiar, agentesDe, argsParaEmpleado, envParaTurno, instruccionesEnPadres, ficha, marcaBlock, resolveCli, kindOf,
  plantillaRedaccion, MODEL_FLAG, ISOLATION, KNOWN_MODELS, PODERES, AVATARES, VESTUARIOS, FORBIDDEN,
};
