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
const zlib = require('zlib');
const memory = require('./memory');
const { t, getLang, detectLang } = require('./i18n');
const cadena = require('./cadena');

const REDES = ['instagram', 'facebook', 'x', 'tiktok', 'linkedin', 'threads', 'bluesky', 'youtube', 'pinterest', 'telegram'];
const FUENTES = ['x', 'tiktok', 'instagram', 'facebook', 'reddit', 'pinterest', 'bluesky', 'mastodon', 'tumblr', 'hackernews', 'rss', 'douyin'];
const CASILLAS = ['imagen', 'texto', 'hook', 'tema', 'hora'];
const ESTADOS = ['pendiente', 'en-cambios', 'aprobada', 'rechazada', 'descartada'];
const IMG_RE = /\.(png|jpe?g|webp)$/i;
const HORA_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_DECISIONES = 200;
const GUSTO = 'gusto-editorial.md';
const LIMITES = { x: 280, bluesky: 300, threads: 500 };
const PROPORCIONES = ['1:1', '4:5', '9:16', '16:9', '3:4', '2:3'];
const HEX_RE = /^#[0-9a-f]{6}$/i;
const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

const httpErr = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const list = (v, max, n = 12) => (Array.isArray(v) ? v : String(v || '').split(','))
  .map(x => str(x, max)).filter(Boolean).slice(0, n);

// ---------- La regla ----------

const DEFAULT = {
  activa: false,
  // Marca por oficina (§4): el generador de imágenes recibe todo esto. `referencias` son archivos de editorial/marca/.
  marca: { nombre: '', tono: '', paleta: [], tipografias: [], handles: {}, formato: '', proporcion: '4:5', referencias: [] },
  // Temas o pilares (§2): cada uno con sus escritores (ids del equipo).
  temas: [],
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
  if (input.marca) {
    const m = input.marca, pm = base.marca || {};
    const handles = {};
    for (const [red, h] of Object.entries(m.handles && typeof m.handles === 'object' ? m.handles : pm.handles || {})) if (REDES.includes(red) && str(h, 60)) handles[red] = str(h, 60);
    out.marca = {
      nombre: str(m.nombre ?? pm.nombre, 60), tono: str(m.tono ?? pm.tono, 400),
      paleta: list(m.paleta ?? pm.paleta, 7, 8), tipografias: list(m.tipografias ?? pm.tipografias, 60, 4), handles,
      formato: str(m.formato ?? pm.formato, 200), proporcion: str(m.proporcion ?? pm.proporcion ?? '4:5', 5),
      referencias: list(m.referencias ?? pm.referencias, 80, 8).filter(f => /^[\w.-]+\.(png|jpe?g|webp)$/i.test(f)),
    };
  }
  if ('temas' in input) {
    out.temas = (Array.isArray(input.temas) ? input.temas : []).map(x => (typeof x === 'string' ? { nombre: x } : x || {}))
      .map(x => ({ id: slug(x.id || x.nombre), nombre: str(x.nombre, 80), escritores: list(x.escritores, 40, 6) }))
      .filter(x => x.id && x.nombre).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i).slice(0, 20);
  }
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
  out.marca = { ...DEFAULT.marca, ...(out.marca || {}) };
  if (out.marca.paleta.some(c => !HEX_RE.test(c))) errores.push(t('ed.errPalette'));
  if (!PROPORCIONES.includes(out.marca.proporcion)) errores.push(t('ed.errRatio', { ratios: PROPORCIONES.join(', ') }));
  const ids = out.equipo.map(e => e.id);
  if ((out.temas || []).some(x => x.escritores.some(w => !ids.includes(w)))) errores.push(t('ed.errTopicWriters'));
  // Las rutinas (lib/rutinas.js): se completan siempre; «redaccion» hereda las horas de la v1.
  const { rutinas, errores: errRut } = require('./rutinas').normalizarRutinas('rutinas' in input ? input.rutinas : base.rutinas, out);
  out.rutinas = rutinas;
  errores.push(...errRut);
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
function normalizarPropuesta(raw, regla, imagenes = [], otras = [], semillas = []) {
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
    autor: regla.equipo.some(e => e.id === str(p.autor, 40)) ? str(p.autor, 40) : null,
    pilar: (regla.temas || []).some(x => x.id === str(p.pilar, 40)) ? str(p.pilar, 40) : null,
    semilla: semillas.some(s => s.id === str(p.semilla, 20)) ? str(p.semilla, 20) : null,
  };
  // Semáforo antidesinformación (§3): nunca mejor que lo que prueban las fuentes; sin verificador, como mucho amarillo.
  const ver = cadena.normalizarVerificacion(p.verificacion, { fuenteUrl: fuente?.url || null, equipo: regla.equipo });
  out.verificacion = ver.verificacion;
  avisos.push(...ver.avisos);
  const semilla = semillas.find(s => s.id === out.semilla);
  if (semilla) {
    out.cadena = { ...semilla.origen, semilla: semilla.id };
    if (!out.pilar && semilla.pilar) out.pilar = semilla.pilar;
    if (!out.autor && semilla.escritor) out.autor = semilla.escritor;
  } else if (semillas.length && p.semilla) avisos.push(t('ed.warnUnknownSeed', { seed: str(p.semilla, 20) }));
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

