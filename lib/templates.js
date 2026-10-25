// Plantillas de misión: un punto de partida por tipo de tarea. Cada una trae un pedido guiado (campos a rellenar),
// una configuración de ciclo sugerida (modo, rondas, nota, equipo con orden y roles) y los criterios de calidad
// que el brief de cada turno recuerda a los agentes. El usuario puede cambiarlo todo antes de desplegar.

const { t: translate, getLang } = require('./i18n');
const DEFINITIONS = [
  {
    "id": "codigo",
    "name": "template.codigo.name",
    "icon": "⌘",
    "desc": "template.codigo.desc",
    "mode": "auto",
    "maxRounds": 4,
    "minScore": 9,
    "team": [
      {
        "id": "claude",
        "role": "template.codigo.role0"
      },
      {
        "id": "codex",
        "role": "template.codigo.role1"
      },
      {
        "id": "gemini",
        "role": "template.codigo.role2"
      },
      {
        "id": "grok",
        "role": "template.codigo.role3"
      }
    ],
    "skeleton": "template.codigo.skeleton",
    "criteria": [
      "template.codigo.criterion0",
      "template.codigo.criterion1",
      "template.codigo.criterion2",
      "template.codigo.criterion3"
    ],
    "output": "template.codigo.output"
  },
  {
    "id": "post-viral",
    "name": "template.post-viral.name",
    "icon": "✦",
    "desc": "template.post-viral.desc",
    "mode": "rondas",
    "maxRounds": 2,
    "minScore": 9,
    "team": [
      {
        "id": "gemini",
        "role": "template.post-viral.role0"
      },
      {
        "id": "claude",
        "role": "template.post-viral.role1"
      },
      {
        "id": "grok",
        "role": "template.post-viral.role2"
      },
      {
        "id": "codex",
        "role": "template.post-viral.role3"
      }
    ],
    "skeleton": "template.post-viral.skeleton",
    "criteria": [
      "template.post-viral.criterion0",
      "template.post-viral.criterion1",
      "template.post-viral.criterion2",
      "template.post-viral.criterion3"
    ],
    "output": "template.post-viral.output"
  },
  {
    "id": "guion",
    "name": "template.guion.name",
    "icon": "▶",
    "desc": "template.guion.desc",
    "mode": "rondas",
    "maxRounds": 3,
    "minScore": 9,
    "team": [
      {
        "id": "claude",
        "role": "template.guion.role0"
      },
      {
        "id": "gemini",
        "role": "template.guion.role1"
      },
      {
        "id": "grok",
        "role": "template.guion.role2"
      },
      {
        "id": "codex",
        "role": "template.guion.role3"
      }
    ],
    "skeleton": "template.guion.skeleton",
    "criteria": [
      "template.guion.criterion0",
      "template.guion.criterion1",
      "template.guion.criterion2",
      "template.guion.criterion3"
    ],
    "output": "template.guion.output"
  },
  {
    "id": "investigacion",
    "name": "template.investigacion.name",
    "icon": "⌕",
    "desc": "template.investigacion.desc",
    "mode": "auto",
    "maxRounds": 4,
    "minScore": 9,
    "team": [
      {
        "id": "gemini",
        "role": "template.investigacion.role0"
      },
      {
        "id": "claude",
        "role": "template.investigacion.role1"
      },
      {
        "id": "grok",
        "role": "template.investigacion.role2"
      },
      {
        "id": "codex",
        "role": "template.investigacion.role3"
      }
    ],
    "skeleton": "template.investigacion.skeleton",
    "criteria": [
      "template.investigacion.criterion0",
      "template.investigacion.criterion1",
      "template.investigacion.criterion2",
      "template.investigacion.criterion3"
    ],
    "output": "template.investigacion.output"
  },
  {
    "id": "estrategia",
    "name": "template.estrategia.name",
    "icon": "◈",
    "desc": "template.estrategia.desc",
    "mode": "auto",
    "maxRounds": 4,
    "minScore": 9,
    "team": [
      {
        "id": "claude",
        "role": "template.estrategia.role0"
      },
      {
        "id": "gemini",
        "role": "template.estrategia.role1"
      },
      {
        "id": "grok",
        "role": "template.estrategia.role2"
      },
      {
        "id": "codex",
        "role": "template.estrategia.role3"
      }
    ],
    "skeleton": "template.estrategia.skeleton",
    "criteria": [
      "template.estrategia.criterion0",
      "template.estrategia.criterion1",
      "template.estrategia.criterion2",
      "template.estrategia.criterion3"
    ],
    "output": "template.estrategia.output"
  },
  {
    "id": "documento",
    "name": "template.documento.name",
    "icon": "¶",
    "desc": "template.documento.desc",
    "mode": "rondas",
    "maxRounds": 3,
    "minScore": 9,
    "team": [
      {
        "id": "claude",
        "role": "template.documento.role0"
      },
      {
        "id": "gemini",
        "role": "template.documento.role1"
      },
      {
        "id": "codex",
        "role": "template.documento.role2"
      },
      {
        "id": "grok",
        "role": "template.documento.role3"
      }
    ],
    "skeleton": "template.documento.skeleton",
    "criteria": [
      "template.documento.criterion0",
      "template.documento.criterion1",
      "template.documento.criterion2",
      "template.documento.criterion3"
    ],
    "output": "template.documento.output"
  }
];

