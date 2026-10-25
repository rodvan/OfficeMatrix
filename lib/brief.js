// Agent instructions share the browser/server dictionaries. The request language wins over the UI language.
const { templateBrief } = require('./templates');
const { diffsSinceLastTurn, projectFileMap, assembleContext } = require('./contexto');
const { t, detectLang, getLang } = require('./i18n');

function translator(chat) {
  const requests = chat.messages.filter(m => m.kind === 'user' && !m.intervention);
  const current = requests.at(-1);
  const lang = detectLang(current?.text, getLang());
  return { requests, current, lang, tr: (key, vars = {}) => t(`brief.${key}`, vars, lang) };
}
const truncate = (s, n, tr) => s && s.length > n ? s.slice(0, n) + tr('clipped') : s || '';

function interventionsBlock(chat, cycle, tr) {
  const list = chat.messages.filter(m => m.kind === 'user' && m.intervention && (!m.cycle || m.cycle === cycle));
  return list.length ? '\n\n' + tr('interventions') + '\n' + list.map((m, i) => `${i + 1}. ${truncate(m.text, 600, tr)}`).join('\n') : '';
}
// La ficha y la marca llegan ya escritas en cada idioma (lib/empleados.js): se usa la del idioma del brief.
function staffBlock(agent, tr, lang) {
  if (!agent?.empleado) return '';
  const o = agent.oficina || {};
  const marca = o.marcas?.[lang] ?? o.marca;
  return tr('staff', { office: o.nombre || o.id, profile: agent.empleado.fichas?.[lang] ?? agent.empleado.ficha,
    brand: marca ? '\n' + tr('brand', { brand: marca }) + '\n' : '' });
}
function partialBlock(chat, agent, info, tr) {
  const turns = chat.messages.filter(m => m.kind === 'agent' && m.cycle === info.cycle);
  let since = 0;
  turns.forEach((m, i) => { if (m.agentId === agent.id) since = i + 1; });
  const cut = turns.slice(since).filter(m => m.verdict === 'PARCIAL');
  if (!cut.length) return '';
  const lines = cut.map(m => {
    const files = m.workFiles?.length ? m.workFiles : m.files || [];
    return tr('partialLine', { name: m.agentName, round: m.round, reason: (m.failure?.label || tr('time')).toLowerCase(),
      files: files.slice(0, 15).map(f => `\`${f}\``).join(', ') + (files.length > 15 ? '…' : '') });
  }).join('\n');
  return '\n' + tr('partial', { lines });
}
function handoffExcerpt(handoff, tr) {
  const text = String(handoff || '');
  const i = text.search(/^## (?:Último traspaso|Latest handoff)/m);
  return truncate(i >= 0 ? text.slice(i) : text, 1200, tr) || tr('noHandoff');
}
function officeHistoryBlock(previas, tr) {
  if (!previas?.length) return '';
  const lines = previas.map(p => tr('historyLine', { day: p.dia, title: p.titulo, icon: p.icono, text: p.texto,
    score: p.nota != null ? tr('mean', { score: p.nota }) : '', next: p.siguiente ? tr('next', { next: p.siguiente }) : '' })).join('\n');
  return '\n' + tr('history', { lines });
}
function relevantBlock(relevant, tr, short = true) {
  return relevant.length ? relevant.slice(0, short ? 6 : relevant.length).map(e => {
    const text = short ? truncate(String(e.text || ''), 400, tr) : String(e.text || '');
    return `- **${e.file}** › ${e.heading || '(general)'}:\n${text.split('\n').map(l => '  > ' + l).join('\n')}`;
  }).join('\n') : tr('noMemory');
}

function buildTurnBrief({ chat, agent, team, info, memoryDir, memoryFiles = [], relevant = [], handoff = '', pending = [], openCount = 0, projectDir = null, previas = [] }) {
  const { requests, current, lang, tr } = translator(chat);
  const previous = requests.slice(0, -1).slice(-6).map((m, i) => `${i + 1}. ${truncate(m.text, 400, tr)}`).join('\n') || tr('none');
  const auto = info.mode === 'auto';
  const pendingText = pending.length ? pending.slice(0, 12).map(o => {
    const thread = (o.replies || []).slice(-4).map(r => `    - ${r.byName} [${r.stance}]: ${truncate(r.text, 300, tr)}`).join('\n');
    return tr('objection', { id: o.id, name: o.byName, round: o.round, status: o.status,
      text: truncate(o.text, 500, tr), thread: thread ? thread + '\n' : '', ask: tr(o.by === agent.id ? 'ownObjection' : 'otherObjection') });
  }).join('\n') : tr('noPending');
  const template = templateBrief(chat.config?.template, lang);
  const prefix = tr('prefix', { staff: staffBlock(agent, tr, lang), name: agent.name, role: agent.role,
    colleagues: tr(agent.empleado ? 'colleagues' : 'ais'), order: team.map(a => `${a.name} (${a.role})`).join(' → '),
    mode: tr(auto ? 'auto' : 'rounds', info), minScore: info.minScore,
    protocol: tr('protocol', { done: auto ? tr('done') : '' }), doneRule: auto ? tr('doneRule') : '',
    template: template ? '\n' + template + '\n' : '' });
  const head = tr('head', { ...info, openCount, name: agent.name, request: current?.text || tr('noRequest'),
    interventions: interventionsBlock(chat, info.cycle, tr), previous,
    changes: diffsSinceLastTurn(chat.messages, agent.id, lang), partial: partialBlock(chat, agent, info, tr), pending: pendingText,
    handoffFormat: tr('handoffFormat', { name: agent.name, round: info.round }), memoryDir });
  const tail = tr('tail', { handoff: handoffExcerpt(handoff, tr), history: officeHistoryBlock(previas, tr),
    fileMap: projectDir ? projectFileMap(projectDir, 40, lang) : tr('noMap'),
    memoryFiles: memoryFiles.join(', ') || tr('empty'), relevant: relevantBlock(relevant, tr) });
  return assembleContext(prefix, head, tail, undefined, lang);
}

const PHASE_KEYS = { borrador: 'phaseDraft', revision: 'phaseReview', evaluacion: 'phaseEvaluate', sintesis: 'phaseSynthesis', aprobacion: 'phaseApproval' };
// Se lee en cada acceso: un objeto congelado al importar se quedaría en el idioma del arranque.
const PHASES = Object.defineProperties({}, Object.fromEntries(Object.entries(PHASE_KEYS).map(([id, key]) => [id, {
  enumerable: true, get() { return t(`brief.${key}`); },
}])));

function buildParallelBrief({ chat, agent, info, phase, folder, target, drafts = [], feedback = '', memoryDir, memoryFiles = [], relevant = [] }) {
  const { requests, current, lang, tr } = translator(chat);
  const draftList = list => list.map(d => tr('draftLine', d)).join('\n') || tr('none');
  const others = drafts.filter(d => d.folder !== folder);
  const vars = { ...info, phase: tr(PHASE_KEYS[phase]), folder, target: target?.folder || '', letter: target?.letter || '', memoryDir,
    drafts: draftList(phase === 'sintesis' ? drafts : phase === 'revision' ? others.filter(d => d.folder !== target?.folder) : others),
    instructions: tr(info.round === 1 ? 'synthesisFirst' : 'synthesisNext', info) };
  const taskKeys = { borrador: 'parallelDraft', revision: 'parallelReview', evaluacion: 'parallelEvaluate', sintesis: 'parallelSynthesis', aprobacion: 'parallelApproval' };
  const ruleKeys = { borrador: 'ruleDraft', revision: 'ruleReview', evaluacion: 'ruleEvaluate', sintesis: 'ruleSynthesis', aprobacion: 'ruleApproval' };
  return tr('parallel', { ...vars, name: agent.name, role: agent.role, staff: staffBlock(agent, tr, lang), phaseId: phase,
    workflow: info.workflow === 'consejo' ? t('workflow.council', {}, lang) : t('workflow.delphi', {}, lang),
    roundLabel: phase === 'borrador' || phase === 'evaluacion' ? '' : tr('roundLabel', info),
    request: current?.text || tr('noRequest'), interventions: interventionsBlock(chat, info.cycle, tr),
    previous: requests.slice(0, -1).map((m, i) => `${i + 1}. ${truncate(m.text, 600, tr)}`).join('\n') || tr('none'),
    template: templateBrief(chat.config?.template, lang), task: tr(taskKeys[phase], vars),
    feedback: feedback ? tr('feedback', { feedback }) : '', ownership: tr(phase === 'sintesis' ? 'chairOwns' : 'sharedOwns'),
    memoryFiles: memoryFiles.join(', ') || tr('empty'), relevant: relevantBlock(relevant, tr, false),
    scores: phase === 'evaluacion' ? tr('scores') : '', protocol: tr('protocol', { done: '' }), verdictRule: tr(ruleKeys[phase], vars) });
}

module.exports = { buildTurnBrief, buildParallelBrief, PHASES };
