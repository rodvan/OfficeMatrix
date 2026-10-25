// Editorial continua (docs/BRIEF-EDITORIAL.md, D66-ED a D70-ED): la oficina propone, el humano decide, ViralHunt publica.
// Todo vive en la oficina:
//   oficinas/<id>/editorial.json                     la regla (marca, nichos, horario, equipo, destino, reglas de contenido)
//   oficinas/<id>/editorial/estado.json              la última franja lanzada y las tandas abiertas (lo escribe el servidor)
//   oficinas/<id>/editorial/propuestas/<fecha>-<n>/  propuesta.json + imagen(es) + investigacion.md
//   oficinas/<id>/editorial/decisiones.jsonl         las últimas decisiones del usuario (acotado a MAX_DECISIONES)
//   oficinas/<id>/memoria/gusto-editorial.md         el resumen del gusto, reescrito en cada decisión; entra en el brief
// Las rutinas (S2) no existen aparte: una tanda es una misión normal de la oficina con chat.editorial = { tipo, ... }.
const fs = require('fs');
const path = require('path');
const memory = require('./memory');
const { t, getLang, detectLang } = require('./i18n');

const REDES = ['instagram', 'facebook', 'x', 'tiktok', 'linkedin', 'threads', 'bluesky', 'youtube', 'pinterest', 'telegram'];
const FUENTES = ['x', 'tiktok', 'instagram', 'facebook', 'reddit', 'pinterest', 'bluesky', 'mastodon', 'tumblr', 'hackernews', 'rss', 'douyin'];
const CASILLAS = ['imagen', 'texto', 'hook', 'tema', 'hora'];
const ESTADOS = ['pendiente', 'en-cambios', 'aprobada', 'rechazada', 'descartada'];
const IMG_RE = /\.(png|jpe?g|webp)$/i;
const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_DECISIONES = 200;
const GUSTO = 'gusto-editorial.md';
const LIMITES = { x: 280, bluesky: 300, threads: 500 };

const httpErr = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const list = (v, max, n = 12) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map(x => str(x, max)).filter(Boolean).slice(0, n);

// ---------- La regla ----------

const DEFAULT = {
  activa: false,
  marca: { nombre: '', tono: '' },
  idiomas: ['es'],
  nichos: [],
  fuentes: ['x', 'tiktok', 'reddit'],
  redes: ['instagram', 'x'],
  propuestasPorTanda: 5,
  zona: 'America/Mexico_City',
  horas: ['09:00', '17:00'],
  modo: 'consejo',
  rondas: 2,
  // Getter: los roles por defecto salen en el idioma del servidor en el momento de crear la regla.
  get equipo() { return ['grok', 'codex', 'claude', 'gemini'].map(id => ({ id, rol: t(`ed.defaultRole.${id}`) })); },
  destino: 'borrador',
  viralhunt: { proyecto: '', proyectoId: null, cuentas: [] },
  reglas: { noPublicar: [], fuenteObligatoria: true, noCopiar: true },
};

const zonaValida = z => { try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch { return false; } };

