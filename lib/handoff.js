// HANDOFF.md: traspaso estructurado entre turnos. Tiene dos partes:
//  1. Un bloque de estado que escribe OfficeMatrix después de cada turno (siempre al día, aunque un agente se olvide).
//  2. El "Último traspaso", que escribe el agente: qué hizo, decisiones y por qué, objeciones abiertas y siguiente paso.

const START = '<!-- officematrix:estado -->';
const END = '<!-- /officematrix:estado -->';

const { t, getLang } = require('./i18n');

// La plantilla, el bloque de estado y los nombres de sección salen en el idioma pedido (por defecto, el del servidor).
// Los lectores (agentHandoff, handoffQuality, siguientePaso en lib/hoy.js) aceptan los dos idiomas.
function handoffTemplate(lang = getLang()) {
  const sec = k => `**${t(`handoff.sec.${k}`, null, lang)}:**`;
  return `# HANDOFF

${t('handoff.intro', null, lang)}

${START}
${END}

## ${t('handoff.latest', null, lang)}

**${t('handoff.from', null, lang)}:** ${t('handoff.nobody', null, lang)}

${sec('did')}

${sec('why')}

${sec('objections')}

${sec('next')}
`;
}

const SECTION_KEYS = ['did', 'why', 'objections', 'next'];
const sectionNames = lang => SECTION_KEYS.map(k => t(`handoff.sec.${k}`, null, lang));

function statusBlock({ chatTitle, mode, round, maxRounds, turns = [], openObjections = [], updated = new Date(), lang = getLang() }) {
  const tr = (k, v) => t(k, v, lang);
  const label = (prefix, v) => { const s = tr(`${prefix}.${v}`); return s === `${prefix}.${v}` ? v : s; };
  const rows = turns.slice(-8).map(x =>
    `| ${x.round} | ${x.agentName} | ${x.score ?? '–'} | ${label('handoff.verdict', x.verdict)} | ${(x.files || []).length} | ${x.seconds ?? 0}s |`);
  return [
    START,
    tr('handoff.statusTitle'),
    '',
    tr('handoff.task', { title: chatTitle }),
    tr('handoff.modeLine', { mode: mode === 'auto' ? tr('handoff.modeAuto', { max: maxRounds }) : tr('handoff.modeRounds', { max: maxRounds }), round: round ?? '–' }),
    tr('handoff.updated', { when: updated.toISOString().replace('T', ' ').slice(0, 16) }),
    '',
    rows.length ? tr('handoff.tableHead') + '\n|---|---|---|---|---|---|\n' + rows.join('\n') : tr('handoff.noTurns'),
    '',
    tr('handoff.openObjections', { none: openObjections.length ? '' : tr('handoff.none') }),
    ...openObjections.map(o => `- #${o.id} (${o.byName}, ${label('handoff.status', o.status)}): ${o.text}`),
    END,
  ].join('\n');
}

function upsertStatus(content, block, lang = getLang()) {
  const text = content && content.trim() ? content : handoffTemplate(lang);
  const s = text.indexOf(START), e = text.indexOf(END);
  if (s !== -1 && e > s) return text.slice(0, s) + block + text.slice(e + END.length);
  // Sin marcadores: el bloque va después del título.
  const lines = text.split('\n');
  const at = /^#\s/.test(lines[0]) ? 1 : 0;
  lines.splice(at, 0, '', block, '');
  return lines.join('\n');
}

// Extrae el traspaso del agente (sin el bloque automático), para guardarlo con su turno.
function agentHandoff(content) {
  if (!content) return '';
  const s = content.indexOf(START), e = content.indexOf(END);
  const rest = s !== -1 && e > s ? content.slice(0, s) + content.slice(e + END.length) : content;
  const i = rest.search(/^##\s+(?:Último traspaso|Latest handoff)/im);
  return (i === -1 ? rest : rest.slice(i)).trim();
}

// ¿Tiene el traspaso las cuatro secciones con contenido?
// Devuelve las secciones que faltan con su nombre en `lang`; acepta los títulos en cualquier idioma.
function handoffQuality(text, lang = getLang()) {
  const names = { en: sectionNames('en'), es: sectionNames('es') };
  const missing = sectionNames(lang).filter((sec, i) => {
    // [ \t]* y no \s*: con \s* se comía el salto de línea y una sección vacía "capturaba" el título siguiente.
    const m = text.match(new RegExp(`\\*\\*(?:${names.en[i]}|${names.es[i]}):?\\*\\*:?[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*\\*\\*[^*\\n]+\\*\\*|\\n##|$)`, 'i'));
    return !m || !m[1].trim();
  });
  return { complete: missing.length === 0, missing };
}

module.exports = {
  get HANDOFF_TEMPLATE() { return handoffTemplate(); },
  get HANDOFF_SECTIONS() { return sectionNames(getLang()); },
  handoffTemplate, statusBlock, upsertStatus, agentHandoff, handoffQuality };
