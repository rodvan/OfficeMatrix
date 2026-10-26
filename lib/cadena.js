// La cadena de la Editorial v2 (docs/BRIEF-EDITORIAL-V2.md §3 y §6, docs/EDITORIAL-V2.md):
//   «lo que pegó → más como eso». Las rutinas se pasan datos por archivos de la oficina, nunca por la memoria de un agente:
//     editorial/radar/<fecha>.json       lo que encontró el radar (temas que suben)
//     editorial/desempeno/<fecha>.json   los ganadores frente a la media, con sus rasgos (o ready:false, sin números)
//     editorial/semillas.json            los temas a trabajar, con su origen: radar, ganador, encargo del dueño o reuso
//     editorial/ediciones.json           lo que el humano cambió en ViralHunt (edit_log), resumido para el gusto
// Este módulo solo transforma datos: no llama a ViralHunt (eso lo hace el servidor con el token) ni a los agentes.
// Ante un campo que la API no garantiza, se lee si está y se deja vacío si no: nunca se inventa un número.
const fs = require('fs');
const path = require('path');
const { t, getLang } = require('./i18n');

const SEMAFOROS = ['verde', 'amarillo', 'rojo'];
const ORIGENES = ['encargo', 'ganador', 'radar', 'reuso'];
const PRIORIDAD = { encargo: 0, reuso: 1, ganador: 2, radar: 3 };
const MAX_SEMILLAS = 200;
const FACTOR_GANADOR = 1.5;

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : null);
const url = v => (/^https?:\/\/\S+$/i.test(String(v || '')) ? str(v, 500) : null);
const clave = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------- Semáforo antidesinformación (§3) ----------
// verde: fuente primaria leída · amarillo: solo secundarias · rojo: sin fuente o contradicha.
// El semáforo que declara el agente nunca puede ser mejor que lo que prueban sus fuentes; y sin verificador, como mucho amarillo.
function normalizarVerificacion(raw, { fuenteUrl = null, equipo = [] } = {}) {
  const v = raw && typeof raw === 'object' ? raw : {};
  const avisos = [];
  const fuentes = (Array.isArray(v.fuentes) ? v.fuentes : []).map(f => (typeof f === 'string' ? { url: f } : f || {}))
    .map(f => ({ url: url(f.url), tipo: f.tipo === 'primaria' ? 'primaria' : 'secundaria', titulo: str(f.titulo || f.nombre, 160), leida: f.leida !== false }))
    .filter(f => f.url).slice(0, 8);
  if (!fuentes.length && fuenteUrl) fuentes.push({ url: fuenteUrl, tipo: 'secundaria', titulo: '', leida: true });
  const contradicha = v.contradicha === true || v.semaforo === 'rojo';
  const prueba = contradicha || !fuentes.length ? 'rojo' : fuentes.some(f => f.tipo === 'primaria' && f.leida) ? 'verde' : 'amarillo';
  const declarado = SEMAFOROS.includes(v.semaforo) ? v.semaforo : prueba;
  let semaforo = SEMAFOROS[Math.max(SEMAFOROS.indexOf(declarado), SEMAFOROS.indexOf(prueba))];
  const ids = equipo.map(e => (typeof e === 'string' ? e : e.id));
  const verificador = ids.includes(str(v.verificador, 40)) ? str(v.verificador, 40) : null;
  if (!verificador) {
    avisos.push(t('ed.verify.noVerifier'));
    if (semaforo === 'verde') semaforo = 'amarillo';
  }
  if (declarado !== semaforo) avisos.push(t('ed.verify.downgraded', { from: declarado, to: semaforo }));
  return { verificacion: { semaforo, fuentes, verificador, nota: str(v.nota, 600), contradicha }, avisos };
}

// ¿Se puede aprobar? Roja nunca; amarilla con confirmación explícita. Las propuestas v1 (sin verificación) son amarillas.
function puedeAprobar(propuesta, { confirmarAmarillo = false } = {}) {
  const s = propuesta?.verificacion?.semaforo || 'amarillo';
  if (s === 'rojo') return { ok: false, codigo: 'semaforo_rojo', mensaje: t('ed.verify.redBlocked') };
  if (s === 'amarillo' && confirmarAmarillo !== true) return { ok: false, codigo: 'confirmar_amarillo', mensaje: t('ed.verify.yellowConfirm') };
  return { ok: true };
}

// ---------- Desempeño (stats.php) ----------
// Lee solo lo que la API devuelve. Rasgos que sí sabemos (tema, hook, formato, hora, red) salen de NUESTRA propuesta
// cuando el post de ViralHunt es uno que mandamos; si no, quedan en null y se dice.
const interacciones = p => {
  for (const v of [p?.engagement, p?.engagement_score, p?.interactions, p?.stats?.engagement, p?.metrics?.engagement, p?.totals?.engagement]) {
    const n = num(v);
    if (n != null) return n;
  }
  return null;
};

