#!/usr/bin/env node
// om: cliente de línea de comandos para que un agente externo trabaje con OfficeMatrix.
// Un solo archivo, sin dependencias (Node 18+). Se puede copiar a otra máquina.
// Configuración (variables de entorno):
//   OM_URL    dirección de OfficeMatrix: http://localhost:4321 en el mismo PC, o la de red (http://192.168.x.x:4322, lan.js)
//   OM_LLAVE  llave de agente de la oficina (om_<oficina>_…). Con ella solo se ve y se usa esa oficina.
//   OM_LANG   idioma de los mensajes: en (por defecto) o es.
// Los textos están en public/i18n/<idioma>.json: junto al repositorio se leen del disco; copiado a otra máquina, se
// piden a OfficeMatrix (/i18n/<idioma>.json). Comandos y opciones valen en inglés y en español.
// Guía para agentes: docs/PARA-AGENTES.md.   Ayuda: node om.js help
const fs = require('fs');
const path = require('path');

const URL_BASE = (process.env.OM_URL || 'http://localhost:4321').replace(/\/+$/, '');
const KEY = process.env.OM_LLAVE || '';
const LANG = /^es/i.test(process.env.OM_LANG || '') ? 'es' : 'en';
const MODOS = { relevo: 'relevo', relay: 'relevo', delphi: 'delphi', paralelo: 'delphi', parallel: 'delphi', consejo: 'consejo', council: 'consejo' };
// Comandos y opciones en inglés → su nombre de siempre.
const CMDS = { office: 'oficina', missions: 'misiones', new: 'nueva', status: 'estado', wait: 'esperar', result: 'resultado', file: 'archivo', intervene: 'intervenir', stop: 'detener', help: 'ayuda' };
const OPTS = { mode: 'modo', team: 'equipo', rounds: 'rondas', score: 'nota', parallel: 'a-la-vez', chair: 'presidente', attach: 'adjunto', download: 'bajar' };

let dict = {};
async function loadDict() {
  const local = path.join(__dirname, 'public', 'i18n', `${LANG}.json`);
  try { dict = JSON.parse(fs.readFileSync(local, 'utf8')); return; } catch {}
  try { const r = await fetch(`${URL_BASE}/i18n/${LANG}.json`); if (r.ok) dict = await r.json(); } catch {}
}
const t = (key, vars) => String(dict[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));

const help = () => t('om.help', { url: URL_BASE, key: KEY ? KEY.slice(0, 12) + '…' : t('om.noKey') });

async function call(p, opts = {}) {
  const headers = { ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}), ...opts.headers };
  const res = await fetch(URL_BASE + p, { method: opts.method || 'GET', headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body });
  if (opts.raw) {
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

function parse(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = OPTS[a.slice(2)] || a.slice(2), v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    if (k === 'adjunto') (opt.adjunto ||= []).push(v);
    else opt[k] = v;
  }
  return { pos, opt };
}

const ago = ms => { const s = Math.round(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}` : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`; };
const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function printState(d) {
  const p = d.progress || {};
  const estado = d.running ? t('om.state.running') : ['ok', 'partial', 'interrupted', 'new'].includes(d.outcome) ? t(`om.state.${d.outcome}`) : d.outcome;
  console.log(`${d.title}\n${t('om.idLine', { id: d.id, office: d.oficina, state: estado })}`);
  if (d.running) {
    console.log(t('om.progress', { phase: p.phaseLabel || p.phase || t('om.relay'), round: p.round || 0, max: p.maxRounds || '?', turn: p.turn || 0, total: p.totalTurns || '?',
      queued: p.queued?.length ? t('om.queued', { agents: p.queued.join(', ') }) : '' }));
    for (const w of d.workingAgents || []) console.log(`  ▶ ${w.agentId} (${ago(Date.now() - w.started)}): ${w.activity || t('om.working')}${w.said ? `\n     «${w.said}»` : ''}`);
  }
  const turns = d.messages.filter(m => m.kind === 'agent');
  for (const m of turns.slice(-4)) console.log(`  · ${m.agentName} ${m.phase ? `[${m.phase}] ` : ''}${m.verdict}${m.score != null ? ` ${m.score}/10` : ''}${m.failure ? ` ⛔ ${m.failure.label}` : ''}`);
  const sys = [...d.messages].reverse().find(m => m.kind === 'system');
  if (sys && !d.running) console.log(`  ${sys.text}`);
}

function printResult(d) {
  printState(d);
  const items = d.deliverables?.items || [];
  console.log(t('om.folder', { path: d.path }));
  if (d.deliverables?.main) console.log(t('om.main', { file: d.deliverables.main }));
  const shown = items.filter(i => i.final || i.touched).slice(0, 25);
  for (const i of (shown.length ? shown : items.slice(0, 15))) console.log(`  ${i.final ? '★' : '·'} ${i.path} (${i.kind}, ${kb(i.size || 0)})`);
  console.log(t('om.downloadHint', { id: d.id }));
}

