// Configuración de cada ciclo (se elige al crear la tarea) y la regla que decide cuándo termina.

const { templateById } = require('./templates');
const { normalizeWorkflow } = require('./workflows');

const { t, getLang } = require('./i18n');

const MODES = ['rondas', 'auto'];

// Mezcla lo que pide el usuario con agents.json. El equipo respeta el orden elegido y los roles personalizados.
function normalizeCycleConfig(input = {}, global = {}) {
  const agents = global.agents || [];
  const mode = MODES.includes(input.mode) ? input.mode : 'rondas';
  const cap = Number(global.autoMaxRounds) || 6;
  let maxRounds = Math.round(Number(input.maxRounds)) || (mode === 'auto' ? cap : Number(global.maxRounds) || 3);
  maxRounds = Math.min(Math.max(maxRounds, 1), 20);
  let minScore = Number(input.minScore) || Number(global.minScore) || 9;
  minScore = Math.min(Math.max(minScore, 1), 10);

  let team;
  if (Array.isArray(input.team) && input.team.length) {
    team = input.team
      .map(t => {
        const base = agents.find(a => a.id === (t.id || t));
        if (!base) return null;
        const role = typeof t.role === 'string' && t.role.trim() ? t.role.trim().slice(0, 60) : base.role;
        return { id: base.id, role };
      })
      .filter(Boolean)
      .filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i);
  }
  if (!team || !team.length) team = agents.filter(a => a.enabled !== false).map(a => ({ id: a.id, role: a.role }));
  const template = templateById(input.template) ? input.template : null;
  return { mode, maxRounds, minScore, team, template, ...normalizeWorkflow(input, team) };
}

// Un APROBADO solo cuenta si hay nota >= mínima, no cambió trabajo y no plantea objeciones.
// Sin nota no es ">= mínima": antes se colaba y podía cerrar el ciclo.
function judgeVerdict({ verdict, score, minScore, changedWork = [], objections = [] }) {
  if (verdict !== 'APROBADO') return { verdict, downgraded: null };
  let downgraded = null;
  if (score == null || score < minScore) downgraded = score == null ? t('cycle.noScore', {}) : t('cycle.lowScore', { score, minScore });
  else if (changedWork.length) downgraded = t('cycle.changed', { count: changedWork.length, files: changedWork.slice(0, 3).join(', ') });
  else if (objections.length) downgraded = t('cycle.newObjections', {});
  return { verdict: downgraded ? 'CAMBIOS' : verdict, downgraded };
}

// Decide si el ciclo terminó. "streak" son los turnos consecutivos más recientes de agentes activos.
//  - rondas: todos los activos aprueban seguidos (APROBADO = no cambió nada y nota >= mínima).
//  - auto: además vale que todos digan seguidos "TERMINADO: SÍ" con nota >= mínima, aunque hayan pulido algo menor.
//  En ambos modos, no se cierra con objeciones abiertas o disputadas.
function cycleOutcome({ mode, approvalsInRow, doneInRow, activeCount, blockingObjections }) {
  if (!activeCount) return { finished: true, reason: 'sin-agentes' };
  if (blockingObjections > 0) return { finished: false };
  if (approvalsInRow >= activeCount) return { finished: true, reason: 'unanime' };
  if (mode === 'auto' && doneInRow >= activeCount) return { finished: true, reason: 'consenso' };
  return { finished: false };
}

// Turnos que no cuentan como revisión: cortados (PARCIAL), caídos (ERROR) o sin nota válida.
const CUT = new Set(['ERROR', 'PARCIAL']);
const PLATEAU_DELTA = 0.5;

// Media de los revisores en una ronda, o null si la ronda no está completa: hacen falta `expected` turnos,
// ninguno cortado ni caído, y todos los que revisan con nota. La autonota (`self`) no entra en la media.
function roundMean(turns, round, expected) {
  const ts = turns.filter(t => t.round === round);
  if (!ts.length || ts.length < expected || ts.some(t => CUT.has(t.verdict))) return null;
  const reviews = ts.filter(t => !t.self);
  if (!reviews.length || reviews.some(t => typeof t.score !== 'number')) return null;
  return Math.round(reviews.reduce((s, t) => s + t.score, 0) / reviews.length * 100) / 100;
}

// Detener sin aprobar (D46). Compara las dos últimas rondas completas y seguidas:
//  - retroceso: la media de los revisores bajó PLATEAU_DELTA o más;
//  - meseta: se movió menos de PLATEAU_DELTA en cualquier sentido.
// No mira objeciones: detener no es aprobar, y las abiertas quedan a la vista en el resumen.
// Una intervención del usuario en cualquiera de las dos rondas anula la comparación (cambió el pedido).
function plateauOutcome({ turns = [], round, expected, intervenedRounds = [], delta = PLATEAU_DELTA }) {
  if (!(round >= 2) || !(expected > 0)) return null;
  if (intervenedRounds.includes(round) || intervenedRounds.includes(round - 1)) return null;
  const prev = roundMean(turns, round - 1, expected);
  const last = roundMean(turns, round, expected);
  if (prev == null || last == null) return null;
  const change = Math.round((last - prev) * 100) / 100;
  if (change <= -delta) return { finished: true, reason: 'retroceso', prev, last, change, rounds: [round - 1, round] };
  if (Math.abs(change) < delta) return { finished: true, reason: 'meseta', prev, last, change, rounds: [round - 1, round] };
  return null;
}

// Format scores with the selected language, without changing numeric cycle decisions.
function plateauSummary(p, { open = 0 } = {}) {
  const [a, b] = p.rounds;
  const fmt = n => String(n).replace('.', getLang() === 'es' ? ',' : '.');
  return t(p.reason === 'retroceso' ? 'cycle.regression' : 'cycle.plateau', {
    a, b, prev: fmt(p.prev), last: fmt(p.last), objections: open ? t('cycle.open', { open }) : '',
  });
}

module.exports = { normalizeCycleConfig, cycleOutcome, judgeVerdict, plateauOutcome, plateauSummary, roundMean, PLATEAU_DELTA, MODES };
