// Hilo de discusión entre agentes. Una objeción se resuelve con argumentos, no sobrescribiendo:
//
//   abierta ──(otro: RESUELTA)──────────────► resuelta
//      │    ──(otro: RECHAZADA + porqué)────► disputada ──(autor: RETIRADA)──► retirada
//      │                                         └────────(autor: MANTENIDA)─► abierta (los demás deben volver a responder)
//      └──(autor: RETIRADA)─────────────────► retirada
//
// "apoyo" (DE ACUERDO) añade la respuesta al hilo sin cambiar el estado.
// Mientras haya objeciones abiertas o disputadas, el ciclo no puede cerrarse como "impecable".

const { t } = require('./i18n');

const OPEN = new Set(['abierta', 'disputada']);

function isOpen(o) { return OPEN.has(o.status); }

function addObjections(debate, { agentId, agentName, round, cycle }, texts) {
  let next = debate.reduce((max, o) => Math.max(max, o.id), 0) + 1;
  const created = [];
  for (const text of texts) {
    const dup = debate.find(o => isOpen(o) && o.text.trim().toLowerCase() === text.trim().toLowerCase());
    if (dup) continue;
    const o = { id: next++, by: agentId, byName: agentName, round, cycle, ts: new Date().toISOString(), text, status: 'abierta', replies: [] };
    debate.push(o);
    created.push(o);
  }
  return created;
}

// Aplica las respuestas de un agente. Devuelve las que se aplicaron y las ignoradas (con el motivo).
function applyReplies(debate, { agentId, agentName, round }, replies) {
  const applied = [], ignored = [];
  for (const r of replies) {
    const o = debate.find(x => x.id === r.id);
    if (!o) { ignored.push({ ...r, reason: t('debate.ignored.missing') }); continue; }
    const isAuthor = o.by === agentId;
    let status = o.status;
    if (r.stance === 'resuelta' && !isAuthor) status = 'resuelta';
    else if (r.stance === 'resuelta' && isAuthor) status = 'retirada'; // el autor da por buena la solución
    else if (r.stance === 'rechazada' && !isAuthor) status = 'disputada';
    else if (r.stance === 'retirada' && isAuthor) status = 'retirada';
    else if (r.stance === 'mantenida' && isAuthor) status = 'abierta';
    else if (r.stance !== 'apoyo') { ignored.push({ ...r, reason: isAuthor ? t('debate.ignored.author') : t('debate.ignored.onlyAuthor') }); continue; }
    o.replies.push({ by: agentId, byName: agentName, round, ts: new Date().toISOString(), stance: r.stance, text: r.text });
    o.status = status;
    applied.push(r);
  }
  return { applied, ignored };
}

// Lo que un agente debe responder en su turno: objeciones abiertas de otros y disputas sobre las suyas.
function pendingFor(debate, agentId) {
  return debate.filter(o => (o.status === 'abierta' && o.by !== agentId) ||
    (o.status === 'disputada' && (o.by === agentId || o.by === 'user')));
}

// Clasificación de objeciones por restricción de entorno (sandbox, permisos, etc.)
// Directiva del dueño: no se cuentan como objeciones de producto.
// Solo una restricción atribuida al ejecutor permite excluir la objeción.
// «Permisos», EPERM o Access denied también pueden describir un defecto real del producto.
const ENV_BLOCK_RE = /sandbox (?:de |del agente|del ejecutor)|en (?:su|mi|este) sandbox|restricci[oó]n (?:del? |de su )?entorno|ejecutor restringido|(?:solo falla|falla solo) (?:en (?:mi|su|este) (?:entorno|ejecutor|sandbox)|all[ií])|(?:limitaci[oó]n|restricci[oó]n|bloqueo) (?:local |de permisos )?(?:del agente|del ejecutor)|(?:in|inside) (?:my|its|their|this|the agent'?s?|the runner'?s?) sandbox|(?:agent|runner)'?s? sandbox|(?:runner|executor|environment) (?:restriction|limitation)|restricted (?:runner|executor|environment)|only fails (?:in|on) (?:my|its|their|this) (?:environment|runner|executor|sandbox|machine)|(?:limitation|restriction|block) of the (?:agent|runner|executor)/i;

function isEnvironmentBlock(o) {
  if (!o) return false;
  if (typeof o === 'object' && typeof o.bloqueoEntorno === 'boolean') return o.bloqueoEntorno;
  return ENV_BLOCK_RE.test(typeof o === 'string' ? o : o.text || '');
}

// Objeciones que bloquean el cierre: abiertas o disputadas cuyo autor sigue activo en el ciclo,
// o abiertas planteadas directamente por el usuario ("user").
// Si excludeEnvironment es true, los bloqueos exclusivos del entorno del agente no bloquean la aprobación del producto.
function blocking(debate, activeIds, { excludeEnvironment = false } = {}) {
  const open = (debate || []).filter(o => isOpen(o) && (o.by === 'user' || !activeIds || activeIds.includes(o.by)));
  if (!excludeEnvironment) return open;
  return open.filter(o => !isEnvironmentBlock(o));
}

// Permite al usuario cambiar el estado de una objeción desde la interfaz (resolver, retirar o reabrir).
function setObjectionStatus(debate, id, status, { by = 'user', byName = 'Usuario', text = '' } = {}) {
  const valid = new Set(['abierta', 'resuelta', 'retirada']);
  if (!valid.has(status)) return null;
  const o = debate.find(x => x.id === Number(id));
  if (!o) return null;
  o.status = status;
  const stance = status === 'abierta' ? 'mantenida' : status;
  o.replies.push({ by, byName, round: o.round, ts: new Date().toISOString(), stance, text: text.trim() || t('debate.markedAs', { status: t(`debate.status.${status}`), name: byName }) });
  return o;
}

module.exports = { addObjections, applyReplies, pendingFor, blocking, isOpen, setObjectionStatus, isEnvironmentBlock };