function leerTopPost(p) {
  const id = p?.post_id ?? p?.id ?? null;
  return {
    id: id == null ? null : String(id), red: str(p?.network || p?.platform, 20) || null,
    enlace: url(p?.permalink) || url(p?.url) || url(p?.post_url), texto: str(p?.body || p?.text || p?.title || p?.caption, 400),
    proyecto: str(p?.project || p?.project_name, 80) || null, publicado: str(p?.published_at || p?.created_at, 40) || null,
    interacciones: interacciones(p), metricas: p?.stats && typeof p.stats === 'object' ? p.stats : p?.metrics && typeof p.metrics === 'object' ? p.metrics : null,
  };
}

function analizarDesempeno(stats, propuestas = [], { zona = 'UTC', lang = getLang() } = {}) {
  const tr = (k, v) => t(k, v, lang);
  const fecha = new Date().toISOString();
  if (!stats || stats.ready === false) return { fecha, ready: false, motivo: stats?.motivo || tr('ed.perf.notReady'), ganadores: [], posts: [], media: null, porRed: [] };
  const posts = (Array.isArray(stats.top_posts) ? stats.top_posts : []).map(leerTopPost);
  const conNumero = posts.filter(p => p.interacciones != null);
  if (!conNumero.length) return { fecha, ready: true, motivo: tr('ed.perf.noNumbers'), ganadores: [], posts, media: null, porRed: [] };
  const media = conNumero.reduce((a, p) => a + p.interacciones, 0) / conNumero.length;
  // by_network: se usa si trae una cifra comparable; si no, se calcula sobre los top_posts y se dice que es esa muestra.
  const porRedApi = stats.by_network && typeof stats.by_network === 'object' ? Object.entries(Array.isArray(stats.by_network) ? Object.fromEntries(stats.by_network.map(r => [r.network || r.platform, r])) : stats.by_network)
    .map(([red, r]) => ({ red, interacciones: interacciones(r) ?? num(r?.total_engagement) ?? num(r?.total), posts: num(r?.posts) })).filter(r => r.red && r.interacciones != null) : [];
  const porRed = porRedApi.length ? porRedApi : Object.values(conNumero.reduce((acc, p) => {
    const k = p.red || '?'; acc[k] ||= { red: k, interacciones: 0, posts: 0 }; acc[k].interacciones += p.interacciones; acc[k].posts++; return acc;
  }, {}));
  const mejorRed = [...porRed].sort((a, b) => (b.interacciones / (b.posts || 1)) - (a.interacciones / (a.posts || 1)))[0]?.red || null;
  const porVh = new Map(propuestas.filter(p => p.viralhunt?.id != null).map(p => [String(p.viralhunt.id), p]));
  const ganadores = conNumero.filter(p => p.interacciones >= media * FACTOR_GANADOR || conNumero.length === 1)
    .sort((a, b) => b.interacciones - a.interacciones).slice(0, 5).map(p => {
      const nuestra = p.id ? porVh.get(p.id) : null;
      const hora = nuestra?.hora || p.publicado;
      const horaLocal = hora && !Number.isNaN(Date.parse(hora))
        ? new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(hora)) : null;
      const factores = { tema: nuestra?.tema || null, hook: nuestra?.hook || null, formato: nuestra?.tipo || null, hora: horaLocal, red: p.red };
      const porQue = [
        tr('ed.perf.whyTimes', { x: (p.interacciones / media).toFixed(1) }),
        p.red && p.red === mejorRed ? tr('ed.perf.whyBestNetwork', { network: p.red }) : null,
        factores.formato ? tr('ed.perf.whyFormat', { format: factores.formato }) : null,
        factores.hora ? tr('ed.perf.whyHour', { hour: factores.hora }) : null,
        nuestra ? null : tr('ed.perf.whyNotOurs'),
      ].filter(Boolean);
      return { ...p, propuesta: nuestra?.id || null, factores, porQue, tema: factores.tema || p.texto.split(/[.!?\n]/)[0].slice(0, 120) || null };
    });
  return { fecha, ready: true, motivo: null, media: Math.round(media), muestra: conNumero.length, mejorRed, porRed, ganadores, posts };
}

// Métricas devueltas por stats.php para cada propuesta nuestra (para la galería). Solo las que vinieron.
function metricasDePropuestas(desempeno, propuestas) {
  const por = new Map((desempeno?.posts || []).filter(p => p.id).map(p => [p.id, p]));
  const out = {};
  for (const p of propuestas) {
    const m = p.viralhunt?.id != null ? por.get(String(p.viralhunt.id)) : null;
    if (m) out[p.id] = { interacciones: m.interacciones, metricas: m.metricas, enlace: m.enlace, red: m.red, leidas: desempeno.fecha };
  }
  return out;
}