async function download(id, rel, dest) {
  const res = await call(`/raw/${encodeURIComponent(id)}/${rel.split('/').map(encodeURIComponent).join('/')}`, { raw: true });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function main() {
  await loadDict();
  const [given = 'ayuda', ...rest] = process.argv.slice(2);
  const cmd = CMDS[given] || given;
  const { pos, opt } = parse(rest);
  switch (cmd) {
    case 'oficina': {
      const [o] = await call('/api/oficinas');
      const { agents } = await call('/api/agents');
      const equipo = o.equipo?.length ? o.equipo : agents.map(a => a.id);
      const ais = equipo.map(id => { const a = agents.find(x => x.id === id); return a ? `${a.id}${a.installed ? '' : t('om.notInstalled')}` : id; }).join(', ');
      console.log(t('om.office', { name: o.nombre, id: o.id, desc: o.descripcion || '', ais, missions: o.misiones, running: o.enCurso }));
      break;
    }
    case 'misiones': {
      const list = await call('/api/chats');
      list.sort((a, b) => Number(b.running) - Number(a.running));
      for (const c of list) console.log(t('om.missionLine', { mark: c.running ? '▶' : ' ', id: c.id, title: c.title, workflow: c.workflow, turns: c.turns, score: c.lastScore != null ? `, ${c.lastScore}/10` : '' }));
      if (!list.length) console.log(t('om.noMissions'));
      break;
    }
    case 'nueva': {
      const text = pos.join(' ').trim();
      if (!text) throw new Error(t('om.needRequest'));
      const attachments = [];
      for (const f of opt.adjunto || []) {
        const buf = fs.readFileSync(f);
        const r = await call(`/api/adjuntos?nombre=${encodeURIComponent(path.basename(f))}`, { method: 'POST', body: buf, headers: { 'Content-Type': 'application/octet-stream' } });
        attachments.push(r.id);
        console.log(`📎 ${path.basename(f)} (${kb(buf.length)})`);
      }
      const config = {
        workflow: MODOS[opt.modo || 'delphi'] || 'delphi', mode: opt.auto ? 'auto' : 'rondas', maxRounds: Number(opt.rondas) || 2,
        minScore: Number(opt.nota) || undefined, maxParallel: Number(opt['a-la-vez']) || 1, chair: opt.presidente || undefined,
        team: opt.equipo ? String(opt.equipo).split(',').map(id => ({ id: id.trim() })) : undefined,
      };
      const chat = await call('/api/chats', { method: 'POST', json: { text, config, attachments } });
      console.log(t('om.started', { id: chat.id, office: chat.oficina, team: chat.config.team.map(a => a.id).join(', '), workflow: chat.config.workflow }));
      break;
    }
    case 'estado': printState(await call(`/api/chats/${encodeURIComponent(pos[0])}`)); break;
    case 'esperar': {
      const until = Date.now() + (Number(opt['max-min']) || 240) * 60000;
      let d;
      for (;;) {
        d = await call(`/api/chats/${encodeURIComponent(pos[0])}`);
        if (!d.running) break;
        if (Date.now() > until) { console.log(t('om.stillRunning')); break; }
        const p = d.progress || {};
        console.log(t('om.waitLine', { time: new Date().toLocaleTimeString(LANG), phase: p.phaseLabel || t('om.relay'), turn: p.turn || 0, total: p.totalTurns || '?',
          agents: (d.workingAgents || []).map(w => `${w.agentId}: ${w.activity}`).join(' | ') }));
        await new Promise(r => setTimeout(r, 30000));
      }
      printResult(d);
      break;
    }
    case 'resultado': {
      const d = await call(`/api/chats/${encodeURIComponent(pos[0])}`);
      printResult(d);
      if (opt.bajar) {
        const items = (d.deliverables?.items || []).filter(i => i.final || i.touched);
        for (const i of items) console.log(`⬇ ${await download(d.id, i.path, path.join(String(opt.bajar), ...i.path.split('/')))}`);
      }
      break;
    }
    case 'archivo': console.log(`⬇ ${await download(pos[0], pos[1], pos[2] || path.basename(pos[1]))}`); break;
    case 'intervenir': {
      const r = await call(`/api/chats/${encodeURIComponent(pos[0])}/intervene`, { method: 'POST', json: { text: pos.slice(1).join(' '), asObjection: false } });
      console.log(r.aviso ? `⚠ ${r.aviso}` : t('om.directiveSent'));
      break;
    }
    case 'detener': await call(`/api/chats/${encodeURIComponent(pos[0])}/stop`, { method: 'POST', json: {} }); console.log(t('om.stopping')); break;
    default: console.log(help());
  }
}

main().catch(err => { console.error(`✖ ${err.message}`); process.exit(1); });