// Valida y completa lo que manda la UI. Los errores se dicen todos juntos.
function normalizarRegla(input = {}, prev = DEFAULT) {
  const base = { ...DEFAULT, ...prev };
  const errores = [];
  const out = { ...base };
  if ('activa' in input) out.activa = input.activa === true;
  if (input.marca) out.marca = { nombre: str(input.marca.nombre, 60), tono: str(input.marca.tono, 400) };
  if ('idiomas' in input) out.idiomas = list(input.idiomas, 8, 4).map(x => x.toLowerCase());
  if ('nichos' in input) out.nichos = list(input.nichos, 60, 8);
  if ('fuentes' in input) out.fuentes = list(input.fuentes, 20).map(x => x.toLowerCase()).filter((x, i, a) => a.indexOf(x) === i);
  if ('redes' in input) out.redes = list(input.redes, 20).map(x => x.toLowerCase()).filter((x, i, a) => a.indexOf(x) === i);
  if ('propuestasPorTanda' in input) out.propuestasPorTanda = Math.round(Number(input.propuestasPorTanda));
  if ('zona' in input) out.zona = str(input.zona, 60);
  if ('horas' in input) out.horas = list(input.horas, 5, 4);
  if ('modo' in input) out.modo = input.modo;
  if ('equipo' in input) {
    out.equipo = (Array.isArray(input.equipo) ? input.equipo : []).map(e => (typeof e === 'string' ? { id: e, rol: '' } : { id: str(e.id, 40), rol: str(e.rol, 80) }))
      .filter(e => e.id).filter((e, i, a) => a.findIndex(x => x.id === e.id) === i).slice(0, 6);
  }
  if ('destino' in input) out.destino = input.destino;
  if (input.viralhunt) {
    const id = Number(input.viralhunt.proyectoId);
    out.viralhunt = {
      proyecto: str(input.viralhunt.proyecto, 80),
      proyectoId: Number.isInteger(id) && id > 0 ? id : null,
      cuentas: (Array.isArray(input.viralhunt.cuentas) ? input.viralhunt.cuentas : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 20),
    };
  }
  if (input.reglas) {
    out.reglas = {
      noPublicar: list(input.reglas.noPublicar, 120, 12),
      fuenteObligatoria: input.reglas.fuenteObligatoria !== false,
      noCopiar: true, // no se puede apagar: el brief lo exige
    };
  }
  out.rondas = 2; // dos ciclos por tanda: el pedido del usuario es explícito

  if (!out.idiomas.length) errores.push(t('ed.errLanguages'));
  if (out.fuentes.some(f => !FUENTES.includes(f))) errores.push(t('ed.errSources', { sources: FUENTES.join(', ') }));
  if (!out.redes.length || out.redes.some(r => !REDES.includes(r))) errores.push(t('ed.errNetworks', { networks: REDES.join(', ') }));
  if (!(out.propuestasPorTanda >= 1 && out.propuestasPorTanda <= 10)) errores.push(t('ed.errProposals'));
  if (!zonaValida(out.zona)) errores.push(t('ed.errTimezone', { zone: out.zona }));
  if (out.horas.length < 1 || out.horas.length > 4 || out.horas.some(h => !HORA_RE.test(h))) errores.push(t('ed.errHours'));
  out.horas = [...new Set(out.horas)].sort();
  if (!['consejo', 'relevo'].includes(out.modo)) errores.push(t('ed.errMode'));
  if (!['borrador', 'agendar'].includes(out.destino)) errores.push(t('ed.errTarget'));
  if (!out.equipo.length) errores.push(t('ed.errTeam'));
  if (errores.length) throw httpErr(400, t('ed.errRule', { errors: errores.join(' · ') }), { errores });
  return out;
}

// ---------- Horario (función pura: se prueba con un reloj falso) ----------

// Desfase de una zona en un instante, en ms (hora local - UTC).
function desfase(zona, ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}
const diaLocal = (zona, ms) => new Date(ms + desfase(zona, ms)).toISOString().slice(0, 10);
// El instante UTC de «dia HH:MM» en la zona (dos pasadas: cubre el cambio de horario).
function instante(zona, dia, hora) {
  const [y, m, d] = dia.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - desfase(zona, guess);
  t = guess - desfase(zona, t);
  return t;
}
const sumarDia = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

// Las franjas de ayer, hoy y mañana en la zona de la marca, en orden.
function franjas(regla, ahora) {
  const hoy = diaLocal(regla.zona, ahora);
  return [-1, 0, 1].flatMap(n => regla.horas.map(h => {
    const dia = sumarDia(hoy, n);
    return { clave: `${dia}T${h}`, dia, hora: h, at: instante(regla.zona, dia, h) };
  })).sort((a, b) => a.at - b.at);
}