// La marca que recibe el generador de imágenes (§4): paleta, tipografías, handles, formato, proporción y referencias.
function lineasMarca(regla, tr) {
  const m = regla.marca || {};
  return [
    m.paleta?.length ? tr('ed.brief.palette', { colors: m.paleta.join(', ') }) : null,
    m.tipografias?.length ? tr('ed.brief.fonts', { fonts: m.tipografias.join(', ') }) : null,
    Object.keys(m.handles || {}).length ? tr('ed.brief.handles', { handles: Object.entries(m.handles).map(([r, h]) => `${r} ${h}`).join(' · ') }) : null,
    m.formato ? tr('ed.brief.format', { format: m.formato }) : null,
    m.proporcion ? tr('ed.brief.ratio', { ratio: m.proporcion }) : null,
    m.referencias?.length ? tr('ed.brief.references', { files: m.referencias.map(f => `\`marca/${f}\``).join(', ') }) : null,
  ].filter(Boolean);
}

// Las semillas de la tanda (§6): encargos del dueño primero, con su escritor y su hora.
function lineasSemillas(semillas, tr, lang) {
  return semillas.map(s => `- \`${s.id}\` · ${s.tema}${s.detalle ? ` — ${s.detalle}` : ''}${s.escritor ? ` · ${tr('ed.brief.seedWriter', { writer: s.escritor })}` : ''}${s.para ? ` · ${tr('ed.brief.seedFor', { when: s.para })}` : ''}` +
    `${s.origen?.tipo === 'encargo' ? ` · **${tr('ed.brief.seedPriority')}**` : ''}\n  ${tr('ed.brief.seedOrigin', { origin: cadena.lineaOrigen(s.origen, lang) || s.origen?.tipo })}`);
}