// ---------- Semillas ----------
// Una búsqueda de search.php → filas normalizadas (la forma que documenta la skill; `raw` no se guarda).
const filasBusqueda = d => (Array.isArray(d) ? d : d?.posts || d?.results || d?.items || []).slice(0, 10).map(p => ({
  plataforma: str(p.platform, 20) || null, titulo: str(p.title || p.description, 300), enlace: url(p.post_url),
  autor: str(p.author_handle || p.author_name, 80) || null, interacciones: num(p.engagement_score), crecimiento: p.growth_24h && typeof p.growth_24h === 'object' ? p.growth_24h : null,
})).filter(p => p.titulo);

// «Más como este»: por cada ganador, el post en tendencia más parecido que NO sea el mismo → una variación, no una copia.
function semillasMasComoEste(desempeno, busquedas = {}) {
  const out = [];
  for (const g of desempeno?.ganadores || []) {
    const filas = (busquedas[g.tema] || []).filter(f => clave(f.titulo) !== clave(g.texto) && f.enlace !== g.enlace);
    const similar = filas[0] || null;
    out.push({
      tema: g.tema, detalle: similar ? similar.titulo : '',
      origen: { tipo: 'ganador', postId: g.id, red: g.red, interacciones: g.interacciones, enlace: g.enlace, propuesta: g.propuesta || null,
        similar: similar ? { titulo: similar.titulo, enlace: similar.enlace, plataforma: similar.plataforma, interacciones: similar.interacciones } : null },
    });
  }
  return out;
}

// Lo que dejó el radar (radar.json de la misión): [{ tema, porQue, red, fuentes: [url] }].
function semillasRadar(raw, maximo = 3) {
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.temas) ? raw.temas : [];
  return arr.slice(0, maximo).map(x => ({
    tema: str(x?.tema, 160), detalle: str(x?.porQue ?? x?.por_que, 400),
    origen: { tipo: 'radar', red: str(x?.red, 20) || null, fuentes: (Array.isArray(x?.fuentes) ? x.fuentes : []).map(url).filter(Boolean).slice(0, 4) },
  })).filter(s => s.tema);
}

// La línea que el panel enseña en cada propuesta: «salió del ganador X (12k interacciones en TikTok) → tema similar Y».
function lineaOrigen(origen, lang = getLang()) {
  if (!origen) return null;
  const tr = (k, v) => t(k, v, lang);
  if (origen.tipo === 'ganador') {
    const base = tr('ed.chain.winner', { topic: origen.tema || '?', n: origen.interacciones != null ? Number(origen.interacciones).toLocaleString(lang) : '?', network: origen.red || '?' });
    return origen.similar ? `${base} → ${tr('ed.chain.similar', { title: origen.similar.titulo })}` : base;
  }
  if (origen.tipo === 'radar') return tr('ed.chain.radar', { network: origen.red || tr('ed.chain.web') });
  if (origen.tipo === 'encargo') return tr('ed.chain.assignment', { writer: origen.escritor || '?', when: origen.para || tr('ed.chain.asap') });
  if (origen.tipo === 'reuso') return tr('ed.chain.reuse', { id: origen.propuesta || '?' });
  return null;
}

