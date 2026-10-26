// Conector ViralHunt de la Editorial continua (docs/BRIEF-EDITORIAL.md §5, D66-ED).
// El token es de la oficina: vive en oficinas/<id>/viralhunt.secreto.json y SOLO lo usa el servidor, con
// «Authorization: Bearer» contra https://viralhunt.io/tool/api/v1/. Nunca va a un brief, al chat, a un log ni a la UI:
// las funciones de este módulo devuelven datos de ViralHunt o errores con su código, jamás la cabecera ni el token.
// Pruebas y demo: OFFICEMATRIX_VIRALHUNT_URL apunta a un ViralHunt simulado, y solo se acepta http://127.0.0.1:44xx
// (4400-4499). Así una prueba no puede llamar a la API real por error ni a los puertos de la app (4321-4323).
const fs = require('fs');
const path = require('path');
const { t } = require('./i18n');

const REAL_BASE = 'https://viralhunt.io/tool/api/v1/';
const TOKEN_RE = /^vhk_[A-Za-z0-9_-]{8,200}$/;
const TIMEOUT_MS = 20000;
const CLIENT = 'officematrix-editorial/1';

const httpErr = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });

// La base: la real, o un simulador local en 44xx. Cualquier otra cosa se rechaza (y la prueba lo comprueba).
function baseUrl(env = process.env) {
  const sim = String(env.OFFICEMATRIX_VIRALHUNT_URL || '').trim();
  if (!sim) return REAL_BASE;
  const m = /^http:\/\/127\.0\.0\.1:(44\d\d)(\/[^\s]*)?$/.exec(sim);
  if (!m) throw httpErr(500, t('viralhunt.err.simOnly'));
  return sim.endsWith('/') ? sim : `${sim}/`;
}

// Qué decirle al usuario según lo que respondió ViralHunt (la skill, «Error handling»).
function explain(status, code, message) {
  const KNOWN = ['invalid_key', 'insufficient_scope', 'project_required', 'no_project', 'no_accounts', 'text_too_long', 'rate_limited', 'daily_limit_reached'];
  const why = KNOWN.includes(code) ? t(`viralhunt.err.${code}`) : null;
  if (why) return why;
  if (status === 401) return t('viralhunt.err.401');
  if (status === 403) return t('viralhunt.err.403');
  if (status === 429) return t('viralhunt.err.429');
  return message || t('viralhunt.err.status', { status });
}

