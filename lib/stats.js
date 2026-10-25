// "Cómo actúa cada uno": métricas por agente a partir de los turnos guardados en el chat.
const { isBookkeeping } = require('./snapshot');
const { t } = require('./i18n');

// HANDOFF, MEMORIA, el cerebro y la discusión no son el trabajo: si cuentan, el expediente
// dice que todos "tocan" los mismos archivos de contabilidad.
function workFilesOf(message) {
  if (Array.isArray(message.workFiles)) return message.workFiles;
  return (message.files || []).filter(f => !isBookkeeping(f));
}

function emptyStats(agent) {
  return {
    id: agent.id, name: agent.name, color: agent.color, role: agent.role,
    turns: 0, scored: 0, scoreSum: 0, avgScore: null, lastScore: null, scores: [],
    approvals: 0, changes: 0, errors: 0, noVerdict: 0, downgraded: 0,
    seconds: 0, avgSeconds: 0, files: new Map(), filesTouched: 0, topFiles: [],
    tools: {}, toolErrors: 0, handoffs: 0, handoffMissing: 0,
    tokens: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, avgTokens: 0, costUsd: 0,
    objectionsRaised: 0, objectionsResolvedByOthers: 0, repliesGiven: 0, rejections: 0,
    traits: [],
  };
}

function computeAgentStats(messages, agents, debate = []) {
  const byId = new Map(agents.map(a => [a.id, emptyStats(a)]));
  const get = (id, name) => {
    if (!byId.has(id)) byId.set(id, emptyStats({ id, name: name || id, color: '#888', role: '' }));
    return byId.get(id);
  };

  for (const m of messages) {
    if (m.kind !== 'agent') continue;
    const s = get(m.agentId, m.agentName);
    s.turns++;
    s.seconds += m.seconds || 0;
    if (m.verdict === 'APROBADO') s.approvals++;
    else if (m.verdict === 'CAMBIOS') s.changes++;
    else if (m.verdict === 'ERROR' || m.verdict === 'PARCIAL') s.errors++; // PARCIAL: cortado, el fallo se registra (D47)
    else if (m.verdict === 'SIN_VEREDICTO') s.noVerdict++;
    if (m.downgraded) s.downgraded++;
    if (typeof m.score === 'number') {
      s.scored++; s.scoreSum += m.score; s.lastScore = m.score; s.scores.push(m.score);
    }
    for (const f of workFilesOf(m)) s.files.set(f, (s.files.get(f) || 0) + 1);
    for (const [k, n] of Object.entries(m.toolCounts || {})) s.tools[k] = (s.tools[k] || 0) + n;
    s.toolErrors += m.toolErrors || 0;
    if (m.usage) {
      s.tokens += m.usage.totalTokens || 0;
      s.inputTokens += m.usage.inputTokens || 0;
      s.outputTokens += m.usage.outputTokens || 0;
      s.cachedTokens += m.usage.cachedTokens || 0;
      s.costUsd = Math.round((s.costUsd + (m.usage.costUsd || 0)) * 1e6) / 1e6;
    }
    // En los modos paralelos solo el presidente (síntesis) escribe el HANDOFF: el resto no "lo olvida".
    if (!['ERROR', 'PARCIAL'].includes(m.verdict) && (!m.phase || m.phase === 'sintesis')) {
      if (m.handoff) s.handoffs++; else s.handoffMissing++;
    }
  }

  for (const o of debate) {
    if (o.by && o.by !== 'user') {
      const author = get(o.by, o.byName);
      author.objectionsRaised++;
      if (o.status === 'resuelta') author.objectionsResolvedByOthers++;
    }
    for (const r of o.replies || []) {
      if (!r.by || r.by === 'user') continue;
      const s = get(r.by, r.byName);
      s.repliesGiven++;
      if (r.stance === 'rechazada') s.rejections++;
    }
  }

  const all = [...byId.values()];
  for (const s of all) {
    s.avgScore = s.scored ? Math.round((s.scoreSum / s.scored) * 10) / 10 : null;
    s.avgSeconds = s.turns ? Math.round(s.seconds / s.turns) : 0;
    s.avgTokens = s.turns && s.tokens ? Math.round(s.tokens / s.turns) : 0;
    s.filesTouched = s.files.size;
    s.topFiles = [...s.files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([file, n]) => ({ file, n }));
    delete s.files;
    s.traits = traits(s, all);
  }
  return all;
}

// Rasgos de "personalidad en la práctica", relativos al resto del equipo.
function traits(s, all) {
  if (!s.turns) return [t('stats.trait.noTurns')];
  const out = [];
  const scored = all.filter(x => x.avgScore != null);
  const teamAvg = scored.length ? scored.reduce((a, x) => a + x.avgScore, 0) / scored.length : null;
  if (s.avgScore != null && teamAvg != null && scored.length > 1) {
    if (s.avgScore <= teamAvg - 0.7) out.push(t('stats.trait.strict'));
    else if (s.avgScore >= teamAvg + 0.7) out.push(t('stats.trait.generous'));
  }
  if (s.turns >= 2 && s.approvals / s.turns >= 0.6) out.push(t('stats.trait.easyApprove'));
  if (s.turns >= 2 && s.changes / s.turns >= 0.8) out.push(t('stats.trait.alwaysChanges'));
  const avgFiles = s.filesTouched / s.turns;
  if (avgFiles >= 5) out.push(t('stats.trait.broad'));
  else if (s.turns >= 2 && avgFiles <= 1) out.push(t('stats.trait.surgical'));
  if (s.objectionsRaised >= 3) out.push(t('stats.trait.critical'));
  if (s.rejections >= 2) out.push(t('stats.trait.standsGround'));
  if (s.errors && s.errors / s.turns >= 0.3) out.push(t('stats.trait.unstable'));
  const team = all.filter(x => x.turns);
  const fastest = team.length > 1 ? Math.min(...team.map(x => x.avgSeconds)) : null;
  if (fastest != null && s.avgSeconds === fastest) out.push(t('stats.trait.fastest'));
  if ((s.tools.web || 0) >= 3) out.push(t('stats.trait.web'));
  if ((s.tools.cmd || 0) >= Math.max(5, (s.tools.write || 0) * 2)) out.push(t('stats.trait.runs'));
  if (s.handoffMissing && s.handoffMissing >= s.handoffs) out.push(t('stats.trait.forgetsHandoff'));
  return out.length ? out : [t('stats.trait.balanced')];
}

module.exports = { computeAgentStats };
