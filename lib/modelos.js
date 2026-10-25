// Modelos de reserva por agente. Si la CLI dice que se acabó la cuota del modelo (429, RESOURCE_EXHAUSTED, límite de
// uso…), ese modelo se marca agotado unas horas y el MISMO turno se repite con el siguiente de la lista.
// En agents.json:  "models": ["gemini-4-argon-high", "gemini-3.8-flash-high"], "modelFlag": "--model"
//                  "modelCooldownHours": 12   (opcional: cuánto se da por agotado antes de volver a intentarlo)
// Los agotados se guardan en <datos>/.cuotas.json para que un reinicio no los vuelva a probar uno a uno.
const fs = require('fs');

const QUOTA_KINDS = new Set(['limite', 'saldo']);

function createModels(file) {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(state, null, 2)); } catch {} };
  const key = (agent, model) => `${agent.id}:${model}`;
  const listOf = agent => (Array.isArray(agent.models) ? agent.models.filter(m => typeof m === 'string' && m.trim()) : []);
  const exhaustedUntil = (agent, model, now = Date.now()) => (state[key(agent, model)] > now ? state[key(agent, model)] : 0);

  // El primer modelo de la lista que no esté agotado (null si el agente no tiene lista: se usa lo que diga su CLI).
  // Si todos están agotados, el que antes se libera: así al menos se intenta.
  function pick(agent, now = Date.now()) {
    const list = listOf(agent);
    if (!list.length) return null;
    return list.find(m => !exhaustedUntil(agent, m, now)) || [...list].sort((a, b) => state[key(agent, a)] - state[key(agent, b)])[0];
  }

  // Marca el modelo como agotado y devuelve el siguiente disponible, o null si no queda ninguno.
  function exhaust(agent, model, now = Date.now()) {
    state[key(agent, model)] = now + (Number(agent.modelCooldownHours) || 12) * 3600e3;
    save();
    return listOf(agent).find(m => !exhaustedUntil(agent, m, now)) || null;
  }

  // Los argumentos de la CLI con el modelo elegido (sustituye un --model que ya viniera en args).
  function argsFor(agent, model) {
    const flag = agent.modelFlag || '--model';
    const args = [...agent.args];
    if (!model) return args;
    const i = args.indexOf(flag);
    if (i !== -1) args.splice(i, 2);
    return [...args, flag, model];
  }

  const status = agent => listOf(agent).map(m => ({ model: m, exhaustedUntil: exhaustedUntil(agent, m) || null }));

  return { pick, exhaust, argsFor, status, isQuota: failure => !!failure && QUOTA_KINDS.has(failure.kind) };
}

module.exports = { createModels };
