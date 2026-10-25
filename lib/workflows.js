// Modos de trabajo de una misión: cómo se reparten el trabajo los agentes.
//  - relevo:  uno detrás de otro sobre el mismo proyecto (el ciclo clásico, ver lib/cycle.js).
//  - delphi:  todos hacen su borrador a la vez y luego se rotan los borradores para mejorarlos sin saber de quién son.
//  - consejo: todos proponen a la vez, se califican entre sí y un presidente redacta la versión final.
// Aquí solo hay lógica pura (sin procesos ni disco): la usa server.js y la prueban tests/workflows.test.js.

const { t, getLang } = require('./i18n');
const DEFINITIONS = [
  {
    "id": "relevo",
    "icon": "🔁",
    "name": "workflow.relevo.name",
    "tagline": "workflow.relevo.tagline",
    "explain": "workflow.relevo.explain",
    "ideal": "workflow.relevo.ideal",
    "careful": "workflow.relevo.careful",
    "roundsLabel": "workflow.relevo.roundsLabel"
  },
  {
    "id": "delphi",
    "icon": "⚡",
    "name": "workflow.delphi.name",
    "alias": "workflow.delphi.alias",
    "tagline": "workflow.delphi.tagline",
    "explain": "workflow.delphi.explain",
    "ideal": "workflow.delphi.ideal",
    "careful": "workflow.delphi.careful",
    "roundsLabel": "workflow.delphi.roundsLabel"
  },
  {
    "id": "consejo",
    "icon": "🏛️",
    "name": "workflow.consejo.name",
    "tagline": "workflow.consejo.tagline",
    "explain": "workflow.consejo.explain",
    "ideal": "workflow.consejo.ideal",
    "careful": "workflow.consejo.careful",
    "roundsLabel": "workflow.consejo.roundsLabel"
  }
];
function allWorkflows(lang = getLang()) {
 return DEFINITIONS.map(w => Object.fromEntries(Object.entries(w).map(([key,value]) => [key, key === 'id' || key === 'icon' ? value : t(value, {}, lang)])));
}

const IDS = DEFINITIONS.map(w => w.id);
const DEFAULT_PARALLEL = 2; // la PC del usuario se quedó sin memoria con varias CLIs a la vez

function normalizeWorkflow(input = {}, team = []) {
  const workflow = IDS.includes(input.workflow) ? input.workflow : 'relevo';
  const ids = team.map(t => t.id);
  const chair = ids.includes(input.chair) ? input.chair : ids[0] || null;
  let maxParallel = Math.round(Number(input.maxParallel)) || DEFAULT_PARALLEL;
  maxParallel = Math.min(Math.max(maxParallel, 1), Math.max(ids.length, 1));
  return { workflow, chair: workflow === 'consejo' ? chair : null, maxParallel };
}

// Sugerencia según el texto del pedido. El usuario decide; esto solo marca una tarjeta.
const HINTS = {
  relevo: /\b(c[oó]digo|app|aplicaci[oó]n|programa|script|bug|error|web|p[aá]gina|api|base de datos|refactor|test|funci[oó]n|instala|arregla)\w*/gi,
  delphi: /\b(investiga|investigaci[oó]n|compara|comparativa|verifica|datos|fuentes|estudio|ciencia|cient[ií]fic|noticia|an[aá]lisis|analiza|mercado|tendencia|informe)\w*/gi,
  consejo: /\b(post|publicaci[oó]n|hook|gancho|guion|gui[oó]n|t[ií]tulo|blog|art[ií]culo|newsletter|copy|eslogan|slogan|nota|caption|tweet|hilo|reel|tiktok|linkedin|instagram|viral)\w*/gi,
};

function suggestWorkflow(text = '') {
  let best = null, bestN = 0;
  for (const [id, re] of Object.entries(HINTS)) {
    const n = (String(text).match(re) || []).length;
    if (n > bestN) { best = id; bestN = n; }
  }
  return best;
}

