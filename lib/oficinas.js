// Oficinas: simulaciones aisladas dentro de OfficeMatrix.
// El "edificio" es lo de siempre (proyectos/ y memoria/ en la raíz de datos): encargos generales y la mejora de la
// propia app. Cada oficina vive en oficinas/<id>/ con su oficina.json, sus proyectos/ y su memoria/. Una misión de
// oficina es una misión normal; lo que cambia es dónde vive, qué cerebro lee y escribe y qué IAs pueden trabajar en ella.
// Aislamiento: una oficina nunca lee el cerebro del edificio ni el de otra oficina (ni en el brief ni en la búsqueda).
// Las llaves de agente (por ejemplo, para tu propio agente externo) dan acceso SOLO a su oficina.
// Una oficina puede tener marca y empleados (S1 de las simulaciones): ver lib/empleados.js y docs/DECISIONES.md D31.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const empleadosLib = require('./empleados');
const { t } = require('./i18n');

const EDIFICIO = 'edificio';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const FILE = 'oficina.json';

const slug = text => String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const hashKey = key => crypto.createHash('sha256').update(String(key)).digest('hex');

function createRegistry(DATA) {
  const OFFICES_DIR = path.join(DATA, 'oficinas');
  const chatIndex = new Map(); // chatId -> officeId (caché; se rehace si no encuentra)

  const dirs = id => (id === EDIFICIO
    ? { root: DATA, proyectos: path.join(DATA, 'proyectos'), memoria: path.join(DATA, 'memoria') }
    : { root: path.join(OFFICES_DIR, id), proyectos: path.join(OFFICES_DIR, id, 'proyectos'), memoria: path.join(OFFICES_DIR, id, 'memoria') });

  const edificio = () => ({
    id: EDIFICIO, nombre: 'Edificio', descripcion: t('office.buildingDesc'), equipo: [], color: '#39e58c', llaves: [],
  });

  function read(id) {
    if (id === EDIFICIO) return edificio();
    if (!ID_RE.test(String(id))) return null;
    try {
      const o = JSON.parse(fs.readFileSync(path.join(OFFICES_DIR, id, FILE), 'utf8'));
      return { equipo: [], llaves: [], ...o, id };
    } catch { return null; }
  }

  function write(o) {
    const file = path.join(OFFICES_DIR, o.id, FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(o, null, 2));
    fs.renameSync(file + '.tmp', file);
  }

  function list() {
    const out = [edificio()];
    if (fs.existsSync(OFFICES_DIR)) {
      for (const d of fs.readdirSync(OFFICES_DIR, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const o = read(d.name);
        if (o) out.push(o);
      }
    }
    return out;
  }

  // Lo público de una oficina (sin hashes de llaves).
  const pub = o => o && ({ ...o, llaves: (o.llaves || []).map(k => ({ nombre: k.nombre, creada: k.creada, pista: k.pista })) });

  // `agents`: los de agents.json (objetos) o, como antes, solo sus ids.
  function clean(input, agents, prev = {}) {
    const agentIds = agents.map(a => (typeof a === 'string' ? a : a.id));
    const agentObjs = agents.filter(a => typeof a === 'object');
    const nombre = String(input.nombre ?? prev.nombre ?? '').trim().slice(0, 60);
    if (!nombre) throw Object.assign(new Error(t('office.err.nameRequired')), { status: 400 });
    const equipo = Array.isArray(input.equipo) ? [...new Set(input.equipo.filter(id => agentIds.includes(id)))] : prev.equipo || [];
    const color = /^#[0-9a-f]{6}$/i.test(input.color || '') ? input.color : prev.color || '#4fd1c5';
    const out = { nombre, descripcion: String(input.descripcion ?? prev.descripcion ?? '').trim().slice(0, 600), equipo, color };
    // Empleados y marca (S1): opcionales. Una oficina sin empleados sigue funcionando con su «equipo» de IAs.
    if ('empleados' in input || 'marca' in input) {
      const { errores, avisos } = empleadosLib.validar({ marca: input.marca, empleados: input.empleados }, agentObjs);
      if (errores.length) throw Object.assign(new Error(t('office.err.definition', { errors: errores.join(' · ') })), { status: 400, errores, avisos });
    }
    if ('empleados' in input) out.empleados = input.empleados ? empleadosLib.limpiar(input.empleados) : [];
    else if (prev.empleados) out.empleados = prev.empleados;
    if ('marca' in input) out.marca = input.marca || null;
    else if (prev.marca) out.marca = prev.marca;
    if (input.escena && typeof input.escena === 'object') out.escena = { plantilla: String(input.escena.plantilla || 'redaccion-v1'), puestos: input.escena.puestos || {} };
    else if (prev.escena) out.escena = prev.escena;
    return out;
  }

  function create(input, agentIds) {
    const data = clean(input, agentIds);
    const base = slug(input.id || data.nombre) || 'oficina';
    if (base === EDIFICIO) throw Object.assign(new Error(t('office.err.reserved')), { status: 400 });
    let id = base;
    for (let i = 2; fs.existsSync(path.join(OFFICES_DIR, id)); i++) id = `${base}-${i}`;
    const o = { id, ...data, creada: new Date().toISOString(), llaves: [] };
    write(o);
    fs.mkdirSync(dirs(id).proyectos, { recursive: true });
    fs.mkdirSync(dirs(id).memoria, { recursive: true });
    return o;
  }

  function update(id, input, agentIds) {
    if (id === EDIFICIO) throw Object.assign(new Error(t('office.err.buildingReadOnly')), { status: 400 });
    const prev = read(id);
    if (!prev) throw Object.assign(new Error(t('office.err.missing')), { status: 404 });
    const o = { ...prev, ...clean(input, agentIds, prev) };
    // Cambiar de modelo no borra carácter ni memoria (D6), pero queda escrito en la bitácora de la oficina.
    const before = new Map((prev.empleados || []).map(e => [e.id, e]));
    for (const e of o.empleados || []) {
      const p = before.get(e.id);
      const m = x => (x ? `${x.cli} ${x.id ?? t('office.accountModel')}` : '—');
      if (p && m(p.modelo) !== m(e.modelo)) bitacora(id, t('office.log.modelChange', { name: e.nombre, from: m(p.modelo), to: m(e.modelo) }));
    }
    write(o);
    return o;
  }

  // Bitácora de la oficina: una línea por hecho, la escribe el servidor (§2.1). Se lee en la ficha de la oficina.
  function bitacora(id, linea) {
    const file = path.join(dirs(id).root, 'bitacora.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `- ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${String(linea).replace(/\s+/g, ' ').slice(0, 300)}\n`);
  }
  const leerBitacora = (id, n = 30) => {
    try { return fs.readFileSync(path.join(dirs(id).root, 'bitacora.md'), 'utf8').split('\n').filter(Boolean).slice(-n); } catch { return []; }
  };

  // Llave de agente: se muestra UNA vez; se guarda solo su hash.
  function addKey(id, nombre) {
    const o = read(id);
    if (!o || id === EDIFICIO) throw Object.assign(new Error(t('office.err.keysPerOffice')), { status: 400 });
    const name = String(nombre || '').trim().slice(0, 40) || 'agente';
    const key = `om_${id}_${crypto.randomBytes(18).toString('base64url')}`;
    o.llaves = [...(o.llaves || []).filter(k => k.nombre !== name), { nombre: name, hash: hashKey(key), pista: key.slice(-4), creada: new Date().toISOString() }];
    write(o);
    return { nombre: name, llave: key };
  }

  function removeKey(id, nombre) {
    const o = read(id);
    if (!o) throw Object.assign(new Error(t('office.err.missing')), { status: 404 });
    o.llaves = (o.llaves || []).filter(k => k.nombre !== nombre);
    write(o);
  }

  // Devuelve { oficina, nombre } si la llave vale, o null.
  function checkKey(key) {
    const m = /^om_([a-z0-9-]+)_[A-Za-z0-9_-]+$/.exec(String(key || ''));
    if (!m) return null;
    const o = read(m[1]);
    const h = Buffer.from(hashKey(key));
    const k = o?.llaves?.find(x => x.hash.length === h.length && crypto.timingSafeEqual(Buffer.from(x.hash), h));
    return k ? { oficina: o.id, nombre: k.nombre } : null;
  }

  // ---------- Misiones ----------

  const hasChat = (officeId, chatId) => fs.existsSync(path.join(dirs(officeId).proyectos, chatId, '.office', 'chat.json'));

  function officeOf(chatId) {
    const id = path.basename(String(chatId));
    const cached = chatIndex.get(id);
    if (cached && hasChat(cached, id)) return cached;
    for (const o of list()) {
      if (hasChat(o.id, id)) { chatIndex.set(id, o.id); return o.id; }
    }
    return null;
  }

  // Carpeta de una misión, esté en la oficina que esté (null si no existe).
  function chatPath(chatId) {
    const office = officeOf(chatId);
    return office ? path.join(dirs(office).proyectos, path.basename(String(chatId))) : null;
  }

  // Un id de misión libre en TODAS las oficinas (los ids son únicos en el edificio entero).
  function freeChatId(base) {
    let id = base;
    const taken = x => list().some(o => fs.existsSync(path.join(dirs(o.id).proyectos, x)));
    for (let i = 2; taken(id); i++) id = `${base}-${i}`;
    return id;
  }

  const remember = (chatId, officeId) => chatIndex.set(chatId, officeId);

  return { EDIFICIO, dirs, read, list, pub, create, update, addKey, removeKey, checkKey, officeOf, chatPath, freeChatId, remember, bitacora, leerBitacora };
}

module.exports = { createRegistry, EDIFICIO, slug };