function briefTanda({ regla, oficina, franja, gusto, investigacion, semillas = [] }) {
  const n = regla.propuestasPorTanda;
  const L = briefLang(regla);
  const tr = (k, v) => t(k, v, L);
  const equipo = regla.equipo.map(e => `- ${e.id}: ${e.rol || tr('ed.brief.roleFallback')}`).join('\n');
  const ejemplo = JSON.stringify({
    tema: tr('ed.brief.exTopic'), porQue: tr('ed.brief.exWhy'), hook: tr('ed.brief.exHook'),
    copy: Object.fromEntries(regla.redes.map(r => [r, LIMITES[r] ? tr('ed.brief.exCopyMax', { network: r, max: LIMITES[r] }) : tr('ed.brief.exCopy', { network: r })])),
    hashtags: tr('ed.brief.exTags').split(', '), hora: '2026-10-25T15:30:00Z', idiomas: regla.idiomas, tipo: 'fact',
    fuente: { nombre: tr('ed.brief.exSourceName'), url: 'https://…', metricas: { likes: 0, views: 0 }, texto: tr('ed.brief.exSourceText') },
    verificacion: { semaforo: 'verde', fuentes: [{ url: 'https://…', tipo: 'primaria', titulo: tr('ed.brief.exPrimary') }, { url: 'https://…', tipo: 'secundaria' }], verificador: verificadorDe(regla) || 'claude', nota: tr('ed.brief.exVerifyNote') },
    autor: regla.equipo[0]?.id, ...(semillas.length ? { semilla: semillas[0].id } : {}), ...(regla.temas?.length ? { pilar: regla.temas[0].id } : {}),
  }, null, 2);
  const verif = verificadorDe(regla);
  return [
    tr('ed.brief.title', { office: oficina.nombre, slot: franja ? ` (${franja.dia} ${franja.hora}, ${regla.zona})` : '', n }),
    '',
    tr('ed.brief.brand'),
    tr('ed.brief.name', { name: regla.marca.nombre || oficina.nombre }),
    regla.marca.tono ? tr('ed.brief.tone', { tone: regla.marca.tono }) : null,
    tr('ed.brief.languages', { languages: regla.idiomas.join(', ') }),
    tr('ed.brief.networks', { networks: regla.redes.join(', ') }),
    regla.nichos.length ? tr('ed.brief.niches', { niches: regla.nichos.join(', ') }) : null,
    ...lineasMarca(regla, tr),
    regla.temas?.length ? tr('ed.brief.pillars', { pillars: regla.temas.map(x => `\`${x.id}\` ${x.nombre}${x.escritores.length ? ` (${x.escritores.join(', ')})` : ''}`).join(' · ') }) : null,
    '',
    tr('ed.brief.team'),
    equipo,
    '',
    ...(semillas.length ? [tr('ed.brief.seeds', { n: semillas.length }), ...lineasSemillas(semillas, tr, L), ''] : []),
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
    tr('ed.brief.verifyTitle'),
    tr('ed.brief.verifyLights'),
    verif ? tr('ed.brief.verifyWho', { id: verif }) : tr('ed.brief.verifyNobody'),
    tr('ed.brief.verifyNoInvent'),
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

// El verificador (§3): el miembro del equipo cuyo rol lo dice; si no hay, Gemini o Claude si están en el equipo.
function verificadorDe(regla) {
  const eq = regla.equipo || [];
  const porRol = eq.find(e => /verif|fact/i.test(e.rol || ''));
  return porRol?.id || eq.find(e => e.id === 'gemini')?.id || eq.find(e => e.id === 'claude')?.id || null;
}

// La rutina «radar» (§6): una tanda corta de 1 a 3 temas que suben, sin redactar ni hacer imágenes.
function briefRadar({ regla, oficina, cantidad = 3, investigacion, ganadores = [] }) {
  const L = briefLang(regla);
  const tr = (k, v) => t(k, v, L);
  const ejemplo = JSON.stringify({ temas: [{ tema: tr('ed.brief.exTopic'), porQue: tr('ed.brief.exWhy'), red: 'x', fuentes: ['https://…'] }] }, null, 2);
  return [
    tr('ed.radar.title', { office: oficina.nombre, n: cantidad }),
    '',
    regla.nichos.length ? tr('ed.brief.niches', { niches: regla.nichos.join(', ') }) : null,
    regla.temas?.length ? tr('ed.brief.pillars', { pillars: regla.temas.map(x => x.nombre).join(' · ') }) : null,
    tr('ed.brief.networks', { networks: regla.redes.join(', ') }),
    '',
    investigacion ? tr('ed.radar.research', { n: investigacion.tendencias.length }) : tr('ed.brief.researchNone'),
    regla.equipo.some(e => e.id === 'grok') ? tr('ed.radar.grokX') : null,
    ganadores.length ? tr('ed.radar.winners', { list: ganadores.slice(0, 3).map(g => g.tema).filter(Boolean).join(' · ') }) : null,
    '',
    tr('ed.radar.deliverable'),
    '```json', ejemplo, '```',
    tr('ed.radar.rules'),
    tr('ed.brief.noCall'),
  ].filter(x => x !== null).join('\n');
}

// ---------- El gusto: un resumen compacto que se reescribe ----------

// `notas`: lo que el dueño escribió a mano (editorial/gusto-notas.md), que nunca se pisa; `ediciones`: el resumen del
// edit_log de ViralHunt (rutina «aprender»).
function resumenGusto(decisiones, ahora = Date.now(), lang = getLang(), { notas = '', ediciones = null } = {}) {
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
    ...(notas.trim() ? [tr('ed.taste.ownerNotes'), notas.trim().slice(0, 3000), ''] : []),
    ...(ediciones?.total ? [cadena.seccionEdiciones(ediciones, lang)] : []),
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
  const semillas = cadena.createSemillas(dir);
  const rutinas = require('./rutinas').createRutinasStore(dir);
  // Datos de la cadena por fecha: editorial/radar/<fecha>.json y editorial/desempeno/<fecha>.json (§6).
  const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
  const guardarDia = (office, tipo, fecha, datos) => writeJson(path.join(dir(office), tipo, `${fecha}.json`), datos);
  const leerDia = (office, tipo, fecha) => (FECHA_RE.test(fecha) ? readJson(path.join(dir(office), tipo, `${fecha}.json`), null) : null);
  const ultimoDia = (office, tipo) => {
    const d = path.join(dir(office), tipo);
    const f = fs.existsSync(d) ? fs.readdirSync(d).filter(x => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().pop() : null;
    return f ? readJson(path.join(d, f), null) : null;
  };
  const ediciones = office => readJson(path.join(dir(office), 'ediciones.json'), null);
  const notasFile = office => path.join(dir(office), 'gusto-notas.md');
  const notasGusto = office => { try { return fs.readFileSync(notasFile(office), 'utf8'); } catch { return ''; } };
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
    // Lo mismo por rutina: al encender la editorial o al reanudar una rutina, su franja anterior no se lanza de golpe.
    for (const rut of r.rutinas) {
      const antes = (prev.rutinas || []).find(x => x.tipo === rut.tipo);
      if (rut.activa && r.activa && (!prev.activa || !antes?.activa)) rutinas.activar(office, rut.tipo, true);
    }
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
  function cosechar(office, projectDir, { chatId, tanda = null, reemplaza = null, rutina = 'redaccion' } = {}) {
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
      // Las semillas que esta tanda recibió (o la de la propuesta que se está cambiando).
      const deTanda = semillas.leer(office).filter(s => s.chatId === chatId || (reemplaza && s.id === raw.semilla));
      const { propuesta, avisos, errores } = normalizarPropuesta(raw, r, imgs, otras, deTanda);
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
        origen: { chatId, tanda: tanda || prev?.origen?.tanda || null, carpeta: name, rutina: prev?.origen?.rutina || rutina },
        historial: [...(prev?.historial || []), { ts: now, evento: prev ? 'cambios-entregados' : 'propuesta', chatId }].slice(-20),
        viralhunt: prev?.viralhunt || null,
      };
      if (p.semilla && !prev && !errores.length) semillas.marcar(office, [p.semilla], 'usada', { propuesta: id });
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
    reescribirGusto(office, all);
  }
  // El gusto se reescribe con las decisiones, las notas a mano del dueño y lo aprendido del edit_log.
  function reescribirGusto(office, all = decisiones(office)) {
    memory.writeWithHistory(oficinas.dirs(office).memoria, GUSTO, resumenGusto(all, Date.now(), briefLang(regla(office) || DEFAULT), { notas: notasGusto(office), ediciones: ediciones(office) }));
  }
  // «Editar a mano» (§2): lo que escribe el dueño va a sus notas, que encabezan el gusto y nunca se pisan.
  function guardarNotasGusto(office, texto) {
    deOficina(office);
    fs.mkdirSync(dir(office), { recursive: true });
    fs.writeFileSync(notasFile(office), str(texto, 3000));
    reescribirGusto(office);
    return gusto(office);
  }
  function guardarEdiciones(office, resumen) { writeJson(path.join(dir(office), 'ediciones.json'), resumen); reescribirGusto(office); }
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

  // Calendario (§2): arrastrar cambia la hora ANTES de enviar; una aprobada ya está en ViralHunt y no se mueve desde aquí.
  function cambiarHora(office, pid, hora) {
    const p = leer(office, pid);
    if (!p) throw httpErr(404, t('ed.errProposalMissing'));
    if (p.estado !== 'pendiente') throw httpErr(409, t('ed.errHourLocked', { state: p.estado }));
    const at = Date.parse(hora || '');
    if (Number.isNaN(at)) throw httpErr(400, t('ed.warnInvalidHour', { hour: str(hora, 40) }));
    const iso = new Date(at).toISOString();
    return marcar(office, pid, { hora: iso }, { evento: 'hora', hora: iso });
  }

  // Galería (§7): todo lo que pasó por la bandeja, con filtros, el estado de ViralHunt y las métricas de stats.php.
  function galeria(office, f = {}) {
    const todas = propuestas(office);
    const metricas = cadena.metricasDePropuestas(ultimoDia(office, 'desempeno'), todas);
    const lang = briefLang(regla(office) || DEFAULT);
    return todas.filter(p => p.estado !== 'descartada' || f.estado === 'descartada').map(p => ({
      ...p, publicado: p.viralhunt?.remoto?.status === 'published' || !!metricas[p.id], metricas: metricas[p.id] || null,
      cambiosPedidos: (p.historial || []).some(h => h.evento === 'cambios-pedidos'), lineaOrigen: cadena.lineaOrigen(p.cadena, lang),
    })).filter(p => (!f.estado || (f.estado === 'publicada' ? p.publicado : f.estado === 'cambios' ? p.cambiosPedidos : p.estado === f.estado))
      && (!f.red || Object.keys(p.copy || {}).includes(f.red))
      && (!f.tema || p.pilar === f.tema || cadena.clave(p.tema).includes(cadena.clave(f.tema)))
      && (!f.escritor || p.autor === f.escritor)
      && (!f.rutina || p.cadena?.tipo === f.rutina || (p.origen?.rutina || 'redaccion') === f.rutina));
  }

  // Tablero de cada escritor (§2): encargos, propuestas, tasa de aprobación y motivos de rechazo.
  function escritores(office) {
    const r = regla(office) || DEFAULT;
    const ps = propuestas(office).filter(p => p.estado !== 'descartada');
    const sem = semillas.leer(office);
    return r.equipo.map(e => {
      const mias = ps.filter(p => p.autor === e.id);
      const ap = mias.filter(p => p.estado === 'aprobada').length;
      const decididas = mias.filter(p => ['aprobada', 'rechazada'].includes(p.estado)).length;
      return {
        id: e.id, rol: e.rol, temas: (r.temas || []).filter(x => x.escritores.includes(e.id)).map(x => x.id),
        encargos: sem.filter(s => s.origen?.tipo === 'encargo' && s.escritor === e.id && s.estado !== 'descartada'),
        propuestas: mias.length, pendientes: mias.filter(p => p.estado === 'pendiente').length, aprobadas: ap,
        tasaAprobacion: decididas ? Math.round((100 * ap) / decididas) : null,
        motivosRechazo: mias.filter(p => p.estado === 'rechazada' && p.motivoRechazo).slice(0, 5).map(p => ({ id: p.id, motivo: p.motivoRechazo })),
      };
    });
  }

  // Encargo del dueño (§2): «Grok: hilo sobre Artemis III para mañana 9:00» → semilla con prioridad para su escritor.
  function encargar(office, input = {}) {
    deOficina(office);
    const r = regla(office) || DEFAULT;
    const escritor = str(input.escritor, 40);
    if (!r.equipo.some(e => e.id === escritor)) throw httpErr(400, t('ed.errWriter'));
    const tema = str(input.tema, 160);
    if (!tema) throw httpErr(400, t('ed.errMissingTopic'));
    const at = input.para ? Date.parse(input.para) : null;
    if (input.para && Number.isNaN(at)) throw httpErr(400, t('ed.warnInvalidHour', { hour: str(input.para, 40) }));
    const para = at ? new Date(at).toISOString() : null;
    const pilar = (r.temas || []).some(x => x.id === input.pilar) ? input.pilar : null;
    return semillas.anadir(office, [{ tema, detalle: input.detalle, pilar, escritor, para, origen: { tipo: 'encargo', escritor, para } }])[0];
  }

  // «Reusar» (§7): una pieza vieja vuelve como semilla nueva (si ya hay una pendiente con ese tema, se devuelve esa).
  function reusar(office, pid) {
    const p = leer(office, pid);
    if (!p) throw httpErr(404, t('ed.errProposalMissing'));
    return semillas.anadir(office, [{ tema: p.tema, detalle: p.hook, pilar: p.pilar, origen: { tipo: 'reuso', propuesta: p.id, red: Object.keys(p.copy || {})[0] || null } }])[0]
      || semillas.leer(office).find(s => s.estado === 'pendiente' && cadena.clave(s.tema) === cadena.clave(p.tema));
  }

  // Exportar galería (§7): .zip sin dependencias con JSON, copys y las imágenes de las propuestas seleccionadas.
  function exportarGaleriaZip(office, ids = []) {
    const todas = propuestas(office);
    const elegidas = ids.length ? todas.filter(p => ids.includes(p.id)) : todas.filter(p => p.estado !== 'descartada');
    const archivos = [];
    for (const p of elegidas) {
      const prefijo = `propuesta-${p.id}`;
      archivos.push({ nombre: `${prefijo}.json`, datos: JSON.stringify(p, null, 2) });
      const copyText = Object.entries(p.copy || {}).map(([red, txt]) => `=== ${red} ===\n${txt}`).join('\n\n');
      const doc = `# ${p.hook || p.id}\nTopic: ${p.tema || '–'}\nState: ${p.estado}\nSchedule: ${p.hora || '–'}\nAuthor: ${p.autor || '–'}\nLight: ${p.verificacion?.semaforo || '–'}\nChain: ${p.lineaOrigen || '–'}\n\n## Copy\n${copyText}\n\nHashtags: ${(p.hashtags || []).join(' ')}\n`;
      archivos.push({ nombre: `${prefijo}-copy.txt`, datos: doc });
      for (const img of p.imagenes || []) {
        const rutaImg = archivo(office, p.id, img);
        if (rutaImg && fs.existsSync(rutaImg)) {
          archivos.push({ nombre: `${prefijo}-${img}`, datos: fs.readFileSync(rutaImg) });
        }
      }
    }
    return crearZip(archivos);
  }

  return {
    regla, guardarRegla, estado, guardarEstado, apuntarTanda, saltarFranja, propuestas, leer, cosechar, decidir, marcar, apuntarDecision, gusto, decisiones, archivo, carpeta,
    semillas, rutinas, guardarDia, leerDia, ultimoDia, ediciones, guardarEdiciones, notasGusto, guardarNotasGusto, reescribirGusto,
    cambiarHora, galeria, escritores, encargar, reusar, dir, exportarGaleriaZip,
  };
}

// CRC-32 (IEEE): zlib.crc32 solo existe desde Node 20.15 / 22.2 y la app promete Node 18+; la tabla cubre el resto.
let tablaCrc = null;
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf);
  if (!tablaCrc) {
    tablaCrc = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tablaCrc[n] = c >>> 0; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = tablaCrc[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Generador de ZIP en modo Store (sin dependencias externas, compatible con Windows, Mac y Linux).
// Bit 11 del flag: los nombres van en UTF-8 (títulos con tildes o «»), así Windows y macOS no los muestran rotos.
function crearZip(archivos) {
  const buffers = [], entries = [];
  let offset = 0;
  for (const item of archivos) {
    const data = Buffer.isBuffer(item.datos) ? item.datos : Buffer.from(item.datos || '', 'utf8');
    const nameBuf = Buffer.from(item.nombre.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(data), time = 0x3600, date = 0x5D5A;
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    entries.push({ nameBuf, crc, size: data.length, offset, time, date });
    buffers.push(local, data);
    offset += local.length + data.length;
  }
  const cdOffset = offset;
  let cdSize = 0;
  for (const e of entries) {
    const cd = Buffer.alloc(46 + e.nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(e.time, 12); cd.writeUInt16LE(e.date, 14); cd.writeUInt32LE(e.crc, 16); cd.writeUInt32LE(e.size, 20);
    cd.writeUInt32LE(e.size, 24); cd.writeUInt16LE(e.nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38); cd.writeUInt32LE(e.offset, 42);
    e.nameBuf.copy(cd, 46);
    buffers.push(cd); cdSize += cd.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6); eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cdSize, 12); eocd.writeUInt32LE(cdOffset, 16); eocd.writeUInt16LE(0, 20);
  buffers.push(eocd);
  return Buffer.concat(buffers);
}

module.exports = {
  createEditorial, normalizarRegla, normalizarPropuesta, tandaDebida, proximaFranja, franjas, instante, diaLocal,
  briefLangOf: regla => briefLang(regla), copiaLiteral, briefTanda, briefCambios, briefRadar, verificadorDe, resumenGusto, PROPORCIONES, DEFAULT, CASILLAS, ESTADOS, REDES, FUENTES, GUSTO, crearZip, crc32,
};