function builtInTemplates(lang = getLang()) {
  return DEFINITIONS.map(v => ({ ...v,
    name: translate(v.name, {}, lang), desc: translate(v.desc, {}, lang),
    skeleton: translate(v.skeleton, {}, lang), output: translate(v.output, {}, lang),
    team: v.team.map(a => ({ ...a, role: translate(a.role, {}, lang) })),
    criteria: v.criteria.map(key => translate(key, {}, lang)),
  }));
}

// Plantillas propias del usuario: se guardan desde la UI (plantillas.json, ver server.js) y conviven con las de serie.
// Llevan id "u-…" para que nunca pisen una de serie.
let custom = [];
const setCustomTemplates = list => { custom = Array.isArray(list) ? list : []; };
const allTemplates = (lang = getLang()) => [...builtInTemplates(lang), ...custom];
const templateById = (id, lang = getLang()) => allTemplates(lang).find(t => t.id === id) || null;

const slug = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// Valida lo que llega de la UI. Devuelve { template } o { error }. "agents" son los de agents.json (para el equipo).
function normalizeCustomTemplate(input = {}, agents = []) {
  const name = String(input.name || '').trim().slice(0, 40);
  if (name.length < 2) return { error: translate('template.nameRequired') };
  const id = `u-${slug(name)}`;
  if (id === 'u-') return { error: translate('template.nameLetters') };
  const lines = v => (Array.isArray(v) ? v : String(v || '').split('\n')).map(x => String(x).replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean);
  const team = (Array.isArray(input.team) ? input.team : [])
    .filter(t => agents.some(a => a.id === t?.id))
    .filter((t, i, arr) => arr.findIndex(x => x.id === t.id) === i)
    .map(t => ({ id: t.id, role: String(t.role || agents.find(a => a.id === t.id).role || '').trim().slice(0, 60) }));
  if (!team.length) return { error: translate('template.teamRequired') };
  const num = (v, lo, hi, d) => Math.min(Math.max(Math.round(Number(v)) || d, lo), hi);
  return {
    template: {
      id, name, custom: true,
      icon: String(input.icon || '★').trim().slice(0, 2) || '★',
      desc: String(input.desc || '').trim().slice(0, 120) || translate('template.custom'),
      mode: input.mode === 'auto' ? 'auto' : 'rondas',
      maxRounds: num(input.maxRounds, 1, 20, 3),
      minScore: num(input.minScore, 1, 10, 9),
      team,
      skeleton: String(input.skeleton || '').slice(0, 4000),
      criteria: lines(input.criteria).slice(0, 12).map(c => c.slice(0, 300)),
      output: String(input.output || '').trim().slice(0, 200),
      created: new Date().toISOString(),
    },
  };
}

// Bloque del brief con lo que define "bien hecho" para este tipo de misión.
function templateBrief(id, lang = getLang()) {
  const t = templateById(id, lang);
  if (!t) return '';
  return [
    translate('template.heading', { name: t.name }, lang),
    ...(t.criteria?.length ? [translate('template.quality', {}, lang), ...t.criteria.map(c => `- ${c}`)] : []),
    ...(t.output ? [translate('template.deliverable', { output: t.output }, lang)] : []),
  ].join('\n');
}

module.exports = { get TEMPLATES() { return builtInTemplates(); }, builtInTemplates, templateById, templateBrief, allTemplates, setCustomTemplates, normalizeCustomTemplate };