function createViralHunt(oficinas, { env = process.env } = {}) {
  const secFile = office => path.join(oficinas.dirs(office).root, 'viralhunt.secreto.json');
  const readToken = office => {
    try { return JSON.parse(fs.readFileSync(secFile(office), 'utf8')).token || null; } catch { return null; }
  };

  // ---------- El token de la oficina ----------
  function setToken(office, token) {
    if (!oficinas.read(office) || office === oficinas.EDIFICIO) throw httpErr(400, t('viralhunt.err.perOffice'));
    const tok = String(token || '').trim();
    if (!TOKEN_RE.test(tok)) throw httpErr(400, t('viralhunt.err.tokenFormat'));
    const file = secFile(office);
    fs.writeFileSync(file + '.tmp', JSON.stringify({ token: tok, guardado: new Date().toISOString() }, null, 2));
    fs.renameSync(file + '.tmp', file);
    return estado(office);
  }
  function removeToken(office) { fs.rmSync(secFile(office), { force: true }); return estado(office); }
  // Lo único que sale del token hacia la UI: si hay uno. Ni siquiera los últimos caracteres.
  const estado = office => ({ configurado: !!readToken(office) });

  // ---------- Llamada ----------
  async function call(office, method, endpoint, { query = {}, json, form } = {}) {
    const token = readToken(office);
    if (!token) throw httpErr(409, t('viralhunt.err.noToken'), { codigo: 'sin_token' });
    const url = new URL(endpoint, baseUrl(env));
    for (const [k, v] of Object.entries(query)) if (v != null && v !== '') url.searchParams.set(k, String(v));
    const headers = { authorization: `Bearer ${token}`, 'x-vh-client': CLIENT, accept: 'application/json' };
    let body;
    if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
    else if (form) body = form;
    let res;
    try {
      res = await fetch(url, { method, headers, body, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      throw httpErr(502, err.name === 'TimeoutError' ? t('viralhunt.err.timeout', { s: TIMEOUT_MS / 1000 }) : t('viralhunt.err.unreachable', { code: err.cause?.code || err.name }), { codigo: 'red' });
    }
    let data = null;
    try { data = await res.json(); } catch { /* sin JSON */ }
    if (!res.ok || data?.success === false) {
      const code = data?.error?.code || null;
      // Al panel siempre le llega 502 (un 401 de ViralHunt no es un 401 de OfficeMatrix); el código real va aparte.
      throw httpErr(502, explain(res.status, code, data?.error?.message), { codigo: code || `http_${res.status}`, vhStatus: res.status });
    }
    return data?.data ?? data;
  }

  // ---------- Lo que usa la editorial ----------
  const cuenta = office => call(office, 'GET', 'account.php');
  const destinos = office => call(office, 'GET', 'schedule.php', { query: { action: 'targets' } });

  // Resultados de tendencias para la carpeta de la misión (los agentes ven esto, nunca el token).
  // Pocas llamadas y bien filtradas: el plan gratuito tiene 24 consultas al día.
  async function investigar(office, regla) {
    const out = { pedido: new Date().toISOString(), tendencias: [], mejorHora: [], errores: [] };
    const fuentes = regla.fuentes.slice(0, 4);
    const nichos = regla.nichos.length ? regla.nichos.slice(0, 2) : [''];
    for (const source of fuentes) {
      for (const keyword of nichos) {
        try {
          const d = await call(office, 'GET', 'trending.php', { query: { source, keyword, sort: 'viral', time_range: '24h', per_page: 10 } });
          const rows = Array.isArray(d) ? d : d?.posts || d?.items || d?.results || [];
          out.tendencias.push({ fuente: source, nicho: keyword || null, posts: rows.slice(0, 10).map(p => ({
            titulo: p.title || p.text || p.description || '', url: p.post_url || p.url || null, autor: p.author_name || p.author || null,
            metricas: p.metrics || null, crecimiento: p.growth_24h || null, publicado: p.created_at || null,
          })) });
        } catch (err) { out.errores.push({ llamada: `trending ${source}${keyword ? ` «${keyword}»` : ''}`, error: err.message }); if (err.codigo === 'sin_token' || err.vhStatus === 401) return out; }
      }
    }
    for (const network of regla.redes.slice(0, 3)) {
      try {
        const d = await call(office, 'GET', 'best-time.php', { query: { network, timezone: regla.zona } });
        out.mejorHora.push({ red: network, confianza: d?.confidence || null, franjas: (d?.best_slots || []).slice(0, 3), hoy: d?.today?.best_hours || null, muestra: d?.sample || null });
      } catch (err) { out.errores.push({ llamada: `best-time ${network}`, error: err.message }); }
    }
    return out;
  }

  // Sube la imagen local de la propuesta y devuelve su URL pública (ViralHunt no lee archivos del PC).
  async function subir(office, file) {
    const form = new FormData();
    const type = /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg';
    form.append('file', new Blob([fs.readFileSync(file)], { type }), path.basename(file));
    const d = await call(office, 'POST', 'schedule.php', { query: { action: 'upload' }, form });
    if (!d?.url) throw httpErr(502, t('viralhunt.err.noUploadUrl'));
    return d.url;
  }

  // Al aprobar: borrador o agendado según la regla, diciendo la verdad sobre dónde quedó (§5 del brief).
  async function publicar(office, regla, propuesta, imagen) {
    const dest = await destinos(office);
    const media = imagen ? [await subir(office, imagen)] : [];
    const copy = propuesta.copy || {};
    const principal = copy[regla.redes[0]] || Object.values(copy)[0] || propuesta.hook;
    const overrides = {};
    for (const red of regla.redes) if (copy[red] && copy[red] !== principal) overrides[red] = { body: copy[red] };
    const hashtags = (propuesta.hashtags || []).map(h => `#${String(h).replace(/^#/, '')}`).join(' ');
    const body = {
      ...(regla.viralhunt.proyectoId ? { project_id: regla.viralhunt.proyectoId } : regla.viralhunt.proyecto ? { project: regla.viralhunt.proyecto } : {}),
      body: hashtags && !principal.includes(hashtags) ? `${principal}\n\n${hashtags}` : principal,
      media,
      ...(regla.viralhunt.cuentas.length ? { target_account_ids: regla.viralhunt.cuentas } : { networks: regla.redes }),
      ...(Object.keys(overrides).length ? { overrides } : {}),
      // La fuente va en las notas del revisor, nunca en el cuerpo (un enlace en el cuerpo corta el alcance).
      author_notes: [t('viralhunt.notes.approved', { id: propuesta.id }),
        propuesta.fuente?.url ? t('viralhunt.notes.source', { url: propuesta.fuente.url }) : null, propuesta.porQue ? t('viralhunt.notes.why', { why: propuesta.porQue }) : null].filter(Boolean).join('\n'),
      ...(propuesta.tipo ? { kind: propuesta.tipo } : {}),
    };
    const agendar = regla.destino === 'agendar';
    if (agendar) {
      const at = Date.parse(propuesta.hora || '');
      if (!(at > Date.now() + 15 * 60e3)) throw httpErr(409, t('viralhunt.err.scheduleFuture'), { codigo: 'hora' });
      body.scheduled_at = new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z');
    } else body.draft = true;
    const r = await call(office, 'POST', 'schedule.php', { query: { action: 'create' }, json: body });
    // Dónde quedó de verdad: un token de escritor que agenda cae en Review (must_draft / review_stage_ready).
    const stage = r?.stage || r?.status || null;
    let donde;
    if (!agendar) donde = 'borrador';
    else if (stage === 'review' || (dest?.must_draft && dest?.review_stage_ready !== false)) donde = 'revision';
    else if (stage === 'draft' || dest?.must_draft) donde = 'borrador';
    else donde = 'agendado';
    return {
      id: r?.id ?? null, status: r?.status || null, stage, donde,
      url: r?.review_url || r?.url || null, scheduled_at: r?.scheduled_at || body.scheduled_at || null,
      warnings: Array.isArray(r?.warnings) ? r.warnings.slice(0, 5) : [],
    };
  }

  // ---------- Editorial v2: la vuelta de ViralHunt (docs/EDITORIAL-V2.md) ----------
  // Lo que la skill documenta, y nada más: si un campo no viene, queda vacío; si la función no está en el servidor
  // (503 *_unavailable) o no hay datos (ready:false), se devuelve así para que la rutina lo diga, nunca se inventa.

  // §8a: GET stats.php → { ready, by_network, by_project, top_posts }. Un 503 (función aún no activa en el servidor)
  // se trata como «sin estadísticas»: la cadena sigue con el radar, igual que con ready:false.
  async function stats(office, regla, { days = 30, limit = 20 } = {}) {
    const query = { days, limit, ...(regla?.viralhunt?.proyectoId ? { project_id: regla.viralhunt.proyectoId } : regla?.viralhunt?.proyecto ? { project: regla.viralhunt.proyecto } : {}) };
    let d;
    try { d = await call(office, 'GET', 'stats.php', { query }); } catch (err) {
      if (err.vhStatus === 503) return { ready: false, disponible: false, motivo: err.message };
      throw err;
    }
    return d && typeof d === 'object' ? { ready: d.ready !== false, by_network: d.by_network ?? null, by_project: d.by_project ?? null, top_posts: Array.isArray(d.top_posts) ? d.top_posts : [] } : { ready: false };
  }

  // §2: GET search.php?keyword= → filas de todas las redes, ya normalizadas por ViralHunt.
  const buscar = (office, keyword, { timeRange = '7d', perSource = 5 } = {}) =>
    call(office, 'GET', 'search.php', { query: { keyword, time_range: timeRange, per_source: perSource, sort: 'engagement' } });

  // §5b: GET schedule.php?action=edit_log&since=<ISO> → lo que una persona cambió en los borradores.
  async function editLog(office, since) {
    try {
      const d = await call(office, 'GET', 'schedule.php', { query: { action: 'edit_log', since } });
      const filas = Array.isArray(d) ? d : d?.edits || d?.edit_log || d?.items || d?.log || d?.rows || [];
      return { disponible: true, filas: Array.isArray(filas) ? filas : [] };
    } catch (err) {
      if (err.vhStatus === 503) return { disponible: false, filas: [], motivo: err.message };
      throw err;
    }
  }

  // §8: GET schedule.php?action=get&id= → status y, si se publicó, el permalink de cada cuenta.
  async function estadoPost(office, id) {
    const d = await call(office, 'GET', 'schedule.php', { query: { action: 'get', id } });
    const results = d?.results && typeof d.results === 'object' ? d.results : {};
    return {
      status: d?.status || null, stage: d?.stage || null, scheduled_at: d?.scheduled_at || null,
      permalinks: Object.values(results).map(r => r?.permalink).filter(u => /^https?:\/\//.test(String(u || ''))).slice(0, 10),
      error: d?.error_message || null, revisado: new Date().toISOString(),
    };
  }

  return { estado, setToken, removeToken, cuenta, destinos, investigar, subir, publicar, stats, buscar, editLog, estadoPost, call, hasToken: o => !!readToken(o) };
}

module.exports = { createViralHunt, baseUrl, explain, REAL_BASE, TOKEN_RE };