// Letras anónimas para los borradores. Se barajan con una semilla (el ciclo) para que la letra no delate
// el orden del equipo; la tabla letra→agente la guarda el servidor y los agentes no la ven.
function anonymize(ids, seed = 1) {
  const order = [...ids];
  let s = (Number(seed) % 2147483647) || 1;
  const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const map = {};
  order.forEach((id, i) => { map[String.fromCharCode(65 + i)] = id; });
  return map; // { A: 'gemini', B: 'claude', … }
}

const letterOf = (map, id) => Object.keys(map).find(l => map[l] === id) || null;

// Rotación: en la ronda r cada revisor recibe el borrador que está r puestos más allá del suyo, saltando el propio.
// Con n borradores, en n-1 rondas cada borrador pasa por todos los demás; después la rotación vuelve a empezar.
function rotation(reviewers, drafts, ownerOf, round) {
  if (!drafts.length) return [];
  const n = drafts.length;
  const step = n > 1 ? ((round - 1) % (n - 1)) + 1 : 0;
  const taken = new Set();
  const out = [];
  reviewers.forEach((rev, i) => {
    const own = drafts.findIndex(d => ownerOf(d) === rev);
    const start = own === -1 ? i : own;
    for (let k = 0; k < n; k++) {
      const d = drafts[(start + step + k) % n];
      if (ownerOf(d) === rev && n > 1) continue;
      if (taken.has(d) && taken.size < n) continue; // reparte: dos revisores no editan el mismo borrador si se puede evitar
      taken.add(d);
      out.push({ reviewer: rev, draft: d });
      break;
    }
  });
  return out;
}

// "PUNTAJES:" en el reporte de evaluación del consejo: "- A: 8/10 porque…" → { A: 8 }
function parseRatings(text = '') {
  const lines = String(text).split(/\r?\n/);
  const out = {};
  let inside = false;
  for (const line of lines) {
    if (/^\s*(?:#{1,4}\s*)?\**\s*(?:PUNTAJES|SCORES)\b/i.test(line)) { inside = true; continue; }
    if (!inside) continue;
    if (/^\s*(?:#{1,4}\s*)?\**\s*(OBJECIONES|RESPUESTAS|NOTA|VEREDICTO|TERMINADO)\b/i.test(line)) break;
    const m = line.match(/^\s*(?:[-*•]\s*)?\**\s*(?:borrador\s+)?([A-Z])\**\s*[:=\-–—]\s*\**\s*(\d{1,2}(?:[.,]\d)?)\s*(?:\/\s*10)?/i);
    if (m) {
      const n = Number(m[2].replace(',', '.'));
      if (n >= 0 && n <= 10) out[m[1].toUpperCase()] = n;
    }
  }
  return out;
}

// Media de las notas que recibió cada borrador. Entradas: [{ draft: 'A', score: 8 }, …]
function averageByDraft(entries) {
  const acc = {};
  for (const e of entries) {
    if (typeof e.score !== 'number') continue;
    (acc[e.draft] ||= []).push(e.score);
  }
  const out = {};
  for (const [d, list] of Object.entries(acc)) out[d] = Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10;
  return out;
}

const bestDraft = averages => Object.entries(averages).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;

// Ejecuta tareas asíncronas con un máximo de "limit" a la vez, en orden. Devuelve los resultados en el mismo orden.
async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, worker));
  return results;
}

// Turnos previstos (para la barra de progreso).
function plannedTurns(workflow, n, rounds) {
  if (workflow === 'delphi') return n + rounds * n;
  if (workflow === 'consejo') return n + n + rounds * n; // borradores + evaluaciones + (síntesis + aprobaciones) por ronda
  return rounds * n;
}

module.exports = {
  get WORKFLOWS() { return allWorkflows(); }, allWorkflows, IDS, DEFAULT_PARALLEL, normalizeWorkflow, suggestWorkflow, anonymize, letterOf, rotation,
  parseRatings, averageByDraft, bestDraft, pool, plannedTurns,
};