// ¿Toca lanzar una tanda? Solo la franja más reciente que ya pasó, una vez, y si no hay otra abierta.
// Tras dormir el PC varias franjas, se lanza la última, una sola vez: nunca en cascada.
function tandaDebida({ regla, estado = {}, ahora, abierta = false }) {
  if (!regla?.activa) return { lanzar: false, motivo: 'inactiva' };
  const pasadas = franjas(regla, ahora).filter(f => f.at <= ahora);
  const ultima = pasadas[pasadas.length - 1];
  if (!ultima) return { lanzar: false, motivo: 'sin-franja' };
  if (estado.ultimaFranja && ultima.clave <= estado.ultimaFranja) return { lanzar: false, motivo: 'ya-lanzada', franja: ultima };
  if (estado.activadaEn && ultima.at < Date.parse(estado.activadaEn)) return { lanzar: false, motivo: 'antes-de-activar', franja: ultima };
  if (abierta) return { lanzar: false, motivo: 'anterior-abierta', franja: ultima };
  return { lanzar: true, franja: ultima, atrasada: ahora - ultima.at > 15 * 60e3 };
}

const proximaFranja = (regla, ahora) => (regla?.activa ? franjas(regla, ahora).find(f => f.at > ahora) || null : null);

// ---------- La propuesta que entregan los agentes ----------

const palabras = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ#@]+/g, ' ').trim().split(/\s+/).filter(Boolean);

// ¿El copy copia la fuente? Igual palabra por palabra, o con un tramo de 12 palabras seguidas idéntico.
function copiaLiteral(copy, fuente, tramo = 12) {
  const a = palabras(copy), b = palabras(fuente);
  if (!a.length || !b.length) return false;
  if (a.join(' ') === b.join(' ')) return true;
  if (b.length < tramo) return false;
  const grams = new Set();
  for (let i = 0; i + tramo <= b.length; i++) grams.add(b.slice(i, i + tramo).join(' '));
  for (let i = 0; i + tramo <= a.length; i++) if (grams.has(a.slice(i, i + tramo).join(' '))) return true;
  return false;
}