function createSemillas(dirOf) {
  const file = office => path.join(dirOf(office), 'semillas.json');
  const leer = office => { try { const a = JSON.parse(fs.readFileSync(file(office), 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; } };
  const guardar = (office, arr) => {
    // Las usadas y descartadas más viejas salen primero al pasar del tope; las pendientes no se pierden.
    let out = arr;
    if (out.length > MAX_SEMILLAS) {
      const vivas = out.filter(s => s.estado === 'pendiente' || s.estado === 'en-tanda');
      out = [...out.filter(s => !vivas.includes(s)).slice(-(Math.max(0, MAX_SEMILLAS - vivas.length))), ...vivas];
    }
    fs.mkdirSync(path.dirname(file(office)), { recursive: true });
    fs.writeFileSync(file(office) + '.tmp', JSON.stringify(out, null, 2));
    fs.renameSync(file(office) + '.tmp', file(office));
  };
  // Añade sin duplicar un tema que ya está pendiente (un encargo del dueño sí entra siempre).
  function anadir(office, nuevas) {
    const arr = leer(office);
    const creadas = [];
    let n = arr.reduce((m, s) => Math.max(m, Number(String(s.id).slice(2)) || 0), 0);
    for (const s of nuevas) {
      const tipo = ORIGENES.includes(s.origen?.tipo) ? s.origen.tipo : 'radar';
      if (tipo !== 'encargo' && arr.some(x => x.estado === 'pendiente' && clave(x.tema) === clave(s.tema))) continue;
      const semilla = {
        id: `s-${++n}`, tema: str(s.tema, 160), detalle: str(s.detalle, 600), pilar: str(s.pilar, 40) || null,
        escritor: str(s.escritor || s.origen?.escritor, 40) || null, para: str(s.para || s.origen?.para, 40) || null,
        origen: { ...s.origen, tipo, tema: s.origen?.tema || str(s.tema, 160) }, prioridad: PRIORIDAD[tipo],
        estado: 'pendiente', creada: new Date().toISOString(), chatId: null,
      };
      arr.push(semilla);
      creadas.push(semilla);
    }
    guardar(office, arr);
    return creadas;
  }
  // Las que entran en la siguiente tanda de redacción: encargos primero, luego reusos, ganadores y radar; en cada grupo,
  // los encargos con fecha más cercana y las demás las más nuevas.
  function elegir(office, n) {
    return leer(office).filter(s => s.estado === 'pendiente')
      .sort((a, b) => a.prioridad - b.prioridad || (a.prioridad === 0 ? String(a.para || '9').localeCompare(String(b.para || '9')) : b.creada.localeCompare(a.creada)))
      .slice(0, n);
  }
  function marcar(office, ids, estado, extra = {}) {
    const arr = leer(office);
    for (const s of arr) if (ids.includes(s.id)) Object.assign(s, { estado, ...extra, actualizada: new Date().toISOString() });
    guardar(office, arr);
  }
  // Una tanda que no usó sus semillas las devuelve a pendientes (la siguiente las retoma).
  function liberar(office, chatId) {
    const arr = leer(office);
    for (const s of arr) if (s.estado === 'en-tanda' && s.chatId === chatId) Object.assign(s, { estado: 'pendiente', chatId: null });
    guardar(office, arr);
  }
  const quitar = (office, id) => { const arr = leer(office); const s = arr.find(x => x.id === id); if (s) s.estado = 'descartada'; guardar(office, arr); return s || null; };
  return { leer, anadir, elegir, marcar, liberar, quitar };
}

// ---------- Aprender de las ediciones (schedule.php?action=edit_log) ----------
// Filas: { field, before, after, who, at, post_id } según la skill; se leen con tolerancia y se resume el patrón.
function resumirEdiciones(rows) {
  const arr = (Array.isArray(rows) ? rows : rows?.edits || rows?.items || []).slice(-300);
  const porCampo = {};
  let acortadas = 0, alargadas = 0;
  const ejemplos = [];
  for (const r of arr) {
    const campo = str(r?.field, 40) || '?';
    porCampo[campo] = (porCampo[campo] || 0) + 1;
    const a = typeof r?.before === 'string' ? r.before : null, b = typeof r?.after === 'string' ? r.after : null;
    if (a != null && b != null && /body|caption|text|override/i.test(campo)) {
      if (b.length < a.length * 0.85) acortadas++;
      else if (b.length > a.length * 1.15) alargadas++;
    }
    if (ejemplos.length < 5 && a != null && b != null) ejemplos.push({ campo, antes: a.slice(0, 120), despues: b.slice(0, 120) });
  }
  return { total: arr.length, porCampo, acortadas, alargadas, ejemplos, leidas: new Date().toISOString() };
}

// Une lo ya leído con una lectura nueva sin contar dos veces la misma edición: tras un fallo la rutina vuelve a pedir
// 7 días, y dos pasadas seguidas se solapan unos segundos. La skill no garantiza un id por fila: la clave es la fila entera.
function unirEdiciones(previas, nuevas, max = 300) {
  const vistas = new Set();
  const out = [];
  for (const r of [...(Array.isArray(previas) ? previas : []), ...(Array.isArray(nuevas) ? nuevas : [])]) {
    const k = JSON.stringify(r);
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push(r);
  }
  return out.slice(-max);
}

function seccionEdiciones(ed, lang = getLang()) {
  if (!ed?.total) return '';
  const tr = (k, v) => t(k, v, lang);
  return [
    tr('ed.taste.edits'),
    tr('ed.taste.editsCount', { n: ed.total, fields: Object.entries(ed.porCampo).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ') }),
    ed.acortadas > ed.alargadas ? tr('ed.taste.editsShorter', { n: ed.acortadas }) : ed.alargadas > ed.acortadas ? tr('ed.taste.editsLonger', { n: ed.alargadas }) : null,
    ...ed.ejemplos.map(x => `- ${x.campo}: «${x.antes}» → «${x.despues}»`),
    '',
  ].filter(x => x !== null).join('\n');
}

module.exports = {
  SEMAFOROS, ORIGENES, PRIORIDAD, normalizarVerificacion, puedeAprobar, analizarDesempeno, metricasDePropuestas, leerTopPost,
  filasBusqueda, semillasMasComoEste, semillasRadar, lineaOrigen, createSemillas, resumirEdiciones, unirEdiciones, seccionEdiciones, clave,
};