// Normaliza el propuesta.json de un agente. Devuelve { propuesta, avisos, errores }.
// `otras`: textos de la investigación de ViralHunt de la misión; el copy tampoco puede copiarlos aunque el agente
// no haya dejado `fuente.texto`.
function normalizarPropuesta(raw, regla, imagenes = [], otras = []) {
  const errores = [], avisos = [];
  const p = raw && typeof raw === 'object' ? raw : {};
  const copyIn = p.copy && typeof p.copy === 'object' ? p.copy : {};
  const copy = {};
  for (const red of regla.redes) if (copyIn[red]) copy[red] = str(copyIn[red], 3000);
  const fuente = p.fuente && typeof p.fuente === 'object' ? {
    nombre: str(p.fuente.nombre || p.fuente.red, 80), url: /^https?:\/\/\S+$/i.test(p.fuente.url || '') ? str(p.fuente.url, 500) : null,
    metricas: p.fuente.metricas && typeof p.fuente.metricas === 'object' ? p.fuente.metricas : null, texto: str(p.fuente.texto, 2000),
  } : null;
  const out = {
    tema: str(p.tema, 160), porQue: str(p.porQue ?? p.por_que, 600), hook: str(p.hook, 200), copy,
    hashtags: list(p.hashtags, 40, 12).map(h => h.replace(/^#/, '')), hora: str(p.hora, 40) || null,
    idiomas: list(p.idiomas || regla.idiomas, 8, 4), tipo: ['fact', 'meme', 'quote', 'opinion', 'promo'].includes(p.tipo) ? p.tipo : null,
    fuente, imagenes,
  };
  if (!out.tema) errores.push(t('ed.errMissingTopic'));
  if (!out.hook) errores.push(t('ed.errMissingHook'));
  const faltan = regla.redes.filter(r => !copy[r]);
  if (faltan.length === regla.redes.length) errores.push(t('ed.errMissingCopy'));
  else if (faltan.length) avisos.push(t('ed.warnNoCopy', { networks: faltan.join(', ') }));
  for (const [red, lim] of Object.entries(LIMITES)) if (copy[red] && copy[red].length > lim) avisos.push(t('ed.warnCopyTooLong', { network: red, limit: lim, len: copy[red].length }));
  if (regla.reglas.fuenteObligatoria && !fuente?.url) errores.push(t('ed.errSourceUrlRequired'));
  if (!imagenes.length) avisos.push(t('ed.warnNoImage'));
  if (out.hora && Number.isNaN(Date.parse(out.hora))) { avisos.push(t('ed.warnInvalidHour', { hour: out.hora })); out.hora = null; }
  const fuentes = [fuente?.texto, ...otras].filter(Boolean);
  if (Object.values(copy).some(c => fuentes.some(f => copiaLiteral(c, f)))) errores.push(t('ed.errVerbatimCopy'));
  return { propuesta: out, avisos, errores };
}

// ---------- El texto de la misión (el brief de la tanda) ----------

// Los briefs van en el idioma de la marca (su tono, nichos y vetos), o en el del servidor si no se nota.
const briefLang = regla => detectLang([regla.marca?.tono, ...(regla.nichos || []), ...(regla.reglas?.noPublicar || [])].filter(Boolean).join(' '), getLang());

function briefTanda({ regla, oficina, franja, gusto, investigacion }) {
  const n = regla.propuestasPorTanda;
  const L = briefLang(regla);
  const tr = (k, v) => t(k, v, L);
  const equipo = regla.equipo.map(e => `- ${e.id}: ${e.rol || tr('ed.brief.roleFallback')}`).join('\n');
  const ejemplo = JSON.stringify({
    tema: tr('ed.brief.exTopic'), porQue: tr('ed.brief.exWhy'), hook: tr('ed.brief.exHook'),
    copy: Object.fromEntries(regla.redes.map(r => [r, LIMITES[r] ? tr('ed.brief.exCopyMax', { network: r, max: LIMITES[r] }) : tr('ed.brief.exCopy', { network: r })])),
    hashtags: tr('ed.brief.exTags').split(', '), hora: '2026-10-25T15:30:00Z', idiomas: regla.idiomas, tipo: 'fact',
    fuente: { nombre: tr('ed.brief.exSourceName'), url: 'https://…', metricas: { likes: 0, views: 0 }, texto: tr('ed.brief.exSourceText') },
  }, null, 2);
  return [
    tr('ed.brief.title', { office: oficina.nombre, slot: franja ? ` (${franja.dia} ${franja.hora}, ${regla.zona})` : '', n }),
    '',
    tr('ed.brief.brand'),
    tr('ed.brief.name', { name: regla.marca.nombre || oficina.nombre }),
    regla.marca.tono ? tr('ed.brief.tone', { tone: regla.marca.tono }) : null,
    tr('ed.brief.languages', { languages: regla.idiomas.join(', ') }),
    tr('ed.brief.networks', { networks: regla.redes.join(', ') }),
    regla.nichos.length ? tr('ed.brief.niches', { niches: regla.nichos.join(', ') }) : null,
    '',
    tr('ed.brief.team'),
    equipo,
    '',
    tr('ed.brief.research'),
    investigacion
      ? tr('ed.brief.researchVh', { trends: investigacion.tendencias.length, best: investigacion.mejorHora.length, errors: investigacion.errores.length ? tr('ed.brief.researchErrors', { n: investigacion.errores.length }) : '' })
      : tr('ed.brief.researchNone'),
    '',
    tr('ed.brief.deliverable'),
    tr('ed.brief.folders', { n }),
    tr('ed.brief.shape'),
    '```json', ejemplo, '```',
    tr('ed.brief.image'),
    tr('ed.brief.researchFile'),
    '',
    tr('ed.brief.rules'),
    tr('ed.brief.noCopy'),
    regla.reglas.fuenteObligatoria ? tr('ed.brief.sourceRequired') : null,
    ...regla.reglas.noPublicar.map(x => tr('ed.brief.noPublish', { item: x })),
    tr('ed.brief.hour'),
    tr('ed.brief.noCall'),
    '',
    tr('ed.brief.taste'),
    gusto ? gusto.replace(/^# .*\n+/, '') : tr('ed.brief.tasteNone'),
  ].filter(x => x !== null).join('\n');
}

function briefCambios({ regla, oficina, propuesta, nota, casillas }) {
  const L = briefLang(regla);
  const tr = (k, v) => t(k, v, L);
  return [
    tr('ed.brief.changesTitle', { id: propuesta.id, office: oficina.nombre, hook: propuesta.hook }),
    '',
    tr('ed.brief.directive'),
    nota ? `> ${nota.replace(/\n/g, '\n> ')}` : tr('ed.brief.noNote'),
    casillas.length ? tr('ed.brief.change', { fields: casillas.join(', ') }) : null,
    '',
    tr('ed.brief.changesWhere'),
    tr('ed.brief.changesSame'),
    tr('ed.brief.changesNoCopy'),
    tr('ed.brief.changesTargets', { networks: regla.redes.join(', '), languages: regla.idiomas.join(', ') }),
    tr('ed.brief.changesNoCall'),
  ].filter(x => x !== null).join('\n');
}

// ---------- El gusto: un resumen compacto que se reescribe ----------

function resumenGusto(decisiones, ahora = Date.now(), lang = getLang()) {
  const tr = (k, v) => t(k, v, lang);
  const d = decisiones.slice(-MAX_DECISIONES);
  const ap = d.filter(x => x.accion === 'aprobar'), ca = d.filter(x => x.accion === 'cambios'), re = d.filter(x => x.accion === 'rechazar');
  const cuenta = {};
  for (const x of ca) for (const c of x.casillas || []) cuenta[c] = (cuenta[c] || 0) + 1;
  const ultimas = (arr, n, f) => arr.slice(-n).reverse().map(f);
  const temasEvitar = [...new Set(re.filter(x => x.tema).slice(-6).map(x => x.tema))];
  return [
    tr('ed.taste.title'),
    '',
    tr('ed.taste.summary', { total: d.length, approved: ap.length, changes: ca.length, rejected: re.length, last: new Date(d[d.length - 1]?.ts || ahora).toISOString().slice(0, 16).replace('T', ' ') }),
    '',
    tr('ed.taste.liked'),
    ap.length ? ultimas(ap, 6, x => `- «${x.hook}»${x.tema ? ` · ${x.tema}` : ''}${x.nota ? tr('ed.taste.note', { note: x.nota }) : ''}`).join('\n') : tr('ed.taste.none'),
    '',
    tr('ed.taste.changed'),
    Object.keys(cuenta).length ? tr('ed.taste.perAspect', { list: Object.entries(cuenta).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') }) : tr('ed.taste.nothing'),
    ...ultimas(ca.filter(x => x.nota), 5, x => `- «${x.hook}»: ${x.nota}`),
    '',
    tr('ed.taste.rejected'),
    re.length ? ultimas(re, 6, x => `- «${x.hook}»: ${x.nota || tr('ed.taste.noReason')}`).join('\n') : tr('ed.taste.none'),
    '',
    tr('ed.taste.avoid'),
    temasEvitar.length ? temasEvitar.map(x => `- ${x}`).join('\n') : tr('ed.taste.none'),
    '',
  ].join('\n');
}

// ---------- Almacén de la oficina ----------

function createEditorial(oficinas) {
  const root = office => oficinas.dirs(office).root;
  const reglaFile = office => path.join(root(office), 'editorial.json');
  const dir = office => path.join(root(office), 'editorial');
  const propDir = office => path.join(dir(office), 'propuestas');
  const readJson = (file, fb) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fb; } };
  const writeJson = (file, v) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(v, null, 2));
    fs.renameSync(file + '.tmp', file);
  };
  const deOficina = office => {
    if (!oficinas.read(office) || office === oficinas.EDIFICIO) throw httpErr(400, t('ed.errPerOffice'));
  };

  const regla = office => {
    const r = readJson(reglaFile(office), null);
    return r ? normalizarReglaSegura(r) : null;
  };
  const normalizarReglaSegura = r => { try { return normalizarRegla(r, DEFAULT); } catch { return { ...DEFAULT, ...r, activa: false }; } };

  function guardarRegla(office, input) {
    deOficina(office);
    const prev = regla(office) || DEFAULT;
    const r = normalizarRegla(input, prev);
    writeJson(reglaFile(office), r);
    // Al activar se apunta la hora: una franja anterior no se lanza «de golpe» al encender.
    const st = estado(office);
    if (r.activa && !prev.activa) guardarEstado(office, { ...st, activadaEn: new Date().toISOString() });
    return r;
  }

  const estado = office => readJson(path.join(dir(office), 'estado.json'), { ultimaFranja: null, activadaEn: null, tandas: [] });
  const guardarEstado = (office, st) => writeJson(path.join(dir(office), 'estado.json'), { ...st, tandas: (st.tandas || []).slice(-40) });

  function apuntarTanda(office, { franja, chatId, manual }) {
    const st = estado(office);
    st.tandas = [...(st.tandas || []), { chatId, franja: franja?.clave || null, manual: !!manual, inicio: new Date().toISOString(), fin: null, propuestas: 0 }];
    if (franja && (!st.ultimaFranja || franja.clave > st.ultimaFranja)) st.ultimaFranja = franja.clave;
    guardarEstado(office, st);
  }
  function saltarFranja(office, franja) {
    const st = estado(office);
    if (!st.ultimaFranja || franja.clave > st.ultimaFranja) st.ultimaFranja = franja.clave;
    guardarEstado(office, st);
  }

  // ---------- Propuestas ----------
  const pidOk = pid => /^\d{4}-\d{2}-\d{2}-\d{1,3}$/.test(String(pid));
  const leer = (office, pid) => (pidOk(pid) ? readJson(path.join(propDir(office), pid, 'propuesta.json'), null) : null);
  const escribir = (office, p) => writeJson(path.join(propDir(office), p.id, 'propuesta.json'), p);

  function propuestas(office) {
    const base = propDir(office);
    if (!fs.existsSync(base)) return [];
    return fs.readdirSync(base).filter(pidOk).map(pid => leer(office, pid)).filter(Boolean)
      .sort((a, b) => (b.creada || '').localeCompare(a.creada || '') || b.id.localeCompare(a.id));
  }

  const nextId = (office, dia) => {
    const used = fs.existsSync(propDir(office)) ? fs.readdirSync(propDir(office)).filter(x => x.startsWith(`${dia}-`)).map(x => Number(x.slice(11))) : [];
    return `${dia}-${(used.length ? Math.max(...used) : 0) + 1}`;
  };

  // Copia lo que dejaron los agentes en <misión>/propuestas/<n>/ a la bandeja. Devuelve { creadas, descartadas }.
  function cosechar(office, projectDir, { chatId, tanda = null, reemplaza = null } = {}) {
    const r = regla(office) || DEFAULT;
    const src = path.join(projectDir, 'propuestas');
    const out = { creadas: [], descartadas: [] };
    if (!fs.existsSync(src)) return out;
    const carpetas = fs.readdirSync(src, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
      .sort((a, b) => (Number(a) || 0) - (Number(b) || 0) || a.localeCompare(b)).slice(0, reemplaza ? 1 : r.propuestasPorTanda);
    const dia = new Date().toISOString().slice(0, 10);
    const inv = readJson(path.join(projectDir, 'investigacion', 'viralhunt.json'), null);
    const otras = (inv?.tendencias || []).flatMap(t => (t.posts || []).map(x => x.titulo)).filter(Boolean);
    for (const name of carpetas) {
      const from = path.join(src, name);
      const raw = readJson(path.join(from, 'propuesta.json'), null);
      if (!raw) { out.descartadas.push({ carpeta: name, motivo: t('ed.errNoProposalJson') }); continue; }
      const imgs = fs.readdirSync(from).filter(f => IMG_RE.test(f) && fs.statSync(path.join(from, f)).size <= 15 * 1024 * 1024).sort().slice(0, 4);
      const { propuesta, avisos, errores } = normalizarPropuesta(raw, r, imgs, otras);
      const prev = reemplaza ? leer(office, reemplaza) : null;
      const id = prev ? prev.id : nextId(office, dia);
      const to = path.join(propDir(office), id);
      fs.mkdirSync(to, { recursive: true });
      if (prev) for (const f of fs.readdirSync(to)) if (IMG_RE.test(f)) fs.rmSync(path.join(to, f), { force: true });
      for (const f of imgs) fs.copyFileSync(path.join(from, f), path.join(to, f));
      if (fs.existsSync(path.join(from, 'investigacion.md'))) fs.copyFileSync(path.join(from, 'investigacion.md'), path.join(to, 'investigacion.md'));
      const now = new Date().toISOString();
      const p = {
        ...(prev || {}), ...propuesta, id, avisos,
        estado: errores.length ? 'descartada' : 'pendiente', motivoDescarte: errores.length ? errores.join(' · ') : null,
        creada: prev?.creada || now, actualizada: now, version: (prev?.version || 0) + 1,
        origen: { chatId, tanda: tanda || prev?.origen?.tanda || null, carpeta: name },
        historial: [...(prev?.historial || []), { ts: now, evento: prev ? 'cambios-entregados' : 'propuesta', chatId }].slice(-20),
        viralhunt: prev?.viralhunt || null,
      };
      escribir(office, p);
      (errores.length ? out.descartadas : out.creadas).push(errores.length ? { id, motivo: p.motivoDescarte } : id);
    }
    return out;
  }

  // ---------- Decisiones y gusto ----------
  const decFile = office => path.join(dir(office), 'decisiones.jsonl');
  function decisiones(office) {
    try { return fs.readFileSync(decFile(office), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; }
  }
  function apuntarDecision(office, propuesta, accion, { nota = '', casillas = [] } = {}) {
    const all = [...decisiones(office), { ts: new Date().toISOString(), accion, id: propuesta.id, hook: propuesta.hook, tema: propuesta.tema, nota: str(nota, 300), casillas }].slice(-MAX_DECISIONES);
    fs.mkdirSync(dir(office), { recursive: true });
    fs.writeFileSync(decFile(office) + '.tmp', all.map(x => JSON.stringify(x)).join('\n') + '\n');
    fs.renameSync(decFile(office) + '.tmp', decFile(office));
    memory.writeWithHistory(oficinas.dirs(office).memoria, GUSTO, resumenGusto(all, Date.now(), briefLang(regla(office) || DEFAULT)));
  }
  const gusto = office => { try { return fs.readFileSync(path.join(oficinas.dirs(office).memoria, GUSTO), 'utf8'); } catch { return ''; } };

  function decidir(office, pid, accion, input = {}) {
    const p = leer(office, pid);
    if (!p) throw httpErr(404, t('ed.errProposalMissing'));
    if (p.estado !== 'pendiente') throw httpErr(409, t('ed.errNotPending', { state: p.estado }));
    const nota = str(input.nota, 600);
    const casillas = (Array.isArray(input.casillas) ? input.casillas : []).filter(c => CASILLAS.includes(c));
    if (accion === 'rechazar' && !nota) throw httpErr(400, t('ed.errRejectReason'));
    if (accion === 'cambios' && !nota && !casillas.length) throw httpErr(400, t('ed.errChangesWhat'));
    return { p, nota, casillas };
  }

  function marcar(office, pid, cambios, evento) {
    const p = leer(office, pid);
    const now = new Date().toISOString();
    const next = { ...p, ...cambios, actualizada: now, historial: [...(p.historial || []), { ts: now, ...evento }].slice(-20) };
    escribir(office, next);
    return next;
  }

  const archivo = (office, pid, nombre) => {
    if (!pidOk(pid) || !/^[\w.-]+$/.test(String(nombre)) || !(IMG_RE.test(nombre) || nombre === 'investigacion.md')) return null;
    const f = path.join(propDir(office), pid, nombre);
    return fs.existsSync(f) ? f : null;
  };
  const carpeta = (office, pid) => path.join(propDir(office), pid);

  return { regla, guardarRegla, estado, guardarEstado, apuntarTanda, saltarFranja, propuestas, leer, cosechar, decidir, marcar, apuntarDecision, gusto, decisiones, archivo, carpeta };
}

module.exports = {
  createEditorial, normalizarRegla, normalizarPropuesta, tandaDebida, proximaFranja, franjas, instante, diaLocal,
  copiaLiteral, briefTanda, briefCambios, resumenGusto, DEFAULT, CASILLAS, ESTADOS, REDES, FUENTES, GUSTO,
};
