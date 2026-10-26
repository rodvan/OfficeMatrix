// Interfaz de OfficeMatrix (centro de mando). Sin frameworks: estado en variables, render por funciones y
// eventos en vivo por Server-Sent Events (/api/events). Ver docs/DECISIONES.md.
const $ = id => document.getElementById(id);

let agents = [];          // agentes de agents.json con estado (installed, enabled)
let globalCfg = {};       // maxRounds, minScore, autoMaxRounds…
let chats = [];
let currentId = null;
let current = null;       // detalle del chat abierto (mensajes, debate, stats, handoff, files…)
let live = {};            // agentId -> { activity, started } del que trabaja ahora
let teamDraft = [];       // [{ id, role, on }] para el compositor
let templates = [];       // plantillas de misión (lib/templates.js)
let templateId = null;    // plantilla elegida en el compositor (null = libre)
let workflowsMeta = [];   // modos de trabajo con su explicación (lib/workflows.js)
let workflowId = 'relevo';
let suggestedWf = null;   // modo que la oficina sugiere según el texto del pedido
let chairDraft = null;
let composerOpen = false; // en una misión abierta el compositor va compacto hasta que el usuario lo usa
let officeChatOn = false; // la pestaña Chat de la oficina, al lado de las misiones
let statsScope = 'chat';
let globalStats = null;
let logEntries = [];
const logFilter = { agents: new Set(), kind: 'all', q: '' };
const LOG_MAX = 4000;
let oficinas = [];        // oficinas (simulaciones aisladas); 'edificio' es la de siempre
let officeEpoch = 0, chatEpoch = 0; // descartar respuestas anteriores, incluso A → B → A
let oficina = (() => { try { return localStorage.getItem('om-oficina') || 'edificio'; } catch { return 'edificio'; } })();

// ---------- Utilidades ----------

// Lo que depende de la oficina (lista de misiones, crear misión, cerebro, expedientes) lleva ?oficina=.
// En una oficina con empleados, /api/agents devuelve a los empleados (cada uno con su CLI y su modelo).
const OFFICE_SCOPED = /^\/api\/(agents|chats|stats|memory(\/search|\/file|\/entradas|\/traspaso|\/entrantes(\/aceptar)?)?)(\?|$)/;
const scoped = url => (oficina === 'edificio' || !OFFICE_SCOPED.test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}oficina=${encodeURIComponent(oficina)}`);

async function api(url, options = {}) {
  const res = await fetch(scoped(url), { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const agentOf = id => (id === 'user' ? { id: 'user', name: 'Usuario', color: '#b48cff', role: 'Mando' } : agents.find(a => a.id === id) || { id, name: id, color: '#7d8a9c', role: '' });
const hhmmss = d => new Date(d).toLocaleTimeString('es', { hour12: false });
const dur = s => (s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}` : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`);
const fmtTokens = n => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
const debounce = (fn, ms) => { let timer; return (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); }; };

function syncHash() {
  const p = new URLSearchParams();
  if (oficina !== 'edificio') p.set('s', oficina); // #s=<oficina>&m=<misión>; #m=<id> solo sigue siendo el edificio
  if (currentId) p.set('m', currentId);
  const tab = document.querySelector('#mainTabs .on')?.dataset.tab;
  const side = document.querySelector('#sideTabs .on')?.dataset.side;
  if (tab && tab !== 'reports') p.set('tab', tab);
  if (side && side !== 'log') p.set('side', side);
  const h = p.toString();
  history.replaceState(null, '', h ? `#${h}` : location.pathname);
}

function toast(text, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' err' : '');
  el.textContent = text;
  // Se apilan en una columna: dos avisos seguidos no se tapan.
  let box = $('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.className = 'toasts'; document.body.appendChild(box); }
  box.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// Un botón que espera al servidor: se deshabilita y muestra que está trabajando, para que nada "salte" ni se pulse dos veces.
async function withBusy(btn, fn) {
  if (btn?.classList.contains('busy')) return;
  btn?.classList.add('busy');
  if (btn) btn.disabled = true;
  try { return await fn(); } finally { btn?.classList.remove('busy'); if (btn) btn.disabled = false; }
}

// ---------- Rutas de archivos del proyecto (visor) ----------

// /raw sirve cada archivo con su ruta en la URL: así las rutas relativas de un HTML (img/, estilo.css) funcionan solas.
const rawUrl = (chatId, p) => `/raw/${encodeURIComponent(chatId)}/${String(p).split('/').map(encodeURIComponent).join('/')}`;
const KIND_ICON = { html: '🌐', md: '📝', image: '🖼', pdf: '📕', media: '🎞', code: '⌨', binary: '📦' };
const KIND_LABEL = new Proxy({}, {
  get(_, k) {
    switch (k) {
      case 'html': return t('ui.kind.html');
      case 'md': return t('ui.kind.md');
      case 'image': return t('ui.kind.image');
      case 'pdf': return t('ui.kind.pdf');
      case 'media': return t('ui.kind.media');
      case 'code': return t('ui.kind.code');
      case 'binary': return t('ui.kind.binary');
      default: return (k || '').toUpperCase();
    }
  }
});
// El servidor dice el tipo de cada archivo (lib/preview.js); esto solo cubre los que aún no están en el árbol.
function kindOfPath(p) {
  const known = (current?.files || []).find(f => f.path === p)?.kind;
  if (known) return known;
  const ext = (String(p).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  if (/^html?$/.test(ext)) return 'html';
  if (/^(md|markdown)$/.test(ext)) return 'md';
  if (/^(png|jpe?g|gif|webp|svg|avif|ico|bmp)$/.test(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (/^(mp3|wav|ogg|mp4|webm)$/.test(ext)) return 'media';
  return /^(zip|exe|dll|bin|woff2?|ttf|otf|docx|xlsx|pptx)$/.test(ext) ? 'binary' : 'code';
}
const dirOf = p => String(p).split('/').slice(0, -1).join('/');
function joinPath(base, rel) {
  const out = [];
  for (const s of `${base ? `${base}/` : ''}${rel}`.split('/')) {
    if (!s || s === '.') continue;
    if (s === '..') out.pop(); else out.push(s);
  }
  return out.join('/');
}
// Ruta de un evento del log relativa al proyecto ("C:\…\proyectos\<id>\final\a.html" o "./final/a.html" → "final/a.html").
function projectRel(file) {
  let f = String(file || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const i = currentId ? f.indexOf(`/${currentId}/`) : -1;
  if (i >= 0) f = f.slice(i + currentId.length + 2);
  return f;
}
const samePath = (a, b) => !!a && !!b && (a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`));

// Resaltado sencillo: comentarios, cadenas, números, palabras clave y etiquetas. Cada trozo se escapa por separado.
function highlightCode(src, file) {
  const ext = (String(file).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const hash = /^(py|sh|ps1|ya?ml|toml|ini|rb|env|gitignore)$/.test(ext);
  const markup = /^(html?|xml|svg|md|markdown)$/.test(ext);
  const re = new RegExp([
    `(${['\\/\\*[\\s\\S]*?\\*\\/', '<!--[\\s\\S]*?-->', ...(markup ? [] : ['\\/\\/[^\\n]*']), ...(hash ? ['#[^\\n]*'] : [])].join('|')})`,
    `("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'${markup ? '' : '|`(?:\\\\.|[^`\\\\])*`'})`,
    '(\\b\\d+(?:\\.\\d+)?\\b)',
    '(\\b(?:const|let|var|function|return|if|else|for|while|import|from|export|default|class|new|async|await|try|catch|throw|def|elif|in|of|true|false|null|undefined|None|True|False)\\b)',
    '(<\\/?[a-zA-Z][\\w:-]*|\\/?>)',
  ].join('|'), 'g');
  let out = '', last = 0;
  for (const m of String(src).matchAll(re)) {
    out += esc(src.slice(last, m.index));
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : m[4] ? 'k' : 't';
    out += `<span class="hl-${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(String(src).slice(last));
}

// Markdown mínimo y seguro (se escapa todo antes de dar formato): títulos, listas, citas, tablas, código.
// Con { chatId, base } también muestra las imágenes y enlaces relativos del proyecto (visor de entregables).
function md(src, opts = null) {
  const lines = String(src || '').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const unesc = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const target = url => {
    const u = unesc(url);
    if (/^https?:\/\//i.test(u)) return { href: u, external: true };
    if (/^data:image\//i.test(u)) return { href: u };
    if (/^[a-z][\w+.-]*:/i.test(u) || u.startsWith('//') || u.startsWith('/')) return null; // javascript:, file:, rutas absolutas: no
    const rel = joinPath(opts.base, u.split(/[?#]/)[0]);
    return rel ? { href: rawUrl(opts.chatId, rel), rel } : null;
  };
  const media = s => (!opts ? s : s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (m, alt, url) => {
      const tg = target(url);
      return tg ? `<img src="${esc(tg.href)}" alt="${alt}" loading="lazy">` : m;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const tg = target(url);
      if (!tg) return m;
      return tg.external ? `<a href="${esc(tg.href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : `<a href="#" data-preview="${esc(tg.rel)}">${label}</a>`;
    }));
  const inline = s => media(esc(s)).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  let out = '', list = false, code = null, table = [];
  const closeList = () => { if (list) { out += '</ul>'; list = false; } };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter(r => !/^\|[\s:|-]+\|?$/.test(r)).map(r => r.replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim())));
    out += '<table>' + rows.map((r, i) => `<tr>${r.map(c => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('') + '</table>';
    table = [];
  };
  for (const line of lines) {
    if (code !== null) {
      if (/^```/.test(line)) { out += `<pre>${esc(code)}</pre>`; code = null; } else code += line + '\n';
      continue;
    }
    if (/^```/.test(line)) { closeList(); flushTable(); code = ''; continue; }
    if (/^\s*\|/.test(line)) { closeList(); table.push(line.trim()); continue; }
    flushTable();
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeList(); out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; continue; }
    const li = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.*)/);
    if (li) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inline(li[1])}</li>`; continue; }
    closeList();
    if (/^>\s?/.test(line)) { out += `<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`; continue; }
    if (line.trim()) out += `<p>${inline(line)}</p>`;
  }
  closeList(); flushTable();
  if (code !== null) out += `<pre>${esc(code)}</pre>`;
  return out;
}

// ---------- Quién espera y por qué ----------

const PHASE_WHAT = new Proxy({}, {
  get(_, k) {
    switch (k) {
      case 'borrador': return t('ui.phaseWhat.borrador');
      case 'revision': return t('ui.phaseWhat.revision');
      case 'evaluacion': return t('ui.phaseWhat.evaluacion');
      case 'sintesis': return t('ui.phaseWhat.sintesis');
      case 'aprobacion': return t('ui.phaseWhat.aprobacion');
      default: return '';
    }
  }
});
const names = ids => ids.map(id => agentOf(id).name).join(', ');
const pl = (ids, one, many) => (ids.length > 1 ? many : one);

const isParallelRun = () => !!current?.running && !!current.progress?.workflow && current.progress.workflow !== 'relevo';

// Orden de relevo del ciclo en marcha, sin los que cayeron.
function relayOrder() {
  return (current?.config?.team || []).map(mb => mb.id).filter(id => !(current?.running && failureOf(id)));
}

// Quién trabaja ahora y quiénes siguen (en relevo, en orden; en paralelo, la cola de la fase).
function whoIsNext() {
  const p = current?.progress || {};
  const working = Object.keys(live);
  if (p.workflow && p.workflow !== 'relevo') return { working, next: p.queued || [] };
  const order = relayOrder();
  const at = order.indexOf(p.agentId || working[0]);
  const next = at < 0 ? order : [...order.slice(at + 1), ...order.slice(0, at)];
  return { working, next };
}

// Por qué espera un agente, en una frase.
function waitReason(id) {
  const p = current?.progress || {};
  const { working, next } = whoIsNext();
  if (p.workflow && p.workflow !== 'relevo') {
    if ((p.queued || []).includes(id)) {
      const who = working.length ? t('ui.wait.working', { who: names(working) }) : t('ui.wait.starting');
      return t('ui.wait.slot', { who, max: p.maxParallel || '?' });
    }
    return p.phase === 'aprobacion' && current?.config?.chair === id ? t('ui.wait.chairApproval')
      : p.phase === 'sintesis' ? t('ui.wait.chairSynthesis', { name: agentOf(current?.config?.chair).name })
        : t('ui.wait.phaseDone');
  }
  const i = next.indexOf(id);
  if (i < 0) return t('ui.wait.notInCycle');
  const by = working.length ? t('ui.wait.agentWorking', { who: names(working) }) : t('ui.wait.prepTurn');
  return i === 0 ? t('ui.wait.nextTurn', { who: working.length ? names(working) : t('ui.wait.currentTurn') }) : t('ui.wait.inTurns', { n: i + 1, by, before: names(next.slice(0, i)) });
}

// ---------- Tooltips propios (data-hover) ----------
// data-hover="agent:<id>" | "crew:operador" | "crew:sabia" | "tm:<celda>" | "log:<tipo>" | "file:<ruta>" | "txt:<texto>".
// No se usa el title del navegador: tarda, no admite formato y no se actualiza mientras el ratón está encima.

const EMOTE_MEANING = new Proxy({}, {
  get(_, k) {
    switch (k) {
      case '⌨': return t('ui.emote.code');
      case '💭': return t('ui.emote.think');
      case '☕': return t('ui.emote.coffee');
      case '💬': return t('ui.emote.chat');
      case '✔': return t('ui.emote.approved');
      case '⛔': return t('ui.emote.crashed');
      case '⏳': return t('ui.emote.queued');
      default: return '';
    }
  }
});
const LOG_MEANING = new Proxy({}, {
  get(_, k) {
    switch (k) {
      case 'read': return t('ui.logMeaning.read');
      case 'write': return t('ui.logMeaning.write');
      case 'cmd': return t('ui.logMeaning.cmd');
      case 'search': return t('ui.logMeaning.search');
      case 'web': return t('ui.logMeaning.web');
      case 'plan': return t('ui.logMeaning.plan');
      case 'agent': return t('ui.logMeaning.agent');
      case 'tool': return t('ui.logMeaning.tool');
      case 'think': return t('ui.logMeaning.think');
      case 'text': return t('ui.logMeaning.text');
      case 'error': return t('ui.logMeaning.error');
      case 'info': return t('ui.logMeaning.info');
      case 'raw': return t('ui.logMeaning.raw');
      case 'stderr': return t('ui.logMeaning.stderr');
      default: return '';
    }
  }
});
const TM_MEANING = new Proxy({}, {
  get(_, k) {
    switch (k) {
      case 'mode': return t('ui.tm.mode');
      case 'phase': return t('ui.tm.phase');
      case 'round': return t('ui.tm.round');
      case 'turn': return t('ui.tm.turn');
      case 'streak': return t('ui.tm.streak');
      case 'done': return t('ui.tm.done');
      case 'obj': return t('ui.tm.obj');
      case 'start': return t('ui.tm.start');
      case 'clock': return t('ui.tm.clock');
      default: return '';
    }
  }
});

function agentTip(id) {
  const a = agentOf(id), l = live[id], s = stationStats(id);
  const team = current?.config?.team;
  const inTeam = !team || team.some(mb => mb.id === id);
  const role = team?.find(mb => mb.id === id)?.role || a.role;
  const fail = !l && inTeam ? failureOf(id) : null;
  const m = [...(current?.messages || [])].reverse().find(x => x.kind === 'agent' && x.agentId === id);
  const state = l ? `<b class="ok">${t('ui.tip.working')}</b>${l.phase ? ` · ${PHASE_LABEL[l.phase] || esc(l.phase)}` : ''}${current?.progress?.round ? ` · ${t('ui.tip.round', { n: current.progress.round })}` : ''}`
    : fail ? `<b class="bad">⛔ ${esc(fail.label)}</b> · ${current?.running ? t('ui.tip.outCycle') : t('ui.tip.lastCycle')}`
      : !a.installed ? `<b class="bad">${t('ui.tip.cliNotInstalled')}</b>`
        : !inTeam && current ? `<span class="muted">${t('ui.tip.notInMission')}</span>`
          : current?.running ? `<b class="warn">${t('ui.tip.waiting')}</b> · ${esc(waitReason(id))}`
            : a.enabled ? `<b>${t('ui.tip.readyNoCycle')}</b>` : `<span class="muted">${t('ui.tip.disabledInAgents')}</span>`;
  const rows = [
    l && [t('ui.tip.doing'), esc(l.activity || t('ui.sit.working'))],
    l && [t('ui.tip.thinking'), l.said ? `«${esc(l.said)}»` : `<span class="muted">${t('ui.tip.saidNothing')}</span>`],
    l?.started && [t('ui.tip.duration'), `<span data-since="${l.started}">${dur(Math.round((Date.now() - l.started) / 1000))}</span> ${t('ui.tip.inTurn')}`],
    fail && [t('ui.tip.cause'), esc(fail.detail)], fail && [t('ui.tip.hint'), esc(fail.hint)],
    m && !l && [t('ui.tip.lastTurn'), `${esc(m.phase ? PHASE_LABEL[m.phase] || m.phase : verdictLabel(m.verdict))}${m.score != null ? ` · ${m.score}/10` : ''} · ${t('ui.tip.ago', { dur: dur(Math.max(0, Math.round((Date.now() - new Date(m.ts)) / 1000))) })}`],
    s?.turns && [t('ui.tip.inMission'), t('ui.tip.turnsStats', { turns: s.turns, avg: s.avgScore ?? '–', approvals: s.approvals })],
  ].filter(Boolean);
  // Empleado: con qué modelo trabaja (y con cuál trabajó el último turno, si fue la reserva).
  if (a.empleado) {
    rows.unshift([t('ui.tip.model'), `${esc(a.modeloLabel)}${a.reserva ? ` <span class="muted">· ${t('ui.tip.reserve').toLowerCase()} ${esc(a.reserva)}</span>` : ''}`]);
    if (m?.reserva) rows.push([t('ui.tip.reserve'), `${t('ui.tip.reserveTurn', { agent: esc(m.reserva.a), reason: esc(m.reserva.motivo.toLowerCase()) })}${m.reserva.diversidadReducida ? ` · <b class="warn">${t('ui.tip.reducedDiversity')}</b>` : ''}`]);
  }
  return `<div class="ht-head" style="--c:${esc(a.color)}"><i></i><b>${esc(a.name.toUpperCase())}</b><span>${esc(a.empleado ? '' : window.Nave ? Nave.crewName(a) : '')}</span><em>${esc(role || '')}</em></div>
    <div class="ht-state">${state}</div>${rows.map(([k, v]) => `<div class="ht-row"><span>${k}</span><span>${v}</span></div>`).join('')}${a.empleado ? `<div class="ht-foot">${t('ui.tip.openFile')}</div>` : ''}`;
}

function hoverHtml(spec, el) {
  const [type, ...rest] = spec.split(':');
  const arg = rest.join(':');
  if (type === 'agent') {
    const icon = el.closest('.actor')?.querySelector('.emote:not([hidden])')?.textContent || '';
    return agentTip(arg) + (EMOTE_MEANING[icon] ? `<div class="ht-foot">${icon} ${EMOTE_MEANING[icon]}</div>` : '');
  }
  if (type === 'crew') {
    const busy = current?.running && current.progress;
    return arg === 'operador'
      ? `<div class="ht-head" style="--c:#7dffb0"><i></i><b>${esc(t('ui.avatar.operador').toUpperCase())}</b><em>${t('ui.tip.operatorRole')}</em></div><div class="ht-state">${t('ui.tip.operatorDesc')}</div>
        <div class="ht-row"><span>${t('ui.tip.operatorNow')}</span><span>${busy ? t('ui.tip.operatorWatching', { detail: esc([busy.phaseLabel, busy.round ? t('ui.tip.round', { n: `${busy.round}/${busy.maxRounds}` }) : ''].filter(Boolean).join(' · ') || t('ui.tip.inProgress')) }) : t('ui.tip.operatorCoffee')}</span></div>`
      : `<div class="ht-head" style="--c:#39e58c"><i></i><b>${esc(t('ui.avatar.sabia').toUpperCase())}</b><em>${t('ui.tip.sabiaRole')}</em></div><div class="ht-state">${t('ui.tip.sabiaDesc')}</div>
        <div class="ht-row"><span>${t('ui.tip.sabiaView')}</span><span>${t('ui.tip.sabiaTab')}</span></div>`;
  }
  if (type === 'tm') return `<div class="ht-state">${esc(TM_MEANING[arg] || '')}</div>`;
  if (type === 'log') return `<div class="ht-state">${esc(LOG_MEANING[arg] || arg)}</div>`;
  if (type === 'file') return `<div class="ht-state">${KIND_ICON[kindOfPath(arg)] || ''} <b>${esc(arg)}</b></div><div class="ht-row"><span>${t('ui.tip.clickAction')}</span><span>${t('ui.tip.clickToOpen', { kind: esc((KIND_LABEL[kindOfPath(arg)] || '').toLowerCase()) })}</span></div>`;
  return `<div class="ht-state">${esc(arg)}</div>`;
}

let hoverEl = null, hoverTimer = 0, hoverXY = [0, 0];
function placeTip() {
  const tip = $('hoverTip');
  const r = tip.getBoundingClientRect();
  const [x, y] = hoverXY;
  tip.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, x + 14))}px`;
  tip.style.top = `${y + 18 + r.height > window.innerHeight ? Math.max(8, y - r.height - 12) : y + 18}px`;
}
function showTip() {
  if (!hoverEl?.isConnected) return hideTip();
  const tip = $('hoverTip');
  tip.innerHTML = hoverHtml(hoverEl.dataset.hover, hoverEl);
  tip.hidden = false;
  placeTip();
  requestAnimationFrame(() => tip.classList.add('on'));
}
function hideTip() { hoverEl = null; clearTimeout(hoverTimer); $('hoverTip').classList.remove('on'); $('hoverTip').hidden = true; }
document.addEventListener('mouseover', e => {
  const el = e.target.closest?.('[data-hover]');
  if (el === hoverEl) return;
  clearTimeout(hoverTimer);
  if (!el) { hideTip(); return; }
  const wasOpen = !$('hoverTip').hidden;
  hoverEl = el;
  hoverTimer = setTimeout(showTip, wasOpen ? 0 : 180); // pequeño retraso: pasar el ratón de largo no abre nada
});
document.addEventListener('mousemove', e => { hoverXY = [e.clientX, e.clientY]; if (!$('hoverTip').hidden) placeTip(); });
document.addEventListener('mousedown', hideTip);
document.addEventListener('scroll', hideTip, true);
// Mientras está abierto se rehace cada segundo: el cronómetro y lo que hace el agente cambian bajo el ratón.
const refreshTip = () => { if (hoverEl && !$('hoverTip').hidden) { if (!hoverEl.isConnected) hideTip(); else { $('hoverTip').innerHTML = hoverHtml(hoverEl.dataset.hover, hoverEl); placeTip(); } } };

// ---------- Qué está pasando (franja de situación) ----------

let lastWrite = null; // { path, agentId, ts }: el último archivo que escribió un agente en este ciclo

function renderSituation() {
  const box = $('situation');
  if (!current) { box.hidden = true; return; }
  box.hidden = false;
  const p = current.progress || {};
  const chip = id => `<span class="who" style="--c:${esc(agentOf(id).color)}" data-hover="agent:${esc(id)}">${esc(agentOf(id).name)}</span>`;
  let html;
  if (current.running) {
    const { working, next } = whoIsNext();
    const parallel = p.workflow && p.workflow !== 'relevo';
    const doing = working.length
      ? working.map(id => `${chip(id)} <i>${esc(live[id]?.activity || t('ui.sit.working'))}</i>`).join(' · ')
      : `<i>${t('ui.sit.prepNextTurn')}</i>`;
    const what = parallel ? `<b>${esc((p.phaseLabel || '').toUpperCase())}</b> · ${esc(PHASE_WHAT[p.phase] || '')}` : `<b>${t('ui.sit.relayRound', { round: p.round || 1, max: p.maxRounds || '?' })}</b> · ${t('ui.sit.relayDesc')}`;
    const wait = next.length ? (parallel ? t('ui.sit.queued', { who: next.map(chip).join(' '), max: p.maxParallel }) : t('ui.sit.after', { who: next.map(chip).join(' → ') })) : '';
    const chair = agentOf(current.config?.chair).name;
    const rounds = t('ui.sit.roundOf', { round: p.round || 1, max: p.maxRounds });
    const close = parallel
      ? ({
        borrador: p.workflow === 'delphi' ? t('ui.sit.delphiNext')
          : t('ui.sit.councilNext', { chair }),
        evaluacion: t('ui.sit.councilEvalNext', { chair }),
        sintesis: t('ui.sit.councilSynthNext', { rounds }),
      }[p.phase] || t('ui.sit.allMustApprove', { approvals: p.approvalsInRow || 0, needed: p.needed || '?', rounds }))
      : `${t('ui.sit.relayClose', { needed: p.needed, current: p.approvalsInRow || 0 })}${p.mode === 'auto' ? t('ui.sit.autoCloseExtra', { needed: p.needed, current: p.doneInRow || 0 }) : ''}`;
    const blockers = p.openObjections ? ` · <span class="warn">${t('ui.sit.blockers', { n: p.openObjections })}</span>` : '';
    const lw = lastWrite && previewable(lastWrite.path) ? ` · <a href="#" class="live-file" data-preview="${esc(lastWrite.path)}" data-hover="file:${esc(lastWrite.path)}">📄 ${esc(lastWrite.path)}</a> <small class="muted">${t('ui.sit.liveView')}</small>` : '';
    html = `<div class="sit-line"><span class="sit-dot run"></span>${what}</div>
      <div class="sit-line">${t('ui.sit.now')}: ${doing}${lw}</div>
      <div class="sit-line muted">${wait}${wait ? ' · ' : ''}${close}${blockers}</div>`;
  } else {
    const end = [...current.messages].reverse().find(m => m.kind === 'system' && m.outcome && m.outcome !== 'started');
    const canAccept = current.outcome === 'partial' && ['meseta', 'retroceso', 'agotado'].includes(current.stopReason);
    const acceptBtn = canAccept ? ` <button type="button" class="btn small ok-btn" id="acceptMissionBtn" style="margin-left:8px;border-color:var(--ok);color:var(--ok);" title="${t('ui.sit.acceptTip')}">${t('ui.sit.acceptBtn')}</button>` : '';
    const closedOk = end && (end.outcome === 'unanime' || end.outcome === 'consenso' || end.outcome === 'aceptado');
    const state = current.outcome === 'interrupted' ? `<span class="sit-dot warn"></span><b>${t('ui.sit.interrupted')}</b>`
      : end ? `<span class="sit-dot ${closedOk ? 'ok' : 'idle'}"></span>${esc(end.text)}${acceptBtn}`
        : current.messages.some(m => m.kind === 'agent') ? `<span class="sit-dot idle"></span>${t('ui.sit.noCycle')}` : `<span class="sit-dot idle"></span>${t('ui.sit.preparingMission')}`;
    const main = current.deliverables?.main;
    html = `<div class="sit-line">${state}</div>` + (main ? `<div class="sit-line">${t('ui.sit.mainDeliverable')} <a href="#" data-preview="${esc(main)}" data-hover="file:${esc(main)}">${esc(main)}</a> <small class="muted">${t('ui.sit.inFolder', { path: esc(I18N.shortHome(current.path)) })}</small></div>` : '');
  }
  if (box.dataset.html !== html) { box.dataset.html = html; box.innerHTML = html; }
}

// ---------- Qué hace la app con lo que escribes (junto al cuadro de texto) ----------

function renderIntent() {
  const text = $('input').value.trim();
  const order = (readConfig().team || []).map(mb => agentOf(mb.id).name);
  let html;
  if (current?.running) {
    const { working, next } = whoIsNext();
    const now = working.length ? (working.length > 1 ? t('ui.intent.liveHasItNowPlural', { who: esc(names(working)) }) : t('ui.intent.liveHasItNow', { who: esc(names(working)) })) : t('ui.intent.liveNextReceives');
    if (isParallelRun()) {
      const nextTxt = next.length ? (next.length > 1 ? t('ui.intent.liveWillReadPlural', { who: esc(names(next)) }) : t('ui.intent.liveWillRead', { who: esc(names(next)) })) : '';
      html = `<span class="int-k live">${t('ui.intent.liveBadge')}</span> ` + t('ui.intent.liveNowParallel', { now, next: nextTxt });
    } else {
      const nextTxt = next.length ? (next.length > 1 ? t('ui.intent.liveWillReadTurnPlural', { who: esc(names(next)) }) : t('ui.intent.liveWillReadTurn', { who: esc(names(next)) })) : '';
      const objTxt = $('interveneObj').checked ? t('ui.intent.liveObjExtra') : '';
      html = `<span class="int-k live">${t('ui.intent.liveBadge')}</span> ` + t('ui.intent.liveNowRelay', { now, next: nextTxt, obj: objTxt });
    }
  } else if (current?.outcome === 'interrupted') {
    html = text ? `<span class="int-k">${t('ui.intent.newReqBadge')}</span> ${t('ui.intent.newReqInterrupted')}`
      : `<span class="int-k">${t('ui.intent.resumeBadge')}</span> ${t('ui.intent.resumeInterrupted')}`;
  } else if (current) {
    html = text ? `<span class="int-k">${t('ui.intent.newReqBadge')}</span> ${t('ui.intent.newReqExisting', { path: `${esc(projectsRoot())}${esc(current.id)}`, team: esc(order.join(' → ') || t('ui.intent.theTeam')) })}`
      : `<span class="int-k">${t('ui.intent.passBadge')}</span> ${t('ui.intent.passExisting')}`;
  } else {
    const w = wfOf(workflowId);
    const officeTxt = oficina !== 'edificio' ? t('ui.intent.officeIn', { name: esc(officeNow().nombre) }) : '';
    const teamTxt = esc(order.join(workflowId === 'relevo' ? ' → ' : ', ') || t('ui.intent.chooseTeam'));
    html = `<span class="int-k">${t('ui.intent.newMissionBadge')}</span> ${t('ui.intent.newMissionDesc', { folder: `${esc(projectsRoot())}&lt;fecha&gt;-&lt;nombre&gt;/`, office: officeTxt, mode: esc(w ? `${w.icon} ${w.name}` : t('workflow.relevo.name')), team: teamTxt })}`;
  }
  if ($('intent').dataset.html !== html) { $('intent').dataset.html = html; $('intent').innerHTML = html; }
}

// ---------- Barra superior y estaciones ----------

function tick() {
  $('clock').textContent = hhmmss(Date.now());
  for (const [id, l] of Object.entries(live)) {
    const el = document.querySelector(`#st-${CSS.escape(id)} .st-timer`);
    if (el && l.started) el.textContent = dur(Math.round((Date.now() - l.started) / 1000));
  }
  for (const el of document.querySelectorAll('#nowPanel [data-since]')) el.textContent = dur(Math.round((Date.now() - Number(el.dataset.since)) / 1000));
  const p = current?.progress;
  if (p?.cycleStarted && current.running) $('tmClock').textContent = dur(Math.round((Date.now() - p.cycleStarted) / 1000));
  renderChatMeta();
  refreshTip();
}

// Hora y tiempo de la misión, siempre a la vista bajo el título.
function renderChatMeta() {
  if (!current) { $('chatMeta').textContent = ''; return; }
  const turns = current.messages.filter(m => m.kind === 'agent');
  const worked = turns.reduce((s, m) => s + (m.seconds || 0), 0);
  const cycleStart = current.running && current.progress?.cycleStarted;
  const created = new Date(current.created);
  const day = created.toDateString() === new Date().toDateString() ? t('ui.meta.today') : created.toLocaleDateString(I18N.getLang?.() || 'en', { day: 'numeric', month: 'short' });
  const lastTs = current.messages.length ? new Date(current.messages[current.messages.length - 1].ts).getTime() : created.getTime();
  $('chatMeta').innerHTML = [
    t('ui.meta.created', { day, time: hhmmss(created).slice(0, 5) }),
    cycleStart ? t('ui.meta.running', { time: hhmmss(cycleStart).slice(0, 5), dur: dur(Math.round((Date.now() - cycleStart) / 1000)) })
      : t('ui.stat.lasted', { dur: dur(Math.max(0, Math.round((lastTs - created.getTime()) / 1000))) }),
    t('ui.meta.aiWork', { dur: dur(worked), turns: turns.length }),
  ].join(' · ');
}

// "Ahora": qué está haciendo cada agente en este momento, encima del log en vivo.
const PHASE_LABEL = new Proxy({}, {
  get(_, k) {
    switch (k) {
      case 'borrador': return t('ui.phase.borrador');
      case 'revision': return t('ui.phase.revision');
      case 'evaluacion': return t('ui.phase.evaluacion');
      case 'sintesis': return t('ui.phase.sintesis');
      case 'aprobacion': return t('ui.phase.aprobacion');
      default: return (k || '').toUpperCase();
    }
  }
});
function renderNow() {
  const box = $('nowPanel');
  const ids = Object.keys(live);
  box.hidden = !current?.running && !ids.length;
  if (box.hidden) return;
  box.innerHTML = `<div class="now-k">${t('ui.now.badge')}${current?.progress?.phaseLabel ? ` · ${esc(current.progress.phaseLabel.toUpperCase())}` : ''}</div>` + (ids.length
    ? ids.map(id => {
      const a = agentOf(id), l = live[id];
      return `<div class="now-row" style="--c:${esc(a.color)}" data-hover="agent:${esc(id)}"><span class="led"></span><b>${esc(a.name.toUpperCase())}</b>` +
        `${l.phase ? `<span class="tag">${PHASE_LABEL[l.phase] || esc(l.phase)}</span>` : ''}<span class="act">${esc(l.activity || t('ui.sit.working'))}</span>` +
        `<span class="since" ${l.started ? `data-since="${l.started}"` : ''}>${l.started ? dur(Math.round((Date.now() - l.started) / 1000)) : ''}</span></div>`;
    }).join('')
    : `<div class="now-row idle">${t('ui.now.prepTurn')}</div>`);
}

function renderTopStatus() {
  $('topStatus').innerHTML = agents.map(a => {
    const fail = !live[a.id] && failureOf(a.id);
    const cls = live[a.id] ? 'busy' : fail ? 'off' : a.installed && a.enabled ? 'ok' : 'off';
    const txt = live[a.id] ? t('ui.top.onTurn') : fail ? fail.label : !a.installed ? t('ui.top.notInstalled') : a.enabled ? t('ui.top.ready') : t('ui.top.disabled');
    return `<span class="${cls}" data-hover="agent:${esc(a.id)}"><i></i>${esc(a.name.toUpperCase())} · ${txt}</span>`;
  }).join('');
}

function stationStats(id) {
  return (current?.stats || []).find(s => s.id === id);
}

function renderStations() {
  const teamIds = current?.config?.team?.map(mb => mb.id);
  $('stations').innerHTML = agents.map(a => {
    const inTeam = !teamIds || teamIds.includes(a.id);
    const role = current?.config?.team?.find(mb => mb.id === a.id)?.role || a.role;
    const s = stationStats(a.id);
    const l = live[a.id];
    const fail = !l && inTeam ? failureOf(a.id) : null;
    const cls = !a.installed || !allowedAgent(a) || (!inTeam && current) || (!a.enabled && !current) ? 'off' : l ? 'working' : fail ? 'failed' : 'ready';
    const queued = cls === 'ready' && isQueued(a.id);
    const bubble = l ? l.activity || t('ui.sit.working') : !a.installed ? t('ui.station.cliNotInstalled') : !allowedAgent(a) ? t('ui.station.notInOffice', { name: officeNow().nombre }) : !inTeam && current ? t('ui.station.notInMission')
      : fail ? `⛔ ${fail.label} · ${current?.running ? t('ui.station.outCycle') : t('ui.station.lastCycle')}` : queued ? t('ui.station.queued')
      : s?.turns ? lastLine(a.id) : t('ui.station.waiting');
    return `<div class="station ${cls}${a.empleado ? ' emp' : ''}" id="st-${esc(a.id)}" style="--c:${esc(a.color)}" data-hover="agent:${esc(a.id)}">
      <div class="st-head"><span class="led"></span><span class="nm">${esc(a.name.toUpperCase())}</span><span class="cn">${esc(a.empleado ? a.modeloLabel : Nave.crewName(a))}</span><span class="rl">${esc(role)}</span></div>
      <div class="bubble">${esc(bubble)}</div>
      <div class="said">${esc(l?.said || '')}</div>
      <div class="st-meta">
        <span>${t('ui.station.score')} <b>${s?.avgScore ?? '–'}</b></span>
        <span>${t('ui.station.ok')} <b>${s ? `${s.approvals}/${s.turns}` : '–'}</b></span>
        ${l?.phase ? `<span class="ph">${PHASE_LABEL[l.phase] || esc(l.phase)}</span>` : ''}
        <span class="st-timer">${l ? '0s' : s?.turns ? t('ui.station.avgSeconds', { dur: dur(s.avgSeconds) }) : ''}</span>
      </div>
    </div>`;
  }).join('');
  // La tripulación de la vista nave sigue el estado de cada estación.
  Nave.setOffice(officeNow(), oficinas, id => setOffice(id).catch(err => toast(err.message, true)));
  Nave.setCouncil(current?.running && current?.config?.workflow === 'consejo');
  Nave.sync(agents.map(a => {
    const m = [...(current?.messages || [])].reverse().find(x => x.kind === 'agent' && x.agentId === a.id);
    const cls = $(`st-${a.id}`).className.replace('station', '').replace(' emp', '').trim();
    const queued = cls === 'ready' && isQueued(a.id);
    return { ...a, cls, queued, activity: live[a.id]?.activity, said: live[a.id]?.said, lastTs: m?.ts, verdict: m?.verdict };
  }));
  const p = current?.running && current.progress;
  Nave.setBusy(p ? [p.phaseLabel, p.round ? `R${p.round}` : ''].filter(Boolean).join(' · ') || t('ui.top.inCycle') : '');
}

// Espera su turno en el ciclo en marcha. En paralelo el servidor dice quién hace cola en la fase (con "A la vez, máx."
// menor que el equipo); en relevo, todo el equipo que no trabaja espera el suyo.
function isQueued(id) {
  if (!current?.running) return false;
  const p = current.progress || {};
  if (p.workflow) return (p.queued || []).includes(id);
  return (current.config?.team || []).some(mb => mb.id === id);
}

// Causa del fallo si el último turno de este agente en el ciclo más reciente fue un ERROR diagnosticado (sin saldo, colgada…).
function failureOf(agentId) {
  const msgs = current?.messages || [];
  const lastCycle = [...msgs].reverse().find(m => m.cycle)?.cycle;
  const m = [...msgs].reverse().find(x => x.kind === 'agent' && x.agentId === agentId);
  // Un turno PARCIAL (D47) no saca al agente del ciclo: no se pinta como caído.
  return m?.failure && m.verdict !== 'PARCIAL' && m.cycle === lastCycle ? m.failure : null;
}

// El motor guarda APROBADO/CAMBIOS. La pantalla dice APPROVED/CHANGES (o el español, si ese es el idioma).
function verdictLabel(v) {
  if (!v) return '';
  const key = `handoff.verdict.${v}`;
  const s = t(key);
  return s === key ? String(v).replace(/_/g, ' ') : s;
}

function lastLine(agentId) {
  const m = [...(current?.messages || [])].reverse().find(x => x.kind === 'agent' && x.agentId === agentId);
  if (!m) return t('ui.station.waiting');
  const what = m.phase && !['revision', 'aprobacion'].includes(m.phase) ? (PHASE_LABEL[m.phase] || m.phase).toLowerCase() : verdictLabel(m.verdict);
  return t('ui.station.lastTurn', { what, score: m.score != null ? ` · ${m.score}/10` : '' });
}

function setLive(agentId, info) {
  if (info) live[agentId] = { ...(live[agentId] || {}), ...info };
  else delete live[agentId];
  renderTopStatus();
  const st = $(`st-${agentId}`);
  if (st && info && st.classList.contains('working')) {
    const bubble = st.querySelector('.bubble');
    const text = live[agentId].activity || t('ui.sit.working');
    if (bubble.textContent !== text) {
      bubble.textContent = text;
      // Un destello corto al cambiar de actividad: se nota que avanza sin que el texto "salte".
      bubble.classList.remove('tick'); void bubble.offsetWidth; bubble.classList.add('tick');
    }
    st.querySelector('.said').textContent = live[agentId].said || '';
    Nave.activity(agentId, live[agentId].activity, live[agentId].said);
  }
  else renderStations();
  renderNow();
  renderSituation();
  renderIntent();
}

// ---------- Misiones (chats) ----------

async function loadChats() {
  const epoch = officeEpoch;
  const result = await api('/api/chats');
  if (epoch !== officeEpoch) return;
  chats = result;
  renderChats();
}

function renderChats() {
  const q = $('chatFilter').value.trim().toLowerCase();
  const list = chats.filter(c => !q || c.title.toLowerCase().includes(q));
  $('chatCount').textContent = chats.length ? `(${chats.length})` : '';
  const label = { running: t('ui.chat.running'), interrupted: t('ui.chat.interrupted'), ok: t('ui.chat.closed'), partial: t('ui.chat.open'), new: t('ui.chat.new') };
  const stopLabel = { meseta: t('ui.chat.plateau'), retroceso: t('ui.chat.regression'), agotado: t('ui.chat.cap') };
  $('chatList').innerHTML = list.map(c => `
    <li data-id="${esc(c.id)}" class="${c.id === currentId ? 'active' : ''}" title="${esc(c.title)}">
      <span class="t">${esc(c.title)}</span>${c.cierre ? `<small class="cierre-mini" title="${esc(c.cierre.frase)}"><i class="cierre-luz ${esc(c.cierre.semaforo)}"></i> ${esc(t(`cierre.ui.luz.${c.cierre.semaforo}`))} · ${esc(c.cierre.frase)}</small>` : ''}
      <small><span class="state ${c.outcome}">${(c.outcome === 'partial' && stopLabel[c.stopReason]) || (c.accepted ? t('ui.chat.accepted') : '') || label[c.outcome] || ''}</span>
        ${c.workflow && c.workflow !== 'relevo' ? `<span title="${esc(wfOf(c.workflow)?.name || '')}">${esc(wfOf(c.workflow)?.icon || '')}</span>` : ''}${c.mode === 'auto' ? '<span>AUTO</span>' : ''}<span>${t('ui.chat.turns', { n: c.turns })}</span>
        ${c.lastScore != null ? `<span>${c.lastScore}/10</span>` : ''}${c.openObjections ? `<span style="color:var(--amber)">⚑${c.openObjections}</span>` : ''}</small>
    </li>`).join('') || `<li class="muted">${t('ui.noMissions')}</li>`;
}

// ---------- Oficinas (simulaciones aisladas) ----------

const projectsRoot = () => (oficina === 'edificio' ? 'proyectos/' : `oficinas/${oficina}/proyectos/`);
const officeNow = () => oficinas.find(o => o.id === oficina) || { id: 'edificio', nombre: 'Edificio', equipo: [], color: '#39e58c' };
// En una oficina con equipo, solo esas IAs aparecen en el compositor (el servidor lo exige igual).
// Los Grok Bots de la oficina siempre se pueden elegir (el «equipo» es de las CLIs).
const allowedAgent = a => a.bot || !officeNow().equipo?.length || officeNow().equipo.includes(a.id);

async function loadOffices() {
  oficinas = await api('/api/oficinas').catch(() => oficinas);
  if (!oficinas.some(o => o.id === oficina)) oficina = 'edificio';
  renderOffices();
}

function renderOffices() {
  const o = officeNow();
  const officeName = x => x.id === 'edificio' ? t('ui.office.building') : x.nombre;
  $('officeSel').innerHTML = oficinas.map(x => `<option value="${esc(x.id)}" ${x.id === oficina ? 'selected' : ''}>${x.id === 'edificio' ? '🛸' : '🏢'} ${esc(officeName(x).toUpperCase())}${x.enCurso ? ` · ${t('ui.office.inProgress', { n: x.enCurso })}` : ''}</option>`).join('');
  document.querySelector('.office-bar').style.setProperty('--oc', o.color || '#39e58c');
  $('officeDesc').textContent = o.id === 'edificio' ? t('ui.office.edificioDesc') : t('ui.office.manual', { desc: o.descripcion || o.nombre });
  $('officeCfgBtn').hidden = o.id === 'edificio';
  $('sideChat').hidden = o.id === 'edificio';
  if (o.id === 'edificio' && officeChatOn) setSide('missions');
}

// Cambiar de oficina: otras misiones, otro cerebro, otro equipo.
async function setOffice(id, { openNew = true } = {}) {
  if (id === oficina && !openNew) return;
  for (const dlgId of ['editor', 'viewer', 'officeDialog', 'empDialog', 'xferDialog', 'simWizard', 'tplDialog', 'editorialDialog', 'decisionDialog']) { const dlg = $(dlgId); if (dlg?.open) dlg.close(); }
  oficina = id;
  const epoch = ++officeEpoch;
  ++chatEpoch;
  try { localStorage.setItem('om-oficina', id); } catch {}
  renderOffices();
  loadEditorial();
  globalStats = null;
  await loadAgents(); // los empleados de esta oficina (o las IAs del edificio)
  if (epoch !== officeEpoch) return;
  if (openNew) newChat();
  if (officeChatOn) loadOfficeChat().catch(err => toast(err.message, true));
  await Promise.all([loadChats(), loadMemory()]);
}

let officeEditing = null; // id de la oficina que se configura (null = nueva)
function openOfficeDialog(id) {
  const o = id ? oficinas.find(x => x.id === id) : null;
  officeEditing = o?.id || null;
  $('officeDlgTitle').textContent = o ? t('ui.office.editTitle', { name: o.nombre.toUpperCase() }) : t('ui.office.newTitle');
  $('officeSave').textContent = o ? t('ui.office.save') : t('ui.office.create');
  $('officeName').value = o?.nombre || '';
  $('officeDescIn').value = o?.descripcion || '';
  $('officeColor').value = o?.color || '#4fd1c5';
  $('officeTeam').innerHTML = agents.filter(a => !a.bot).map(a => `<label style="--c:${esc(a.color)}"><input type="checkbox" value="${esc(a.id)}" ${o?.equipo?.includes(a.id) ? 'checked' : ''}> ${esc(a.name.toUpperCase())}</label>`).join('');
  $('officeKeys').hidden = !o;
  $('officeKeyShow').hidden = true;
  renderOfficeKeys(o);
  // Con empleados, el equipo son ellos: la lista de IAs permitidas no aplica.
  const staff = o?.empleados?.length ? o.empleados : null;
  $('officeTeamSet').hidden = !!staff;
  $('officeStaff').hidden = !staff;
  if (staff) {
    $('officeStaffList').innerHTML = staff.map(e => `<li data-emp="${esc(e.id)}" tabindex="0"><b>${esc(e.nombre)}</b> · ${esc(e.puesto)} <span class="muted">· ${esc(e.modelo?.cli)} ${esc(e.modelo?.id ?? '')}${e.activo === false ? t('ui.office.off') : ''}</span></li>`).join('');
    const epoch = officeEpoch, officeId = o.id;
    api(`/api/oficinas/${encodeURIComponent(officeId)}/bitacora`).then(lines => {
      // Una bitácora que llega tarde no puede pintarse en la ficha de otra oficina.
      if (epoch !== officeEpoch || officeEditing !== officeId) return;
      $('officeLog').innerHTML = lines.slice(-12).reverse().map(l => `<li>${esc(l.replace(/^- /, ''))}</li>`).join('') || `<li class="muted">${t('ui.office.noEntries')}</li>`;
    }).catch(() => {});
  }
  $('officeBots').hidden = !o;
  if (o) loadOfficeBots(o.id).catch(err => { $('officeHint').textContent = err.message; });
  $('officeHint').textContent = '';
  $('officeDialog').showModal();
}

function renderOfficeKeys(o) {
  $('officeKeyList').innerHTML = (o?.llaves || []).map(k => `<li><span>🔑 <b>${esc(k.nombre)}</b> <small class="muted">…${esc(k.pista || '')}${t('ui.office.keyCreatedOn', { date: esc(new Date(k.creada).toLocaleDateString(I18N.lang === 'es' ? 'es' : 'en')) })}</small></span>
    <button type="button" class="btn ghost small" data-revoke="${esc(k.nombre)}">${t('ui.office.revoke')}</button></li>`).join('') || `<li class="muted">${t('ui.office.noKeys')}</li>`;
}

async function loadAgents() {
  const epoch = officeEpoch;
  const info = await api('/api/agents');
  if (epoch !== officeEpoch) return;
  agents = info.agents;
  globalCfg = info;
  workflowsMeta = info.workflows || [];
}

// ---------- Empleados (S1): asistente de alta y ficha ----------

let modelCatalog = null; // [{ id, name, kind, installed, modelos[] }] de /api/clis/modelos
const loadModels = async () => (modelCatalog ||= await api('/api/clis/modelos'));
const cliOf = cli => modelCatalog?.find(c => c.id === cli || c.kind === cli);
const modelText = m => (m ? `${cliOf(m.cli)?.name || m.cli} · ${m.id ?? t('ui.emp.accountDefault')}` : '—');

// Selector «CLI · modelo» con los modelos verificados de cada CLI (y el actual, aunque no esté en la lista).
function modelSelect(name, value, { allowNone = false } = {}) {
  const want = value ? { cli: cliOf(value.cli)?.id || value.cli, id: value.id ?? null } : null;
  const opt = (m, label, sel) => `<option value="${esc(JSON.stringify(m))}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  const opts = allowNone ? [`<option value="" ${want ? '' : 'selected'}>${t('ui.emp.none')}</option>`] : [];
  let found = false;
  for (const c of modelCatalog || []) {
    for (const id of c.modelos.length ? c.modelos : [null]) {
      const sel = !!want && want.cli === c.id && want.id === id;
      found ||= sel;
      opts.push(opt({ cli: c.id, id }, `${c.name} · ${id ?? t('ui.emp.accountDefault')}${c.installed ? '' : t('ui.emp.notInstalled')}`, sel));
    }
  }
  if (want && !found) opts.unshift(opt(value, `${modelText(value)}${t('ui.emp.unverified')}`, true));
  return `<select class="field" name="${name}">${opts.join('')}</select>`;
}
const readModel = v => (v ? JSON.parse(v) : null);

const PODER_KEYS = { moderar: 'ui.emp.power.moderate', aprobar_interno: 'ui.emp.power.approve', vetar: 'ui.emp.power.veto' };
// El asistente pinta JSON pegado antes de que el servidor lo valide. Una lista que no es lista no puede tumbar el paso 2.
const listText = v => Array.isArray(v) ? v.join('; ') : (typeof v === 'string' ? v : '');
const hasPoder = (v, k) => Array.isArray(v) ? v.includes(k) : v === k;
// Personaje con el que se le ve en la oficina. «Automático» = el reparto por defecto (la tripulación de la nave con ropa
// de oficina, Escenas.reparto). Cada selector lleva su propio nombre de grupo: el asistente pinta varios en un formulario.
let avatarGroup = 0;
function avatarPicker(e, team = []) {
  const cur = Escenas.PERSONAJES.includes(e.avatar?.base) ? e.avatar.base : '';
  const auto = Escenas.reparto(team.filter(x => x.activo !== false).map(x => ({ id: x.id, avatar: x.id === e.id ? null : x.avatar?.base })))[e.id];
  const owner = p => team.find(x => x.id !== e.id && x.activo !== false && x.avatar?.base === p)?.nombre;
  const name = `avatar-${++avatarGroup}`;
  const opt = (p, label, img) => `<label class="av-opt" title="${esc(label)}"><input type="radio" name="${name}" value="${p}" ${cur === p ? 'checked' : ''}>${img}</label>`;
  return `<fieldset class="wide emp-avatar" data-avatar><legend>${t('ui.emp.character')} <small class="muted">— ${t('ui.emp.characterHint')}</small></legend>
    ${opt('', t('ui.office.autoOrder', { auto: auto ? ` (${auto})` : '' }), `<span class="av-auto">AUTO${auto ? `<img src="/oficina/${esc(auto)}-1.png" alt="">` : ''}</span>`)}
    ${Escenas.PERSONAJES.map(p => opt(p, owner(p) ? `${p} · ${t('ui.emp.avatarTaken', { who: owner(p) })}` : p, `<img src="/oficina/${esc(p)}-1.png" alt="${esc(p)}"${owner(p) ? ' class="taken"' : ''}>`)).join('')}
  </fieldset>`;
}
function empFieldsHtml(e, team = []) {
  return `<div class="wz-grid">
    <label>${t('ui.emp.name')} <input class="field" name="nombre" maxlength="60" required value="${esc(e.nombre || '')}"></label>
    <label>${t('ui.emp.roleLabel')} <input class="field" name="puesto" maxlength="60" required value="${esc(e.puesto || '')}"></label>
    <label>${t('ui.emp.model')} ${modelSelect('modelo', e.modelo)}</label>
    <label>${t('ui.emp.reserve')} ${modelSelect('reserva', e.reserva, { allowNone: true })}</label>
    <label class="wide">${t('ui.emp.goal')} <input class="field" name="objetivo" maxlength="200" value="${esc(e.objetivo || '')}"></label>
    <label class="wide">${t('ui.emp.styleLabel')} <input class="field" name="estilo" maxlength="200" value="${esc(e.estilo || '')}"></label>
    <label class="wide">${t('ui.emp.doesNot')} <small class="muted">${t('ui.emp.doesNotHint')}</small> <input class="field" name="no_hace" maxlength="200" value="${esc(listText(e.no_hace))}"></label>
    <fieldset class="wide emp-powers"><legend>${t('ui.emp.powers')}</legend>${Object.entries(PODER_KEYS).map(([k, key]) =>
      `<label><input type="checkbox" name="poder" value="${k}" ${hasPoder(e.poderes, k) ? 'checked' : ''}> ${t(key)}</label>`).join('')}</fieldset>
    <label class="toggle wide"><input type="checkbox" name="degradable" ${e.degradable ? 'checked' : ''}> ${t('ui.emp.degradable')}</label>
    <label>${t('ui.emp.fastModel')} ${modelSelect('modelo_rapido', e.modelo_rapido, { allowNone: true })}</label>
    <label class="toggle"><input type="checkbox" name="activo" ${e.activo !== false ? 'checked' : ''}> ${t('ui.emp.active')}</label>
    ${avatarPicker(e, team)}
  </div>`;
}
function readEmp(root, prev = {}) {
  const v = n => root.querySelector(`[name="${n}"]`);
  const list = s => s.split(';').map(x => x.trim()).filter(Boolean);
  const out = {
    ...prev, nombre: v('nombre').value.trim(), puesto: v('puesto').value.trim(), modelo: readModel(v('modelo').value),
    reserva: readModel(v('reserva').value), objetivo: v('objetivo').value.trim(), estilo: v('estilo').value.trim(), no_hace: list(v('no_hace').value),
    poderes: [...root.querySelectorAll('[name=poder]:checked')].map(x => x.value), degradable: v('degradable').checked,
    modelo_rapido: readModel(v('modelo_rapido').value), activo: v('activo').checked,
  };
  if (!out.degradable) out.modelo_rapido = null;
  const picked = root.querySelector('[data-avatar] input:checked');
  if (picked) {
    const { base, ...rest } = prev.avatar && typeof prev.avatar === 'object' ? prev.avatar : {};
    if (picked.value) out.avatar = { ...rest, base: picked.value };
    else if (Object.keys(rest).length) out.avatar = rest;
    else delete out.avatar;
  }
  out.id ||= out.nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/)[0].replace(/[^a-z0-9-]/g, '') || `emp-${Date.now() % 1e5}`;
  return out;
}

// Ficha del empleado: clic en su estación o en su personaje. Guardar = PATCH de la oficina (el servidor valida todo).
// empEditing guarda la oficina y la época: cerrar el diálogo no basta, porque la ficha se abre después de un await.
let empEditing = null;
async function openEmployee(id) {
  const o = officeNow();
  const e = (o.empleados || []).find(x => x.id === id);
  if (!e) return;
  const epoch = officeEpoch, officeId = o.id;
  await loadModels();
  if (epoch !== officeEpoch || officeId !== oficina) return;
  empEditing = { id, officeId, epoch };
  const a = agentOf(id), s = stationStats(id);
  $('empTitle').textContent = t('ui.emp.cardTitle', { name: e.nombre.toUpperCase() });
  const turns = (current?.messages || []).filter(m => m.kind === 'agent' && m.agentId === id);
  const reservaTxt = e.reserva ? ` · ${t('ui.tip.reserve')} ${esc(modelText(e.reserva))}` : '';
  const inMissionTxt = s?.turns ? `<span class="muted">${t('ui.emp.inMissionStats', { turns: s.turns, avg: s.avgScore ?? '–', reserva: turns.some(m => m.reserva) ? t('ui.emp.workedReserve') : '' })}</span>` : '';
  $('empHead').innerHTML = `<div class="emp-card" style="--c:${esc(a.color || '#4fd1c5')}"><b>${esc(e.nombre)}</b><span>${esc(e.puesto)} · ${esc(o.nombre)}</span>
    <span class="muted">${t('ui.emp.worksWith', { model: esc(modelText(e.modelo)), reserva: reservaTxt })}</span>
    ${inMissionTxt}
    <span class="muted">${t('ui.emp.modelNote')}</span></div>`;
  $('empFields').innerHTML = empFieldsHtml(e, o.empleados || []);
  $('empHint').textContent = '';
  $('empDialog').showModal();
}
async function saveEmployee() {
  const editing = empEditing;
  const o = officeNow();
  if (!editing || editing.officeId !== o.id || editing.epoch !== officeEpoch) {
    $('empDialog').close();
    toast(t('ui.emp.officeChanged'), true);
    return;
  }
  const next = (o.empleados || []).map(e => (e.id === editing.id ? readEmp($('empFields'), e) : e));
  const epoch = editing.epoch, officeId = editing.officeId;
  try {
    await api(`/api/oficinas/${encodeURIComponent(officeId)}`, { method: 'PATCH', body: JSON.stringify({ empleados: next }) });
    if (epoch !== officeEpoch) return;
    $('empDialog').close();
    await loadOffices();
    if (epoch !== officeEpoch) return;
    await loadAgents();
    if (epoch !== officeEpoch) return;
    if (!currentId) fillComposerFromConfig(null);
    renderStations();
    toast(t('ui.emp.savedToast'));
  } catch (err) { $('empHint').textContent = err.message; }
}
$('empForm').addEventListener('submit', ev => { ev.preventDefault(); saveEmployee(); });
// Clic en la estación o en el personaje de un empleado → su ficha.
document.addEventListener('click', e => {
  const el = e.target.closest('.station[data-hover^="agent:"], .actor[data-hover^="agent:"], .staff-list [data-emp]');
  if (!el) return;
  const id = el.dataset.emp || el.dataset.hover.slice(6);
  if (agentOf(id).empleado || el.dataset.emp) openEmployee(id).catch(err => toast(err.message, true));
});

// Asistente de alta: marca → empleados → revisar. La plantilla «Redacción de contenido» es el ejemplo de Acme Ciencia
// sin rutinas ni conexiones (eso llega en S2).
const wz = { step: 1, empleados: [], tpl: null };
async function openWizard() {
  const epoch = officeEpoch;
  await loadModels();
  if (epoch !== officeEpoch) return;
  Object.assign(wz, { step: 1, empleados: [], tpl: null });
  $('wzForm').reset();
  $('wzPaste').hidden = true;
  $('wzTplHint').textContent = '';
  wzShow();
  $('simWizard').showModal();
}
function wzShow() {
  document.querySelectorAll('#simWizard .wz-step').forEach(s => { s.hidden = Number(s.dataset.step) !== wz.step; });
  document.querySelectorAll('#wzSteps li').forEach((li, i) => li.classList.toggle('on', i + 1 <= wz.step));
  $('wzStepName').textContent = t(`ui.wz.stepName${wz.step}`);
  $('wzBack').hidden = wz.step === 1;
  $('wzNext').textContent = wz.step === 3 ? t('ui.wz.createSim') : t('ui.wz.next');
  $('wzHint').textContent = '';
  if (wz.step === 2) wzStaff();
}
function wzStaff() {
  $('wzStaff').innerHTML = wz.empleados.map((e, i) => `<details class="wz-emp" data-i="${i}" ${e._open ? 'open' : ''}>
    <summary><b>${esc(e.nombre || t('ui.emp.newEmployee'))}</b> · ${esc(e.puesto || '—')} · <span class="muted">${esc(modelText(e.modelo))}</span>${e.activo === false ? ` <span class="muted">(${t('ui.emp.turnedOff')})</span>` : ''}
      <button type="button" class="btn ghost small" data-del="${i}" title="${t('ui.emp.remove')}">✕</button></summary>${empFieldsHtml(e, wz.empleados)}</details>`).join('') || `<p class="muted">${t('ui.emp.noEmployees')}</p>`;
}
const wzSync = () => $('wzStaff').querySelectorAll('.wz-emp').forEach(d => { const i = Number(d.dataset.i); wz.empleados[i] = { ...readEmp(d, wz.empleados[i]), _open: d.open }; });
const wzMarca = () => ({ nombre: $('wzBrand').value.trim() || $('wzName').value.trim(), idioma: $('wzLang').value.trim() || I18N.lang,
  publico: $('wzAudience').value.trim(), voz: $('wzVoice').value.trim(), evitar: $('wzAvoid').value.split(';').map(x => x.trim()).filter(Boolean),
  ...(wz.tpl?.marca ? { zona: wz.tpl.marca.zona, sitio: wz.tpl.marca.sitio } : {}) });
function wzFill(def) {
  wz.tpl = def;
  $('wzName').value = def.nombre || '';
  $('wzDesc').value = def.descripcion || '';
  const m = def.marca || {};
  $('wzBrand').value = m.nombre || ''; $('wzLang').value = m.idioma || 'es'; $('wzAudience').value = m.publico || '';
  $('wzVoice').value = m.voz || ''; $('wzAvoid').value = listText(m.evitar);
  wz.empleados = (def.empleados || []).map(e => ({ ...e }));
}
$('wzTplBtn').addEventListener('click', async () => {
  const [tpl] = await api('/api/oficinas/plantillas');
  wzFill(tpl.oficina);
  $('wzTplHint').textContent = t('ui.wz.tplHint', { name: tpl.nombre, count: tpl.oficina.empleados.length });
});
$('wzPasteBtn').addEventListener('click', () => { $('wzPaste').hidden = !$('wzPaste').hidden; $('wzPaste').focus(); });
$('wzPaste').addEventListener('change', () => {
  try { wzFill(JSON.parse($('wzPaste').value)); $('wzTplHint').textContent = t('ui.wz.pasteOk'); }
  catch (err) { $('wzTplHint').textContent = t('ui.wz.pasteErr', { msg: err.message }); }
});
$('wzAddEmp').addEventListener('click', () => { wzSync(); wz.empleados.push({ nombre: '', puesto: '', modelo: { cli: modelCatalog[0]?.id, id: modelCatalog[0]?.modelos[0] ?? null }, poderes: [], _open: true }); wzStaff(); });
$('wzStaff').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; e.preventDefault(); wzSync(); wz.empleados.splice(Number(b.dataset.del), 1); wzStaff(); });
$('wzBack').addEventListener('click', () => { if (wz.step === 2) wzSync(); wz.step--; wzShow(); });
const wzClean = list => list.map(({ _open, ...e }) => e);
$('wzForm').addEventListener('submit', async e => {
  e.preventDefault();
  const epoch = officeEpoch;
  if (wz.step === 1 && !$('wzName').value.trim()) return ($('wzHint').textContent = t('ui.wz.nameRequired'));
  if (wz.step === 2) wzSync();
  if (wz.step === 2 && !wz.empleados.some(x => x.activo !== false)) return ($('wzHint').textContent = t('ui.wz.empRequired'));
  if (wz.step < 3) {
    wz.step++;
    wzShow();
    if (wz.step === 3) {
      const v = await api('/api/oficinas/validar', { method: 'POST', body: JSON.stringify({ marca: wzMarca(), empleados: wzClean(wz.empleados) }) });
      if (epoch !== officeEpoch) return;
      $('wzReview').innerHTML = `<div class="emp-card"><b>${esc($('wzName').value)}</b><span>${esc(wzMarca().nombre)} · ${esc(wzMarca().voz || t('ui.emp.noVoiceDefined'))}</span>
        <span class="muted">${t('ui.wz.reviewLevel')}</span></div>
        <ul class="wz-list">${wz.empleados.map(x => `<li>${x.activo === false ? '○' : '●'} <b>${esc(x.nombre)}</b> · ${esc(x.puesto)} · ${esc(modelText(x.modelo))}${x.reserva ? ` <span class="muted">${t('ui.wz.reserveParen', { model: esc(modelText(x.reserva)) })}</span>` : ''}</li>`).join('')}</ul>
        ${v.errores.length ? `<div class="wz-err"><b>${t('ui.wz.errorsFound')}</b><ul>${v.errores.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : `<div class="wz-ok">${t('ui.wz.noErrors')}</div>`}
        ${v.avisos.length ? `<div class="wz-warn"><b>${t('ui.wz.warnings')}</b><ul>${v.avisos.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}`;
      $('wzNext').disabled = v.errores.length > 0;
    }
    return;
  }
  try {
    const o = await api('/api/oficinas', { method: 'POST', body: JSON.stringify({
      nombre: $('wzName').value.trim(), descripcion: $('wzDesc').value.trim(), color: $('wzColor').value,
      marca: wzMarca(), empleados: wzClean(wz.empleados), ...(wz.tpl?.escena ? { escena: wz.tpl.escena } : {}),
    }) });
    if (epoch !== officeEpoch) {
      await loadOffices();
      toast(t('ui.office.created', { name: o.nombre }));
      return;
    }
    $('simWizard').close();
    await loadOffices();
    if (epoch !== officeEpoch) return;
    await setOffice(o.id);
    toast(t('ui.office.createdSummary', { name: o.nombre, count: o.empleados.filter(x => x.activo !== false).length }));
  } catch (err) { $('wzHint').textContent = err.message; }
});
$('wzBack').addEventListener('click', () => { $('wzNext').disabled = false; });

$('officeSel').addEventListener('change', e => setOffice(e.target.value).catch(err => toast(err.message, true)));
$('officeNewBtn').addEventListener('click', () => openWizard().catch(err => toast(err.message, true)));
$('officeCfgBtn').addEventListener('click', () => openOfficeDialog(oficina));
$('officeForm').addEventListener('submit', async e => {
  e.preventDefault();
  const epoch = officeEpoch, editingId = officeEditing;
  const body = {
    nombre: $('officeName').value.trim(), descripcion: $('officeDescIn').value.trim(), color: $('officeColor').value,
    equipo: [...$('officeTeam').querySelectorAll('input:checked')].map(i => i.value),
  };
  try {
    const o = await api(editingId ? `/api/oficinas/${encodeURIComponent(editingId)}` : '/api/oficinas', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    if (epoch !== officeEpoch) return;
    $('officeDialog').close();
    await loadOffices();
    if (epoch !== officeEpoch) return;
    if (!editingId) { await setOffice(o.id); toast(t('ui.office.createdFull', { name: o.nombre })); }
    else { renderOffices(); fillComposerFromConfig(null); toast(t('ui.office.updated')); }
  } catch (err) { $('officeHint').textContent = err.message; }
});
$('officeKeyBtn').addEventListener('click', async () => {
  const nombre = $('officeKeyName').value.trim();
  if (!nombre) return ($('officeHint').textContent = t('ui.office.keyNameRequired'));
  const epoch = officeEpoch, officeId = officeEditing;
  try {
    const k = await api(`/api/oficinas/${encodeURIComponent(officeId)}/llaves`, { method: 'POST', body: JSON.stringify({ nombre }) });
    // La llave solo se muestra una vez: si la oficina cambió, no se pinta en el diálogo de la otra.
    if (epoch !== officeEpoch || officeEditing !== officeId) {
      toast(t('ui.office.keyCreated', { name: k.nombre, office: officeId, key: k.llave }));
      return;
    }
    $('officeKeyName').value = '';
    $('officeKeyShow').hidden = false;
    $('officeKeyShow').innerHTML = `${t('ui.office.keyHeading', { name: esc(k.nombre), key: esc(k.llave) })}
      <span class="muted">${t('ui.office.keyHint', { name: esc(officeNow().nombre) })}</span>`;
    await loadOffices();
    if (epoch !== officeEpoch || officeEditing !== officeId) return;
    renderOfficeKeys(oficinas.find(x => x.id === officeId));
  } catch (err) { $('officeHint').textContent = err.message; }
});
// ---------- Grok Bots de la oficina (empleados externos por webhook) ----------
const ago = iso => { const s = Math.round((Date.now() - new Date(iso)) / 1000); return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`; };
const WIZARD_TEXT = {
  'wizard.gate.ok': v => t('wizard.gate.ok', v),
  'wizard.gate.down': v => t('wizard.gate.down', v),
  'wizard.tunnel.ok': v => t('wizard.tunnel.ok', v),
  'wizard.tunnel.missing': v => t('wizard.tunnel.missing', v),
  'wizard.tunnel.bad': v => t('wizard.tunnel.bad', v),
  'wizard.tunnel.down': v => t('wizard.tunnel.down', v),
};
async function loadOfficeBots(officeId) {
  const epoch = officeEpoch;
  const [list, ajustes, wizard, chat] = await Promise.all([
    api(`/api/oficinas/${encodeURIComponent(officeId)}/bots`),
    api('/api/bots/ajustes'),
    api(`/api/oficinas/${encodeURIComponent(officeId)}/bots/asistente`),
    api(`/api/oficinas/${encodeURIComponent(officeId)}/chat`),
  ]);
  if (epoch !== officeEpoch || officeEditing !== officeId) return;
  if (document.activeElement !== $('botsUrl')) $('botsUrl').value = ajustes.publicUrl || '';
  const gate = wizard.comprobaciones.find(c => c.id === 'puerta');
  $('botGateBtn').hidden = !gate || gate.ok;
  $('botChecks').innerHTML = wizard.comprobaciones.map(c => `<li class="wz-check${c.ok ? ' ok' : ''}"><i></i><span>${esc((WIZARD_TEXT[c.clave] || (v => c.clave))(c.vars || {}))}</span></li>`).join('');
  $('botInstruction').textContent = wizard.bloques.instruccion;
  $('botSample').textContent = wizard.bloques.json;
  const hostOpts = [`<option value="">${esc(t('wizard.hostNone'))}</option>`].concat(chat.miembros.map(m => `<option value="${esc(m.sceneId)}"${m.sceneId === chat.anfitrion ? ' selected' : ''}>${esc(m.nombre)} · ${esc(m.puesto || m.avatar || '')}</option>`));
  if (document.activeElement !== $('chatHost')) $('chatHost').innerHTML = hostOpts.join('');
  $('officeBotList').innerHTML = list.map(b => `<li style="--c:${esc(b.color)}"><span>🤖 <b style="color:var(--c)">${esc(b.nombre)}</b>
      <small class="muted">${esc(b.puesto || '')}${b.puesto ? ' · ' : ''}${b.sinLlave ? esc(t('wizard.needsKey')) : `${esc(b.host)} · ${b.firma === 'standard-webhooks' ? t('ui.bot.signature') : t('ui.bot.bearer')} …${esc(b.pista)}`} ·
      ${b.ultimaRespuesta ? t('ui.bot.repliedAgo', { time: esc(ago(b.ultimaRespuesta)) }) : t('ui.bot.neverReplied')}</small></span>
      <button type="button" class="btn ghost small" data-bot-test="${esc(b.id)}" title="${t('ui.bot.testTip')}" ${b.sinLlave ? 'disabled' : ''}>${t('ui.bot.testBtn')}</button>
      <button type="button" class="btn ghost small" data-bot-copy="${esc(b.id)}">${t('wizard.copy')}</button>
      ${b.sinLlave ? `<button type="button" class="btn ghost small" data-bot-key="${esc(b.id)}">${t('wizard.addKey')}</button>` : ''}
      <button type="button" class="btn ghost small" data-bot-del="${esc(b.id)}">${t('ui.bot.delBtn')}</button></li>`).join('')
    || `<li class="muted">${t('ui.bot.noBots')}</li>`;
  const others = oficinas.filter(x => x.id !== officeId && x.id !== 'edificio');
  $('botCopyDest').innerHTML = others.map(x => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join('') || `<option value="">${esc(t('wizard.noOtherOffice'))}</option>`;
}
$('botsUrlBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/bots/ajustes', { method: 'PUT', body: JSON.stringify({ publicUrl: $('botsUrl').value }) });
    $('botsUrl').value = r.publicUrl;
    toast(r.publicUrl ? t('ui.bot.publicSaved') : t('ui.bot.publicCleared'));
    if (officeEditing) await loadOfficeBots(officeEditing);
  } catch (err) { $('officeHint').textContent = err.message; }
});
$('botAddBtn').addEventListener('click', async () => {
  const officeId = officeEditing;
  try {
    const b = await api(`/api/oficinas/${encodeURIComponent(officeId)}/bots`, { method: 'POST', body: JSON.stringify({
      nombre: $('botName').value, puesto: $('botRole').value, avatar: $('botAvatar').value, color: $('botColor').value, url: $('botUrl').value, llave: $('botKey').value,
    }) });
    for (const id of ['botName', 'botRole', 'botUrl', 'botKey']) $(id).value = ''; // la llave no se queda en la página
    toast(t('ui.bot.joined', { name: b.nombre }));
    await Promise.all([loadOfficeBots(officeId), loadAgents()]);
    fillComposerFromConfig(null);
  } catch (err) { $('officeHint').textContent = err.message; }
});
let botCopyId = null;
$('officeBotList').addEventListener('click', async e => {
  const test = e.target.closest('[data-bot-test]'), del = e.target.closest('[data-bot-del]');
  const copy = e.target.closest('[data-bot-copy]'), keyBtn = e.target.closest('[data-bot-key]');
  const officeId = officeEditing;
  try {
    if (test) {
      toast(t('ui.bot.testWaiting'));
      const r = await api(`/api/oficinas/${encodeURIComponent(officeId)}/bots/${encodeURIComponent(test.dataset.botTest)}/probar`, { method: 'POST', body: '{}' });
      toast(r.pong ? t('ui.bot.pong', { ms: r.ms }) : t('ui.bot.testFailed', { err: r.texto || r.error || (r.status ? `HTTP ${r.status}` : t('ui.bot.noPong')) }), !r.pong);
      await loadOfficeBots(officeId);
    }
    if (copy) {
      botCopyId = copy.dataset.botCopy;
      $('botCopyKey').checked = false;
      $('botCopyBox').hidden = false;
    }
    if (keyBtn) {
      await api(`/api/oficinas/${encodeURIComponent(officeId)}/bots/${encodeURIComponent(keyBtn.dataset.botKey)}/secreto`, { method: 'POST', body: JSON.stringify({ url: $('botUrl').value, llave: $('botKey').value }) });
      $('botUrl').value = '';
      $('botKey').value = '';
      toast(t('wizard.keySaved'));
      await Promise.all([loadOfficeBots(officeId), loadAgents()]);
    }
    if (del) {
      await api(`/api/oficinas/${encodeURIComponent(officeId)}/bots/${encodeURIComponent(del.dataset.botDel)}`, { method: 'DELETE' });
      toast(t('ui.bot.removed'));
      await Promise.all([loadOfficeBots(officeId), loadAgents()]);
      fillComposerFromConfig(null);
    }
  } catch (err) { toast(err.message, true); }
});
async function copyBotText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(t('wizard.copied'));
}
$('copyInstruction').addEventListener('click', () => copyBotText($('botInstruction').textContent));
$('copyJson').addEventListener('click', () => copyBotText($('botSample').textContent));
$('botGateBtn').addEventListener('click', async () => {
  try {
    const r = await api('/api/bots/puerta', { method: 'POST', body: '{}' });
    toast(r.already ? t('wizard.gate.already') : t('wizard.gate.started'));
    if (officeEditing) await loadOfficeBots(officeEditing);
  } catch (err) { toast(err.message, true); }
});
$('chatHostBtn').addEventListener('click', async () => {
  const officeId = officeEditing;
  try {
    await api(`/api/oficinas/${encodeURIComponent(officeId)}/chat`, { method: 'PUT', body: JSON.stringify({ anfitrion: $('chatHost').value || null }) });
    toast(t('wizard.hostSaved'));
  } catch (err) { $('officeHint').textContent = err.message; }
});
// ---------- Chat de la oficina (no es una misión) ----------
let chatMembersLive = [];
let chatSeen = new Set();
function setSide(which) {
  officeChatOn = which === 'chat' && oficina !== 'edificio';
  $('sideMissions').classList.toggle('on', !officeChatOn);
  $('sideChat').classList.toggle('on', officeChatOn);
  $('sideMissions').setAttribute('aria-pressed', String(!officeChatOn));
  $('sideChat').setAttribute('aria-pressed', String(officeChatOn));
  for (const id of ['newChatBtn', 'chatFilter']) $(id).hidden = officeChatOn;
  document.querySelector('.missions .label').hidden = officeChatOn;
  $('chatList').hidden = officeChatOn;
  $('officeChat').hidden = !officeChatOn;
  $('composer').hidden = officeChatOn;
  document.querySelector('.board-head').hidden = officeChatOn;
  if (officeChatOn) loadOfficeChat().catch(err => toast(err.message, true));
}
$('sideMissions').addEventListener('click', () => setSide('missions'));
$('sideChat').addEventListener('click', () => setSide('chat'));

function chatAuthor(m) {
  const a = m.autor || {};
  const who = a.tipo === 'owner' ? t('chat.you') : a.nombre || '';
  const role = a.puesto ? ` · ${a.puesto}` : a.avatar ? ` · ${a.avatar}` : '';
  return `${who}${a.tipo === 'owner' ? '' : role}`;
}
function renderChatMessage(m) {
  if (chatSeen.has(m.id)) {
    const old = document.querySelector(`[data-chat-id="${CSS.escape(m.id)}"]`);
    if (old) old.outerHTML = chatMessageHtml(m);
    return;
  }
  chatSeen.add(m.id);
  $('chatLog').insertAdjacentHTML('beforeend', chatMessageHtml(m));
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
}
function chatMessageHtml(m) {
  const fail = m.fallo ? `<div class="chat-fail"><b>${esc(m.fallo.label || '')}</b> ${esc(m.fallo.detail || '')} <span class="muted">${esc(m.fallo.hint || '')}</span></div>` : '';
  return `<article class="chat-msg from-${esc(m.autor?.tipo || 'system')}${m.fallo ? ' failed' : ''}" data-chat-id="${esc(m.id)}">
    <label><input type="checkbox" data-chat-pick="${esc(m.id)}"> <b>${esc(chatAuthor(m))}</b></label>
    <p>${esc(m.texto || '')}</p>${fail}</article>`;
}
async function loadOfficeChat() {
  if (oficina === 'edificio') return;
  const epoch = officeEpoch, office = oficina;
  const data = await api(`/api/oficinas/${encodeURIComponent(office)}/chat`);
  if (epoch !== officeEpoch || office !== oficina) return;
  chatMembersLive = data.miembros || [];
  chatSeen = new Set();
  $('chatMembers').innerHTML = chatMembersLive.map(m => `<li style="--c:${esc(m.color || '#c062d6')}"><b>@${esc(m.mencion)}</b> ${esc(m.nombre)} <span class="muted">${esc(m.puesto || m.avatar || '')}${m.tipo === 'bot' ? ` · ${esc(t('chat.bot'))}` : ''}${data.anfitrion === m.sceneId ? ` · ${esc(t('wizard.host'))}` : ''}</span></li>`).join('')
    || `<li class="muted">${esc(t('chat.emptyMembers'))}</li>`;
  $('chatLog').innerHTML = data.mensajes?.length ? '' : `<p class="muted chat-empty">${esc(t('chat.emptyLog'))}</p>`;
  for (const m of data.mensajes || []) renderChatMessage(m);
}
function onOfficeChat(ev) {
  if (!officeChatOn || ev.oficina !== oficina) {
    if (ev.fase === 'hablando' && ev.quien) setLive(ev.quien.sceneId, { activity: t('chat.talking'), said: '', started: Date.now() });
    if (ev.fase === 'callado' && ev.quien) setLive(ev.quien.sceneId, null);
    if (ev.fase === 'delta' && ev.quien) setLive(ev.quien.sceneId, { activity: t('chat.talking'), said: String(ev.texto || '').slice(-80) });
    return;
  }
  if (ev.fase === 'hablando' && ev.quien) setLive(ev.quien.sceneId, { activity: t('chat.talking'), said: '', started: Date.now() });
  if (ev.fase === 'callado' && ev.quien) setLive(ev.quien.sceneId, null);
  if (ev.fase === 'delta' && ev.quien) {
    setLive(ev.quien.sceneId, { activity: t('chat.talking'), said: String(ev.texto || '').slice(-80) });
    let live = document.querySelector(`[data-chat-live="${CSS.escape(ev.quien.sceneId)}"]`);
    if (!live) {
      $('chatLog').insertAdjacentHTML('beforeend', `<article class="chat-msg live" data-chat-live="${esc(ev.quien.sceneId)}"><b>${esc(ev.quien.nombre)}</b><p></p></article>`);
      live = document.querySelector(`[data-chat-live="${CSS.escape(ev.quien.sceneId)}"]`);
    }
    live.querySelector('p').textContent = ev.texto || '';
  }
  if (ev.fase === 'mensaje' && ev.mensaje) {
    document.querySelector(`[data-chat-live="${CSS.escape(ev.mensaje.autor?.sceneId || '')}"]`)?.remove();
    renderChatMessage(ev.mensaje);
  }
}
$('chatForm').addEventListener('submit', async e => {
  e.preventDefault();
  const texto = $('chatInput').value.trim();
  if (!texto || oficina === 'edificio') return;
  $('chatInput').disabled = true;
  try {
    const r = await api(`/api/oficinas/${encodeURIComponent(oficina)}/chat`, { method: 'POST', body: JSON.stringify({ texto }) });
    $('chatInput').value = '';
    $('chatSuggest').hidden = true;
    document.querySelectorAll('[data-chat-live]').forEach(el => el.remove());
    for (const m of r.mensajes || []) renderChatMessage(m);
  } catch (err) { toast(err.message, true); }
  finally { $('chatInput').disabled = false; $('chatInput').focus(); }
});
$('chatInput').addEventListener('input', () => {
  const upto = $('chatInput').value.slice(0, $('chatInput').selectionStart);
  const m = upto.match(/(^|\s)@([\w.-]*)$/);
  if (!m) { $('chatSuggest').hidden = true; return; }
  const q = m[2].toLowerCase();
  const hits = chatMembersLive.filter(x => x.mencion.startsWith(q) || x.nombre.toLowerCase().startsWith(q)).slice(0, 6);
  $('chatSuggest').hidden = !hits.length;
  $('chatSuggest').innerHTML = hits.map(h => `<button type="button" data-mention="${esc(h.mencion)}">@${esc(h.mencion)} <span class="muted">${esc(h.nombre)}</span></button>`).join('');
});
$('chatSuggest').addEventListener('click', e => {
  const b = e.target.closest('[data-mention]');
  if (!b) return;
  const ta = $('chatInput');
  const upto = ta.value.slice(0, ta.selectionStart);
  const rest = ta.value.slice(ta.selectionStart);
  ta.value = upto.replace(/@[\w.-]*$/, `@${b.dataset.mention} `) + rest;
  $('chatSuggest').hidden = true;
  ta.focus();
});
$('chatToMission').addEventListener('click', async () => {
  const ids = [...document.querySelectorAll('[data-chat-pick]:checked')].map(el => el.dataset.chatPick);
  if (!ids.length) return toast(t('chat.pick'), true);
  try {
    const draft = await api(`/api/oficinas/${encodeURIComponent(oficina)}/chat/mision`, { method: 'POST', body: JSON.stringify({ ids }) });
    setSide('missions');
    newChat();
    $('input').value = `${draft.titulo}\n\n${draft.texto}`;
    openComposer();
    $('input').focus();
    toast(t('chat.prefilled'));
  } catch (err) { toast(err.message, true); }
});

$('botCopyGo').addEventListener('click', async () => {
  const officeId = officeEditing;
  if (!botCopyId || !$('botCopyDest').value) return;
  const incluirLlave = $('botCopyKey').checked;
  if (incluirLlave && !window.confirm(t('wizard.copyConfirm'))) return;
  try {
    const bot = await api(`/api/oficinas/${encodeURIComponent(officeId)}/bots/${encodeURIComponent(botCopyId)}/copiar`, { method: 'POST', body: JSON.stringify({ destino: $('botCopyDest').value, incluirLlave }) });
    $('botCopyBox').hidden = true;
    $('botCopyKey').checked = false;
    toast(bot.llaveCopiada ? t('wizard.copiedKey', { name: bot.nombre, office: $('botCopyDest').value }) : t('wizard.copiedBot', { name: bot.nombre, office: $('botCopyDest').value }));
  } catch (err) { toast(err.message, true); }
});

$('officeKeyList').addEventListener('click', async e => {
  const b = e.target.closest('[data-revoke]');
  if (!b) return;
  const epoch = officeEpoch, officeId = officeEditing, nombre = b.dataset.revoke;
  try {
    await api(`/api/oficinas/${encodeURIComponent(officeId)}/llaves/${encodeURIComponent(nombre)}`, { method: 'DELETE' });
    if (epoch !== officeEpoch || officeEditing !== officeId) return;
    await loadOffices();
    if (epoch !== officeEpoch || officeEditing !== officeId) return;
    renderOfficeKeys(oficinas.find(x => x.id === officeId));
    toast(t('ui.office.keyRevoked', { name: nombre }));
  } catch (err) { toast(err.message, true); }
});

async function openChat(id, { keepLog = false } = {}) {
  const epoch = ++chatEpoch, selection = officeEpoch;
  const switching = id !== currentId;
  currentId = id;
  const result = await api(`/api/chats/${encodeURIComponent(id)}`);
  if (epoch !== chatEpoch || selection !== officeEpoch) return;
  current = result;
  // Un enlace (#m=…) puede llevar a una misión de otra oficina: se cambia a esa oficina.
  if (current.oficina && current.oficina !== oficina) await setOffice(current.oficina, { openNew: false });
  if (currentId !== id || current !== result) return;
  if (switching) lastWrite = null;
  live = {};
  for (const w of current.workingAgents || []) live[w.agentId] = { activity: w.activity, said: w.said, started: w.started, phase: w.phase };
  if (current.workingAgent && !live[current.workingAgent]) live[current.workingAgent] = { activity: current.activity, started: current.progress?.turnStarted };
  $('chatTitle').textContent = current.title;
  $('openFolderBtn').hidden = false;
  $('exportBtn').hidden = false;
  syncHash();
  if (switching) { fillComposerFromConfig(current.config); globalStats = null; composerOpen = false; }
  if (switching || !keepLog) await loadActivity();
  if (currentId !== id || current !== result) return;
  renderAll();
  loadCierre();
  renderChats();
}

function renderAll() {
  renderTopStatus();
  renderStations();
  renderProgress(current?.progress);
  renderReports();
  renderDebate();
  renderHandoff();
  renderAgents();
  renderCharts();
  renderFiles();
  renderChatMeta();
  renderNow();
  renderSituation();
  setRunning(!!current?.running);
  $('deliverBtn').hidden = !current?.deliverables?.main;
  if ($('viewer').open && pv.chatId === currentId) renderPvList();
}

function newChat() {
  ++chatEpoch;
  composerOpen = false;
  currentId = null; current = null; live = {}; logEntries = []; globalStats = null; lastWrite = null;
  $('chatTitle').textContent = t('ui.newMission');
  $('openFolderBtn').hidden = true;
  $('exportBtn').hidden = true;
  syncHash();
  fillComposerFromConfig(null);
  renderAll();
  renderLog();
  renderChats();
  hoyDia = null;
  loadHoy();
  if (oficina === 'edificio') $('input').focus(); else if (document.activeElement === $('input')) $('input').blur(); // en una oficina, primero el tablero «Hoy»
}

// ---------- Hoy en la oficina (§4.5) ----------
// Lo primero al entrar en una oficina sin misión abierta. Solo hechos confirmados por el servidor (lib/hoy.js).

let hoyData = null, hoyDia = null;
async function loadHoy() {
  if (oficina === 'edificio') { hoyData = null; return; }
  const epoch = officeEpoch, office = oficina;
  const data = await api(`/api/oficinas/${encodeURIComponent(office)}/hoy?lang=${globalThis.I18N?.lang || ''}${hoyDia ? `&dia=${hoyDia}` : ''}`).catch(() => null);
  if (epoch !== officeEpoch || office !== oficina) return;
  hoyData = data;
  if (!current) renderReports();
}
const loadHoySoon = debounce(() => { if (!currentId) loadHoy(); }, 400);
const shiftDay = (dia, n) => { const d = new Date(`${dia}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function hoyHtml() {
  const h = hoyData;
  if (!h) return `<div class="empty"><h2>${t('ui.hoy.title')}</h2><p>${t('ui.hoy.loading')}</p></div>`;
  const g = h.gasto;
  const link = (x, inner) => (x.chatId ? `<a href="#" data-open-chat="${esc(x.chatId)}">${inner}</a>` : inner);
  const blk = (cls, title, body, n) => `<section class="hoy-blk ${cls}"><h3>${title}${n != null ? ` <b>(${n})</b>` : ''}</h3><div class="hoy-body">${body}</div></section>`;
  const none = txt => `<span class="muted">${txt}</span>`;
  const esperan = h.esperan.slice(0, 8).map(x => `<div class="hoy-item">${x.tipo === 'entrante'
    ? `<a href="#" data-hoy-inbound>↘ ${esc(x.texto)}</a>` : link(x, esc(x.texto))}<span class="hoy-act">${esc(x.accion)}</span></div>`).join('');
  const hecho = h.hecho.map(x => `<div class="hoy-item st-${esc(x.estado)}"><span class="hoy-t">${esc(x.hora)}</span>${x.icono} ${link(x, `«${esc(x.titulo)}»`)}
    <span class="muted">${esc(x.texto)}${x.turnos ? t('ui.hoy.turnsPart', { n: x.turnos }) : ''}${x.nota != null ? t('ui.hoy.scorePart', { score: x.nota }) : ''}${x.quien.length ? ` · ${esc(x.quien.join(', '))}` : ''}</span></div>`).join('');
  const equipo = h.equipo.filter(e => e.activo).map(e => {
    const a = agentOf(e.id);
    const scoreTxt = e.nota != null ? t('ui.hoy.scorePart', { score: e.nota }) : '';
    const doing = e.ultimo ? t('ui.hoy.doing', { icon: e.ultimo.veredicto === 'ERROR' ? '⛔' : '✎', turns: e.turnos, score: scoreTxt, time: esc(e.ultimo.hora), title: esc(e.ultimo.titulo) }) : t('ui.hoy.noTurns');
    return `<button type="button" class="hoy-emp" data-emp="${esc(e.id)}" style="--c:${esc(a.color || '#4fd1c5')}" data-hover="txt:${t('ui.hoy.openCard', { name: esc(e.nombre) })}">
      <b>${esc(e.nombre)}</b><span>${esc(e.puesto)} · ${esc(e.modelo)}</span><small>${doing}${e.reserva ? t('ui.hoy.reservePart', { name: esc(e.reserva.a) }) : ''}</small></button>`;
  }).join('');
  const aprendido = h.aprendido.map(x => `<div class="hoy-item"><span class="hoy-t">${esc(x.hora)}</span>${esc(x.quien)} → ${x.archivos.map(f => `<a href="#" data-hoy-mem="${esc(f)}">${esc(f)}</a>`).join(', ')}
    <span class="muted">${t('ui.hoy.inLink', { link: link(x, t('ui.hoy.inMission')) })}</span></div>`).join('');
  const atencion = h.atencion.map(x => `<div class="hoy-item"><span class="hoy-t">${esc(x.hora)}</span>${link(x, esc(x.texto))}${x.pista ? ` <span class="muted">${esc(x.pista)}</span>` : ''}</div>`).join('');
  const gasto = `${g.turnosMedidos ? t('ui.hoy.measured', { tokens: fmtTokens(g.tokens), n: g.turnosMedidos }) : t('ui.hoy.noTokens')} · ${t('ui.hoy.minTurns', { min: g.minutos, turns: g.turnos })}${g.desconocidos ? ` · <span class="warn">${t('ui.hoy.unknownUsage', { n: g.desconocidos })}</span>` : ''}`;
  return `<div class="hoy">
    <header class="hoy-head">
      <div class="hoy-title"><button type="button" class="btn ghost small" data-hoy-day="-1" data-hover="txt:${t('ui.hoy.prevDay')}">◀</button>
        <h2>${h.hoy ? t('ui.hoy.today') : t('ui.hoy.day')} · ${esc(h.fecha)} · ${esc(h.oficina.nombre)}${h.oficina.marca && !h.oficina.nombre.includes(h.oficina.marca) ? ` <small>${esc(h.oficina.marca)}</small>` : ''}</h2>
        <button type="button" class="btn ghost small" data-hoy-day="1" ${h.hoy ? 'disabled' : ''} data-hover="txt:${t('ui.hoy.nextDay')}">▶</button></div>
      <div class="hoy-meta"><span data-hover="txt:${t('ui.hoy.frontierTip')}">${t('ui.hoy.frontier', { text: esc(h.frontera.texto) })}</span>
        <span data-hover="txt:${t('ui.hoy.costTip')}">${t('ui.hoy.cost', { cost: gasto })}</span>
        <span class="muted">${t('ui.hoy.zone', { zone: esc(h.zona) })}</span></div>
    </header>
    ${blk('wait', t('ui.hoy.waitDecision'), esperan || none(t('ui.hoy.noPending')), h.esperan.length)}
    ${blk('done', t('ui.hoy.doneTitle'), hecho || none(h.hoy ? t('ui.hoy.nothingDoneToday') : t('ui.hoy.nothingDoneDay')))}
    ${blk('team', t('ui.hoy.teamTitle'), equipo || none(t('ui.hoy.noEmployeesTeam')))}
    ${blk('learn', t('ui.hoy.learnedTitle'), aprendido || none(t('ui.hoy.nothingLearned')))}
    ${blk('warn', t('ui.hoy.attentionTitle'), (atencion || none(t('ui.hoy.noIssues'))) + `<div class="hoy-item next">${t('ui.hoy.nextTitle')} <span class="muted">${esc(h.proximo.texto)}</span></div>`)}
  </div>`;
}

$('tab-reports').addEventListener('click', e => {
  const el = e.target.closest('[data-open-chat],[data-hoy-inbound],[data-hoy-mem],[data-hoy-day],[data-emp]');
  if (!el || current) return;
  e.preventDefault();
  if (el.dataset.openChat) return openChat(el.dataset.openChat).catch(err => toast(err.message, true));
  if (el.dataset.hoyMem) return openEditor(el.dataset.hoyMem).catch(err => toast(err.message, true));
  if (el.dataset.emp) return openEmployee(el.dataset.emp).catch(err => toast(err.message, true));
  if ('hoyInbound' in el.dataset) { document.querySelector('#sideTabs [data-side="brain"]')?.click(); $('inbound').scrollIntoView({ block: 'nearest' }); return; }
  if (el.dataset.hoyDay && hoyData) {
    const next = shiftDay(hoyData.dia, Number(el.dataset.hoyDay));
    hoyDia = next;
    loadHoy();
  }
});

// ---------- Telemetría ----------

function renderProgress(p) {
  $('telemetry').hidden = !p || !current?.running;
  if (!p || !current?.running) return;
  const wfm = wfOf(p.workflow);
  $('tmMode').textContent = p.workflow && p.workflow !== 'relevo' ? `${wfm?.icon || ''} ${(wfm?.name || p.workflow).toUpperCase()}` : p.mode === 'auto' ? t('ui.telemetry.relayAuto') : t('ui.telemetry.relay');
  $('tmPhaseCell').hidden = !p.phaseLabel;
  $('tmPhase').textContent = p.phaseLabel ? `${p.phaseLabel}${p.working?.length > 1 ? t('ui.telemetry.atOnce', { n: p.working.length }) : ''}` : '–';
  $('tmStart').textContent = p.cycleStarted ? hhmmss(p.cycleStarted).slice(0, 5) : '–';
  $('tmRound').textContent = p.round ? `${p.round}/${p.maxRounds}` : `–/${p.maxRounds}`;
  $('tmTurn').textContent = `${p.turn}/${p.totalTurns}`;
  $('tmStreak').textContent = `${p.approvalsInRow}/${p.needed}`;
  $('tmStreak').className = 'v' + (p.approvalsInRow ? ' good' : '');
  $('tmDoneCell').hidden = p.mode !== 'auto';
  $('tmDone').textContent = `${p.doneInRow}/${p.needed}`;
  $('tmObj').textContent = p.openObjections;
  $('tmObj').className = 'v' + (p.openObjections ? ' warn' : '');
  $('tmFill').style.width = `${Math.min(100, (p.turn / p.totalTurns) * 100)}%`;
  renderSituation();
}

// ---------- Reportes ----------

let cierreScrollFor = null;

function renderReports() {
  const box = $('tab-reports');
  if (!current && oficina !== 'edificio') { box.innerHTML = hoyHtml(); return; }
  if (!current) {
    box.innerHTML = `<div class="empty"><h2>${t('ui.reports.noActiveMissionTitle')}</h2>${t('ui.reports.noActiveMissionDesc').split(/\n\n/).map(p => `<p>${p}</p>`).join('')}</div>`;
    return;
  }
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const banner = current.outcome === 'interrupted'
    ? `<div class="interrupted-banner"><span>${t('ui.hoy.interruptedBanner')}</span><button type="button" class="btn small primary" data-resume>${t('ui.hoy.resumeCycleBtn')}</button></div>`
    : '';
  // El informe va el primero: el dueño no tiene que leer los turnos para saber en qué terminó.
  // El vistazo técnico (Charts.summary) solo sale si aún no hay informe, para no contar el final dos veces.
  const done = !current.running && current.messages.some(m => m.kind === 'agent');
  const cierre = cierreHtml();
  const tieneInforme = Boolean(cierre) && !cierreView?.data?.missing;
  const stickToReport = tieneInforme && cierreScrollFor !== currentId;
  const summaryCard = done && !tieneInforme ? `<div class="report-summary">${Charts.summary(current, Charts.distinct(agents))}</div>` : '';
  box.innerHTML = banner + cierre + summaryCard + deliveryCard() + (current.messages.map(m => {
    if (m.kind === 'user') return `<div class="msg user"><div class="msg-head">${m.intervention ? t('ui.reports.liveDirective') : t('ui.reports.request')} · ${hhmmss(m.ts)}${m.config ? t('ui.reports.requestMeta', { mode: m.config.mode === 'auto' ? t('ui.reports.modeAuto') : t('ui.reports.modeRounds'), rounds: m.config.maxRounds, score: m.config.minScore }) : ''}</div><div class="msg-body">${esc(m.text)}</div></div>`;
    if (m.kind === 'system') return `<div class="msg system">${esc(m.text)}</div>`;
    const a = agentOf(m.agentId);
    const long = (m.text || '').length > 1200;
    const tools = Object.entries(m.toolCounts || {}).map(([k, n]) => `${k} ${n}`).join(' · ');
    const u = m.usage;
    const cacheTxt = u?.cachedTokens ? t('ui.feed.cacheTag', { cache: u.cachedTokens }) : '';
    const usageTag = u?.totalTokens ? `<span class="tag" title="${t('ui.feed.usageTag', { input: u.inputTokens, output: u.outputTokens, cache: cacheTxt })}">⚡ ${fmtTokens(u.totalTokens)} tok${u.costUsd ? ` · ${u.costUsd.toFixed(3)}` : ''}</span>` : '';
    return `<div class="msg agent" style="--c:${esc(a.color)}">
      <div class="msg-head"><strong>${esc(m.agentName.toUpperCase())}</strong><span>${esc(m.role || '')}</span>
        <span>${m.phase ? `${PHASE_LABEL[m.phase] || m.phase}${m.round ? ` R${m.round}` : ''}` : `R${m.round}`} · ${dur(m.seconds || 0)} · ${hhmmss(m.ts)}</span>
        ${m.target ? `<span class="tag" title="${t('ui.feed.draftTargetTip')}">${t('ui.feed.draftTarget', { letter: esc(m.target), owner: esc(agentOf(m.targetOwner).name) })}</span>` : ''}
        ${m.score != null ? `<span class="score">${m.score}/10</span>` : ''}
        <span class="badge ${m.verdict}">${esc(verdictLabel(m.verdict))}</span>
        ${m.done === true ? `<span class="tag good">${t('ui.feed.doneYes')}</span>` : m.done === false ? `<span class="tag">${t('ui.feed.doneNo')}</span>` : ''}</div>
      ${m.ratingOwners ? `<div class="ratings">${Object.entries(m.ratingOwners).map(([id, s]) => `<span style="--c:${esc(agentOf(id).color)}"><i></i>${esc(agentOf(id).name)} <b>${s}</b></span>`).join('')}</div>` : ''}
      ${m.failure ? `<div class="fail-box"><b>⛔ ${esc(m.failure.label)}</b><span>${esc(m.failure.detail)}</span><span class="hint">→ ${esc(m.failure.hint)}</span></div>` : ''}
      <div class="msg-body ${long ? 'collapsed' : ''}">${esc((m.failure ? m.text.split('\n\n').slice(1).join('\n\n') : m.text) || t('ui.reports.noOutput'))}</div>
      ${long ? `<button class="more">${t('ui.viewAll')}</button>` : ''}
      <div class="msg-foot">
        ${m.downgraded ? `<span class="tag warn" title="${t('ui.feed.downgradedTip')}">${t('ui.feed.downgraded', { why: esc(m.downgraded) })}</span>` : ''}
        ${!['ERROR', 'PARCIAL'].includes(m.verdict) && (!m.phase || m.phase === 'sintesis') ? (m.handoffComplete ? '<span class="tag good">HANDOFF ✓</span>' : `<span class="tag bad" title="${t('ui.reports.handoffMissing', { fields: esc((m.handoffMissing || []).join(', ')) })}">HANDOFF ${m.handoff ? t('ui.reports.handoffIncomplete') : t('ui.handoff.notUpdated')}</span>`) : ''}
        ${m.objections?.length ? `<span class="tag warn">${t('ui.feed.objTag', { ids: m.objections.join(', #') })}</span>` : ''}
        ${m.replies?.length ? `<span class="tag">${t('ui.feed.repTag', { ids: m.replies.map(r => r.id).join(', #') })}</span>` : ''}
        ${m.streaming === false ? `<span class="tag" title="${t('ui.feed.noStreamingTip')}">${t('ui.feed.noStreaming')}</span>` : ''}
        ${usageTag}
        ${tools ? `<span class="tag">${esc(tools)}</span>` : ''}
      </div>
      ${m.files?.length ? `<details class="files-touched"><summary>${t('ui.feed.filesTouched', { count: m.files.length, work: m.workFiles ? t('ui.feed.workFiles', { count: m.workFiles.length }) : '' })}</summary><div>${m.files.map(esc).join('<br>')}</div></details>` : ''}
      ${m.diffs?.length ? `<details class="files-touched"><summary>${t('ui.feed.diffSummary', { count: m.diffs.length })}</summary>${m.diffs.map(d => `<div class="diff-file">${esc(d.file)} · ${esc(d.status)}</div><pre class="diff">${diffHtml(d.patch)}</pre>`).join('')}</details>` : ''}
    </div>`;
  }).join('') || `<div class="empty">${t('ui.reports.waitingFirst')}</div>`);
  // Con informe, la primera pintura de esa misión enseña el veredicto. Si no, el hilo en vivo sigue al final.
  if (stickToReport) { box.scrollTop = 0; cierreScrollFor = currentId; }
  else if (atBottom && !tieneInforme) box.scrollTop = box.scrollHeight;
}

// Al terminar: qué se entregó y dónde, con el principal destacado y su vista previa a un clic.
function deliveryCard() {
  const d = current?.deliverables;
  if (!current || current.running || !d?.main || !current.messages.some(m => m.kind === 'agent')) return '';
  const main = d.items.find(i => i.path === d.main) || { path: d.main, kind: kindOfPath(d.main) };
  const sep = current.path.includes('\\') ? '\\' : '/';
  const disk = I18N.shortHome(`${current.path}${sep}${main.path.split('/').join(sep)}`);
  const thumb = main.kind === 'image' ? `<img src="${esc(rawUrl(current.id, main.path))}" alt="" loading="lazy">`
    : main.kind === 'html' ? `<iframe sandbox="allow-scripts" tabindex="-1" loading="lazy" src="${esc(rawUrl(current.id, main.path))}" title="${t('ui.delivery.previewTitle')}"></iframe>` : `<span class="dl-ic">${KIND_ICON[main.kind] || '📄'}</span>`;
  const others = d.items.filter(i => i.path !== main.path && i.kind !== 'binary');
  const images = others.filter(i => i.kind === 'image').slice(0, 8);
  const rest = others.filter(i => i.kind !== 'image').slice(0, 10);
  return `<div class="delivery">
    <div class="dl-head">${t('ui.delivery.title')} <span class="muted">${t('ui.delivery.subtitle')}</span></div>
    <div class="dl-main">
      <button type="button" class="dl-thumb" data-preview="${esc(main.path)}" data-hover="txt:${t('ui.delivery.viewHover')}">${thumb}<span class="dl-open">${t('ui.delivery.view')}</span></button>
      <div class="dl-info">
        <div class="dl-name">${KIND_ICON[main.kind] || ''} <b>${esc(main.path)}</b> <span class="tag good">${t('ui.delivery.mainTag')}</span> <span class="tag">${esc(KIND_LABEL[main.kind] || '')}</span></div>
        <code class="dl-path">${esc(disk)}</code>
        <div class="dl-actions">
          <button type="button" class="btn small primary" data-preview="${esc(main.path)}">${t('ui.delivery.view')}</button>
          <a class="btn small" href="${esc(rawUrl(current.id, main.path))}" target="_blank" rel="noopener noreferrer">${t('ui.delivery.newTab')}</a>
          <button type="button" class="btn small ghost" data-reveal="${esc(main.path)}">${t('ui.delivery.reveal')}</button>
        </div>
      </div>
    </div>
    ${images.length ? `<div class="dl-gallery">${images.map(i => `<button type="button" data-preview="${esc(i.path)}" data-hover="file:${esc(i.path)}"><img src="${esc(rawUrl(current.id, i.path))}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
    ${rest.length ? `<div class="dl-others">${rest.map(i => `<a href="#" data-preview="${esc(i.path)}" data-hover="file:${esc(i.path)}" class="${i.touched ? 'fresh' : ''}">${KIND_ICON[i.kind] || ''} ${esc(i.path)}</a>`).join('')}${others.length > rest.length + images.length ? `<span class="muted">${t('ui.feed.moreInFiles', { count: others.length - rest.length - images.length })}</span>` : ''}</div>` : ''}
  </div>`;
}

// ---------- Discusión ----------

function diffHtml(patch) {
  return String(patch || '').split('\n').map(line => {
    const cls = line.startsWith('@@') ? 'hunk' : line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : '';
    return `<span class="${cls}">${esc(line)}</span>`;
  }).join('\n');
}

// Postura de una respuesta y estado de una objeción: el dato se guarda en español; la etiqueta, en el idioma elegido.
const STANCE = new Proxy({}, { get: (_, k) => (['resuelta', 'rechazada', 'apoyo', 'retirada', 'mantenida'].includes(k) ? t(`ui.stance.${k}`) : undefined) });
const STATUS_KEY = { abierta: 'ui.debate.open', disputada: 'ui.debate.disputed', resuelta: 'ui.debate.resolved', retirada: 'ui.debate.withdrawn' };
const statusLabel = st => (STATUS_KEY[st] ? t(STATUS_KEY[st]) : String(st).toUpperCase());

function renderDebate() {
  const box = $('tab-debate');
  const debate = current?.debate || [];
  const open = debate.filter(o => o.status === 'abierta' || o.status === 'disputada').length;
  $('debateCount').textContent = open ? `⚑${open}` : debate.length ? `${debate.length}` : '';
  const form = current
    ? `<form class="debate-add" id="debateForm"><input class="field" id="debateInput" placeholder="${t('ui.debate.placeholder')}" autocomplete="off"><button class="btn small primary" type="submit">${t('ui.debate.submit')}</button></form>`
    : '';
  if (!debate.length) {
    box.innerHTML = form + `<div class="empty"><h2>${t('ui.debate.emptyTitle')}</h2><p>${t('ui.debate.emptyDesc')}</p></div>`;
    return;
  }
  const count = st => debate.filter(o => o.status === st).length;
  box.innerHTML = form + `<div class="debate-summary">
      <span class="badge abierta">${statusLabel('abierta')} ${count('abierta')}</span><span class="badge disputada">${statusLabel('disputada')} ${count('disputada')}</span>
      <span class="badge resuelta">${statusLabel('resuelta')} ${count('resuelta')}</span><span class="badge retirada">${statusLabel('retirada')} ${count('retirada')}</span></div>` +
    [...debate].sort((a, b) => (isOpen(b) - isOpen(a)) || b.id - a.id).map(o => {
      const a = agentOf(o.by);
      const actions = isOpen(o)
        ? `<button type="button" class="btn ghost small" data-obj-id="${o.id}" data-obj-status="resuelta" title="${t('ui.debate.resolveTip')}">${t('ui.debate.resolve')}</button><button type="button" class="btn ghost small" data-obj-id="${o.id}" data-obj-status="retirada" title="${t('ui.debate.withdrawTip')}">${t('ui.debate.withdraw')}</button>`
        : `<button type="button" class="btn ghost small" data-obj-id="${o.id}" data-obj-status="abierta" title="${t('ui.debate.reopenTip')}">${t('ui.debate.reopen')}</button>`;
      return `<div class="objection ${o.status}" style="--c:${esc(a.color)}">
        <div class="o-head"><b>#${o.id}</b><span style="color:${esc(a.color)}">${esc(o.byName.toUpperCase())}</span><span>${t('ui.tip.round', { n: o.round })}</span>
          <span>${hhmmss(o.ts)}</span><span class="o-actions">${actions}<span class="badge ${o.status}">${statusLabel(o.status)}</span></span></div>
        <div class="o-text">${esc(o.text)}</div>
        ${o.replies.length ? `<div class="replies">${o.replies.map(r => `<div class="reply">
          <span class="who" style="color:${esc(agentOf(r.by).color)}">${esc(r.byName)}</span>
          <span class="tag">${STANCE[r.stance] || r.stance}</span> <span class="txt">${esc(r.text)}</span></div>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
}
const isOpen = o => o.status === 'abierta' || o.status === 'disputada';

// ---------- Handoff ----------

function renderHandoff() {
  const box = $('tab-handoff');
  if (!current) { box.innerHTML = `<div class="empty"><h2>HANDOFF</h2><p>${t('ui.handoff.emptyDesc')}</p></div>`; return; }
  const turns = current.messages.filter(m => m.kind === 'agent' && m.verdict !== 'ERROR').reverse();
  box.innerHTML = `<div class="label">${t('ui.handoff.currentTitle')}</div>
    <div class="handoff-current md">${current.handoff ? md(current.handoff) : `<p class="muted">${t('ui.handoff.noFile')}</p>`}</div>
    <div class="label">${t('ui.handoff.turnsTitle', { count: turns.length })}</div>` +
    turns.map((m, i) => {
      const a = agentOf(m.agentId);
      const state = m.handoffComplete ? `<span class="tag good">${t('ui.handoff.complete')}</span>` : m.handoff ? `<span class="tag warn">${t('ui.handoff.missing', { fields: esc((m.handoffMissing || []).join(', ')) })}</span>` : `<span class="tag bad">${t('ui.handoff.notUpdated')}</span>`;
      return `<details class="handoff-turn" style="--c:${esc(a.color)}" ${i === 0 ? 'open' : ''}>
        <summary><strong>${esc(m.agentName.toUpperCase())}</strong> ${t('ui.tip.round', { n: m.round })} · ${hhmmss(m.ts)} ${state}</summary>
        <div class="md">${m.handoffText ? md(m.handoffText) : `<p class="muted">${t('ui.handoff.noHandoffTurn')}</p>`}</div></details>`;
    }).join('');
}

// ---------- Expedientes: cómo actúa cada uno ----------

function spark(scores, color) {
  if (!scores?.length) return '';
  const w = 140, h = 26, n = scores.length;
  const pts = scores.map((s, i) => `${n === 1 ? w / 2 : (i / (n - 1)) * (w - 4) + 2},${h - 2 - (s / 10) * (h - 4)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><line x1="0" x2="${w}" y1="${h - 2 - 0.9 * (h - 4)}" y2="${h - 2 - 0.9 * (h - 4)}" stroke="#263244" stroke-dasharray="2 3"/>
    <polyline points="${pts}" fill="none" stroke="${esc(color)}" stroke-width="1.5"/></svg>`;
}

async function renderAgents() {
  const box = $('tab-agents');
  if (statsScope === 'global' && !globalStats) {
    box.innerHTML = `<div class="muted pad">${t('ui.stats.loading')}</div>`;
    try { globalStats = await api('/api/stats'); } catch (err) { box.innerHTML = `<div class="pad">${esc(err.message)}</div>`; return; }
  }
  const stats = (statsScope === 'global' ? globalStats : current?.stats) || [];
  const head = `<div class="agents-head"><span class="label" style="margin:0">${t('ui.stats.howEachActs')}</span>
    <span class="chips"><button class="chip ${statsScope === 'chat' ? 'on' : ''}" data-scope="chat">${t('ui.stats.thisMission')}</button>
    <button class="chip ${statsScope === 'global' ? 'on' : ''}" data-scope="global">${t('ui.stats.global')}</button></span></div>`;
  const kinds = ['read', 'write', 'cmd', 'search', 'web', 'plan', 'agent', 'tool'];
  const names = new Proxy({}, {
    get(_, k) {
      switch (k) {
        case 'read': return t('ui.stats.read');
        case 'write': return t('ui.stats.write');
        case 'cmd': return t('ui.stats.cmd');
        case 'search': return t('ui.stats.search');
        case 'web': return t('ui.stats.web');
        case 'plan': return t('ui.stats.plan');
        case 'agent': return t('ui.stats.agent');
        case 'tool': return t('ui.stats.tool');
        default: return k;
      }
    }
  });
  const cards = stats.filter(s => s.turns || agents.some(a => a.id === s.id)).map(s => {
    const a = agentOf(s.id);
    const max = Math.max(1, ...kinds.map(k => s.tools[k] || 0));
    const bars = kinds.filter(k => s.tools[k]).map(k => `<span>${names[k]}</span><span class="bar"><i style="width:${(s.tools[k] / max) * 100}%"></i></span><span>${s.tools[k]}</span>`).join('');
    return `<div class="dossier" style="--c:${esc(a.color || s.color)}">
      <h3>${esc((s.name || s.id).toUpperCase())} <small>${esc(s.role || a.role || '')}</small></h3>
      <div class="traits">${s.traits.map(trait => `<span class="trait">${esc(trait)}</span>`).join('')}</div>
      <div class="kpis">
        <div class="kpi"><span class="k">${t('ui.stats.kpiTurns')}</span><span class="v">${s.turns}</span></div>
        <div class="kpi"><span class="k">${t('ui.stats.kpiAvgScore')}</span><span class="v">${s.avgScore ?? '–'}</span></div>
        <div class="kpi"><span class="k">${t('ui.stats.kpiApproves')}</span><span class="v">${s.turns ? Math.round((s.approvals / s.turns) * 100) + '%' : '–'}</span></div>
        <div class="kpi"><span class="k">${t('ui.stats.kpiAvgTime')}</span><span class="v">${s.turns ? dur(s.avgSeconds) : '–'}</span></div>
      </div>
      ${spark(s.scores, a.color || s.color)}
      <div class="rows">
        <div><span>${t('ui.stats.appChgErr')}</span><b>${s.approvals} / ${s.changes} / ${s.errors}${s.noVerdict ? t('ui.stats.noVerdict', { n: s.noVerdict }) : ''}</b></div>
        <div><span>${t('ui.stats.downgradedByServer')}</span><b>${s.downgraded}</b></div>
        <div><span title="${t('ui.stats.workFilesTip')}">${t('ui.stats.workFiles')}</span><b>${s.filesTouched}</b></div>
        <div><span>${t('ui.stats.objRaisedResolved')}</span><b>${s.objectionsRaised} / ${s.objectionsResolvedByOthers}</b></div>
        <div><span>${t('ui.stats.repliesRejections')}</span><b>${s.repliesGiven} / ${s.rejections}</b></div>
        <div><span>${t('ui.stats.handoffsStats')}</span><b>${s.handoffs} / ${s.handoffMissing}</b></div>
        <div><span>${t('ui.stats.toolErrors')}</span><b>${s.toolErrors}</b></div>
        <div><span>${t('ui.stats.totalTokensAvg')}</span><b>${s.tokens ? `${fmtTokens(s.tokens)} (${fmtTokens(s.avgTokens)})` : '–'}${s.costUsd ? ` · $${s.costUsd.toFixed(3)}` : ''}</b></div>
        <div><span>${t('ui.stats.totalTime')}</span><b>${dur(s.seconds)}</b></div>
      </div>
      ${bars ? `<div class="bars">${bars}</div>` : ''}
      ${s.topFiles.length ? `<div class="topfiles">${t('ui.stats.topFiles', { files: s.topFiles.slice(0, 5).map(f => `${esc(f.file)} (${f.n})`).join(' · ') })}</div>` : ''}
    </div>`;
  }).join('');
  box.innerHTML = head + (cards ? `<div class="dossiers">${cards}</div>` : `<div class="empty">${t('ui.stats.noTurns')}</div>`);
}

// ---------- Gráficas (public/charts.js) ----------

function renderCharts() {
  const box = $('tab-charts');
  if (box.hidden) return;
  if (!current) { box.innerHTML = `<div class="empty"><h2>${t('ui.charts.emptyTitle')}</h2><p>${t('ui.charts.emptyDesc')}</p></div>`; return; }
  const turns = current.messages.filter(m => m.kind === 'agent');
  const lastCycle = [...current.messages].reverse().find(m => m.cycle)?.cycle;
  const cycleTurns = turns.filter(m => m.cycle === lastCycle);
  const liveList = Object.entries(live).filter(([, l]) => l.started).map(([agentId, l]) => ({ agentId, ...l }));
  const view = document.documentElement.clientWidth || box.clientWidth || 320;
  const w = Math.max(240, Math.min(box.clientWidth || view, view) - 30);
  const half = w > 900 ? Math.floor((w - 12) / 2) : w;
  const anon = current.anon?.[lastCycle] || null;
  const chartTurns = lastCycle == null ? turns : cycleTurns;
  const wf = current.config?.workflow || 'relevo';
  const teamN = (current.config?.team || []).length;
  const expected = teamN ? (wf === 'consejo' ? Math.max(1, teamN - 1) : teamN) : 0;
  // El color sigue al agente y no se recicla: si dos traen el mismo, el segundo se distingue (Charts.distinct).
  const team = Charts.distinct(agents);
  const col = half < w ? '' : 'ch-wide';
  box.innerHTML = `<div class="charts">
    <div class="ch-wide">${Charts.summary({ ...current, running: !!current.running }, team)}</div>
    <div class="ch-wide">${Charts.scoreLine(turns, team, current.config?.minScore || 9, w - 28)}</div>
    <div class="${col}">${Charts.convergence(chartTurns, current.config?.minScore || 9, half - 28, { workflow: wf, expected })}</div>
    <div class="${col}">${Charts.objections(current.debate || [], half - 28)}</div>
    <div class="${col}">${Charts.timeBars(current.stats || [], team, half - 28)}</div>
    <div class="${col}">${Charts.tokenBars(turns, team, half - 28)}</div>
    ${(() => { const m = Charts.reviewMatrix(cycleTurns, team, anon, half < w ? half - 28 : w - 28); return m ? `<div class="ch-wide">${m}</div>` : ''; })()}
    <div class="ch-wide">${Charts.timeline(cycleTurns, liveList, team, w - 28, Date.now())}</div>
    <div class="ch-wide">${Charts.dataTable(turns, team)}</div>
  </div>`;
}

// Tooltip compartido por todas las marcas con data-tip: al pasar el ratón y, en el teléfono, al tocar (otro toque
// fuera de una marca lo cierra).
function chartTip(e, touch) {
  const tip = $('chartTip');
  const mark = e.target.closest('[data-tip]');
  if (!mark) { tip.hidden = true; return; }
  tip.textContent = mark.dataset.tip;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  const at = touch ? mark.getBoundingClientRect() : null;
  const cx = at ? at.left + at.width / 2 : e.clientX, cy = at ? at.top : e.clientY;
  tip.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, cx + (touch ? -r.width / 2 : 14)))}px`;
  tip.style.top = `${Math.max(8, cy - r.height - 10)}px`;
}
$('tab-charts').addEventListener('mousemove', e => chartTip(e, false));
$('tab-charts').addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') chartTip(e, true); });
$('tab-charts').addEventListener('mouseleave', () => { $('chartTip').hidden = true; });
$('tab-charts').addEventListener('scroll', () => { $('chartTip').hidden = true; }, { passive: true });
window.addEventListener('resize', debounce(renderCharts, 200));
// En vivo se redibuja cada 5 s (no mientras el ratón está sobre una marca, para no quitarle el tooltip).
setInterval(() => { if (current?.running && !$('tab-charts').hidden && $('chartTip').hidden) renderCharts(); }, 5000);

// ---------- Log en vivo ----------

const ICON = { read: '◇', write: '✎', cmd: '›', search: '⌕', web: '◎', plan: '☰', agent: '⇄', tool: '⚙', think: '…', text: '¶', error: '✖', info: '·', raw: '░', stderr: '!' };
const ACTIONS = new Set(['read', 'write', 'cmd', 'search', 'web', 'plan', 'agent', 'tool', 'error']);

async function loadActivity() {
  const id = currentId, epoch = officeEpoch;
  const entries = id ? await api(`/api/chats/${encodeURIComponent(id)}/activity?limit=${LOG_MAX}`).catch(() => []) : [];
  if (id !== currentId || epoch !== officeEpoch) return;
  logEntries = entries;
  renderLogChips();
  renderLog();
}

function passes(e) {
  if (logFilter.agents.size && !logFilter.agents.has(e.agentId)) return false;
  const k = logFilter.kind;
  if (k === 'actions' && !ACTIONS.has(e.kind)) return false;
  if (k === 'error' && e.kind !== 'error' && e.kind !== 'stderr') return false;
  if (!['all', 'actions', 'error'].includes(k) && e.kind !== k) return false;
  if (logFilter.q) {
    const q = logFilter.q.toLowerCase();
    if (!`${e.label} ${e.detail || ''} ${e.file || ''}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

let lastLogKey = null;
function evHtml(e) {
  const a = agentOf(e.agentId);
  const key = `${e.agentId}:${e.round || ''}`;
  let sep = '';
  if (key !== lastLogKey) {
    sep = `<div class="ev-sep">── ${esc(a.name.toUpperCase())}${e.round ? t('ui.log.roundSep', { n: e.round }) : ''} ──</div>`;
    lastLogKey = key;
  }
  const detail = e.detail && e.detail !== e.label ? e.detail : '';
  const f = e.kind === 'write' && e.file ? projectRel(e.file) : '';
  const peek = f && previewable(f) ? `<a href="#" class="lf" data-preview="${esc(f)}" data-hover="file:${esc(f)}">👁</a>` : '';
  return sep + `<div class="ev ${esc(e.kind)}${detail ? ' has-dt' : ''}" style="--c:${esc(a.color)}">
    <span class="ts">${hhmmss(e.ts)}</span><span class="ag" data-hover="agent:${esc(e.agentId)}">${esc(a.name)}</span><span class="ic" data-hover="log:${esc(e.kind)}">${ICON[e.kind] || '·'}</span>
    <span class="lb">${esc(e.label)}${peek}</span>${detail ? `<span class="dt">${esc(detail)}</span>` : ''}</div>`;
}

function renderLog() {
  lastLogKey = null;
  const list = logEntries.filter(passes).slice(-1500);
  $('log').innerHTML = list.map(evHtml).join('') || `<div class="muted pad">${logEntries.length ? t('ui.log.noMatch') : t('ui.log.noActivity')}</div>`;
  if ($('logFollow').checked) $('log').scrollTop = $('log').scrollHeight;
}

function pushLog(entry) {
  logEntries.push(entry);
  if (logEntries.length > LOG_MAX) logEntries.splice(0, logEntries.length - LOG_MAX);
  if (!passes(entry)) return;
  const box = $('log');
  if (box.querySelector('.pad')) box.innerHTML = '';
  box.insertAdjacentHTML('beforeend', evHtml(entry));
  while (box.children.length > 1800) box.firstElementChild.remove();
  if ($('logFollow').checked) box.scrollTop = box.scrollHeight;
}

function renderLogChips() {
  $('logAgents').innerHTML = `<button class="chip ${logFilter.agents.size ? '' : 'on'}" data-agent="">${esc(t('ui.log.allAgents'))}</button>` +
    agents.map(a => `<button class="chip ${logFilter.agents.has(a.id) ? 'on' : ''}" data-agent="${esc(a.id)}" style="--c:${esc(a.color)}">${esc(a.name.toUpperCase())}</button>`).join('');
}

// ---------- Archivos ----------

function renderFiles() {
  const files = current?.files || [];
  const lastTurn = [...(current?.messages || [])].reverse().find(m => m.kind === 'agent');
  const fresh = new Set(lastTurn?.files || []);
  const main = current?.deliverables?.main;
  const head = main ? `<li class="files-main" data-path="${esc(main)}" data-hover="file:${esc(main)}">★ <span class="nm">${esc(t('ui.files.mainLabel'))} <b>${esc(main)}</b></span><span class="sz">👁 ${esc(t('ui.files.view'))}</span></li>` : '';
  $('files').innerHTML = head + files.map(f => {
    const depth = f.path.split('/').length - 1;
    const name = f.path.split('/').pop();
    const size = f.dir ? '' : f.size > 1024 * 1024 ? `${(f.size / 1048576).toFixed(1)}M` : f.size > 1024 ? `${(f.size / 1024).toFixed(1)}k` : `${f.size}b`;
    const icon = f.dir ? '▸' : f.path === main ? '★' : KIND_ICON[f.kind] || '·';
    return `<li class="${f.dir ? 'dir' : ''} ${fresh.has(f.path) ? 'fresh' : ''}" data-path="${esc(f.path)}" style="padding-left:${6 + depth * 14}px"
      ${f.dir ? '' : `data-hover="${fresh.has(f.path) ? `txt:${esc(f.path)} · ${t('ui.files.touchedLast')}` : `file:${esc(f.path)}`}"`}><span class="fi">${icon}</span> <span class="nm">${esc(name)}</span><span class="sz">${size}</span></li>`;
  }).join('') || `<li class="muted">${current ? t('ui.files.emptyFolder') : t('ui.files.noProject')}</li>`;
}

// ---------- Cerebro (memoria compartida) ----------

async function loadMemory() {
  const epoch = officeEpoch;
  const files = await api('/api/memory').catch(() => []);
  if (epoch !== officeEpoch) return;
  $('memory').innerHTML = files.map(f =>
    `<li data-memory="${esc(f.name)}" title="${t('ui.mem.versionsTip', { n: f.versions })}"><span class="nm">◆ ${esc(f.name.replace(/\.md$/, ''))}</span>
      <span class="meta">${t('ui.mem.entries', { n: f.entries })} · ${(f.size / 1024).toFixed(1)}k${f.versions ? ` · v${f.versions}` : ''}</span></li>`
  ).join('') || `<li class="muted">${t('ui.mem.empty')}</li>`;
  loadInbound();
}

// Entrantes: traspasos de otras oficinas que esperan tu decisión. No están en el cerebro (ni en el brief) hasta aceptarlos.
async function loadInbound() {
  const epoch = officeEpoch;
  const list = await api('/api/memory/entrantes').catch(() => []);
  if (epoch !== officeEpoch) return;
  const box = $('inbound');
  box.hidden = !list.length;
  box.innerHTML = list.length ? `<div class="label">${t('ui.inbox.incomingTitle', { count: list.length })}</div>` + list.map(x => `
    <div class="inb" data-file="${esc(x.archivo)}"><div class="f">${t('ui.inbox.from', { name: esc(x.desde) })}</div><pre>${esc(x.content.split('\n').slice(3).join('\n').slice(0, 400))}</pre>
      <div class="inb-row"><input class="field" value="lecciones.md" aria-label="${t('ui.inbox.acceptTopicAria')}"><button type="button" class="btn small" data-accept>${t('ui.inbox.acceptBtn')}</button><button type="button" class="btn ghost small" data-drop>${t('ui.inbox.discardBtn')}</button></div></div>`).join('') : '';
}

$('inbound').addEventListener('click', async e => {
  const box = e.target.closest('.inb');
  if (!box) return;
  try {
    const epoch = officeEpoch, nombre = officeNow().nombre;
    if (e.target.matches('[data-accept]')) {
      let tema = box.querySelector('input').value.trim();
      if (tema && !tema.endsWith('.md')) tema += '.md';
      await api('/api/memory/entrantes/aceptar', { method: 'POST', body: JSON.stringify({ archivo: box.dataset.file, tema }) });
      toast(t('ui.inbox.acceptedIn', { topic: tema, office: nombre }));
    } else if (e.target.matches('[data-drop]')) {
      await api(`/api/memory/entrantes?archivo=${encodeURIComponent(box.dataset.file)}`, { method: 'DELETE' });
      toast(t('ui.inbox.discarded'));
    } else return;
    if (epoch === officeEpoch) loadMemory();
  } catch (err) { toast(err.message, true); }
});

let xferEpoch = 0;
async function openXfer() {
  const name = editing?.name;
  const epoch = officeEpoch, officeId = oficina;
  if (!name || editing.epoch !== epoch) return;
  const others = oficinas.filter(o => o.id !== officeId);
  if (!others.length) return toast(t('ui.inbox.noOtherOffice'), true);
  $('xferTitle').textContent = t('ui.inbox.xferTitle', { office: officeNow().nombre.toUpperCase(), name });
  const entries = await api(`/api/memory/entradas?name=${encodeURIComponent(name)}`);
  // Si la oficina cambió mientras llegaban las entradas, no abras el diálogo: el índice sería de otro cerebro.
  if (epoch !== officeEpoch || oficina !== officeId || editing?.name !== name || editing?.epoch !== epoch) return;
  xferEpoch = epoch;
  $('xferDest').innerHTML = others.map(o => `<option value="${esc(o.id)}">${o.id === 'edificio' ? '🛸' : '🏢'} ${esc(o.nombre)}</option>`).join('');
  $('xferList').innerHTML = entries.map(x => `<li><pre>${esc(x.text.slice(0, 300))}</pre><button type="button" class="btn small" data-index="${x.index}">${t('ui.inbox.xferBtn')}</button></li>`).join('') || `<li class="muted">${t('ui.inbox.noEntriesInTopic')}</li>`;
  $('xferDialog').showModal();
}
$('editorXfer').addEventListener('click', () => openXfer().catch(err => toast(err.message, true)));
$('xferList').addEventListener('click', async e => {
  const b = e.target.closest('[data-index]');
  if (!b) return;
  if (xferEpoch !== officeEpoch || editing?.epoch !== officeEpoch) {
    $('xferDialog').close();
    toast(t('ui.inbox.officeChanged'), true);
    return;
  }
  const body = { name: editing.name, index: Number(b.dataset.index), destino: $('xferDest').value };
  try {
    const r = await api('/api/memory/traspaso', { method: 'POST', body: JSON.stringify(body) });
    b.disabled = true; b.textContent = t('ui.sent');
    toast(t('ui.inbox.waitingIn', { title: r.titulo, dest: oficinas.find(o => o.id === r.destino)?.nombre }));
  } catch (err) { toast(err.message, true); }
});

const highlight = (text, q) => {
  let html = esc(text);
  for (const word of q.split(/\s+/).filter(x => x.length > 1)) html = html.replace(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), m => `<mark>${m}</mark>`);
  return html;
};

const searchBrain = debounce(async () => {
  const epoch = officeEpoch;
  const q = $('brainQuery').value.trim();
  const box = $('brainResults');
  if (!q) { box.hidden = true; return; }
  const { hits, relevant } = await api(`/api/memory/search?q=${encodeURIComponent(q)}`).catch(() => ({ hits: [], relevant: [] }));
  if (epoch !== officeEpoch || q !== $('brainQuery').value.trim()) return;
  box.hidden = false;
  const rel = relevant.length ? `<div class="label">${t('ui.inbox.mostRelated')}</div>` + relevant.map(e =>
    `<div class="hit" data-open="${esc(e.file)}"><div class="f">${esc(e.file)} › ${esc(e.heading || 'general')}</div><div class="x">${highlight(e.text.slice(0, 220), q)}</div></div>`).join('') : '';
  const lit = hits.length ? `<div class="label">${t('ui.inbox.matches', { count: hits.length })}</div>` + hits.map(h =>
    `<div class="hit" ${h.scope === 'oficina' ? `data-open="${esc(h.file)}"` : `data-project="${esc(h.file)}"`}><div class="f">${esc(h.file)}:${h.line}</div><div class="x">${highlight(h.text, q)}</div></div>`).join('') : '';
  box.innerHTML = rel + lit || `<div class="muted pad">${t('ui.inbox.noResults')}</div>`;
}, 250);

let editing = null; // { name, base, isNew }

async function openEditor(name) {
  const dlg = $('editor');
  if (!name) {
    editing = { name: null, base: '', isNew: true, epoch: officeEpoch };
    $('editorTitle').textContent = t('ui.editorNewTopic');
    $('editorName').hidden = false; $('editorName').value = '';
    $('editorBody').value = t('ui.brain.defaultTopic');
    $('editorBody').readOnly = false;
    $('editorHistory').hidden = true; $('editorRestore').hidden = true; $('editorSave').hidden = false; $('editorXfer').hidden = true;
    dlg.showModal();
    $('editorName').focus();
    return;
  }
  const epoch = officeEpoch;
  const data = await api(`/api/memory/file?name=${encodeURIComponent(name)}`);
  if (epoch !== officeEpoch) return;
  editing = { name, base: data.content, isNew: false, epoch };
  $('editorTitle').textContent = `memoria/${name}`;
  $('editorName').hidden = true;
  $('editorBody').value = data.content;
  $('editorBody').readOnly = false;
  $('editorHistory').hidden = !data.history.length;
  $('editorHistory').innerHTML = `<option value="">${t('ui.brain.currentVersion')}</option>` + data.history.map(v =>
    `<option value="${esc(v)}">${esc(v.replace(/\.md$/, '').replace(/T(\d\d)-(\d\d)-(\d\d)-\d+Z/, ' $1:$2:$3 UTC'))}</option>`).join('');
  $('editorRestore').hidden = true; $('editorSave').hidden = false;
  $('editorXfer').hidden = oficinas.length < 2;
  dlg.showModal();
}

async function saveEditor() {
  if (!editing || editing.epoch !== officeEpoch) { $('editor').close(); toast(t('ui.brain.officeChanged'), true); return; }
  const content = $('editorBody').value;
  const epoch = editing.epoch;
  try {
    if (editing.isNew) {
      let name = $('editorName').value.trim();
      if (name && !name.endsWith('.md')) name += '.md';
      const r = await api('/api/memory/file', { method: 'POST', body: JSON.stringify({ name, content }) });
      toast(t('ui.inbox.topicCreated', { name: r.name }));
    } else {
      const r = await api('/api/memory/file', { method: 'PUT', body: JSON.stringify({ name: editing.name, base: editing.base, content }) });
      toast(r.merged ? t('ui.inbox.savedMerged') : t('ui.inbox.savedInBrain'));
    }
    if (epoch !== officeEpoch) return;
    $('editor').close();
    loadMemory();
  } catch (err) { toast(err.message, true); }
}

// ---------- Compositor y configuración del ciclo ----------

function fillComposerFromConfig(cfg) {
  templateId = cfg?.template || null;
  renderTemplates();
  const mode = cfg?.mode || 'rondas';
  document.querySelector(`input[name=mode][value=${mode}]`).checked = true;
  $('rounds').value = cfg?.maxRounds || (mode === 'auto' ? globalCfg.autoMaxRounds : globalCfg.maxRounds) || 3;
  $('minScore').value = cfg?.minScore || globalCfg.minScore || 9;
  workflowId = cfg?.workflow || 'relevo';
  chairDraft = cfg?.chair || null;
  $('maxParallel').value = cfg?.maxParallel || globalCfg.maxParallel || 2;
  const team = cfg?.team || agents.filter(allowedAgent).filter(a => a.enabled && a.installed).map(a => ({ id: a.id, role: a.role }));
  teamDraft = [
    ...team.filter(mb => agents.filter(allowedAgent).some(a => a.id === mb.id)).map(mb => ({ id: mb.id, role: mb.role, on: true })),
    ...agents.filter(allowedAgent).filter(a => !team.some(mb => mb.id === a.id)).map(a => ({ id: a.id, role: a.role, on: false })),
  ];
  renderTeam();
}

function renderTeam() {
  $('teamList').innerHTML = teamDraft.map((member, i) => {
    const a = agentOf(member.id);
    return `<li class="${member.on ? '' : 'out'}" style="--c:${esc(a.color)}" data-i="${i}">
      <input type="checkbox" ${member.on ? 'checked' : ''} ${a.installed ? '' : 'disabled'} title="${a.installed ? t('ui.team.participates') : t('ui.team.cliMissing')}">
      <span class="tn">${esc(a.name.toUpperCase())}</span>
      <input class="field" value="${esc(member.role)}" placeholder="${esc(t('ui.team.rolePlaceholder'))}" maxlength="60">
      <span class="mv"><button type="button" data-mv="-1" title="${t('ui.order.earlier')}">▲</button><button type="button" data-mv="1" title="${t('ui.order.later')}">▼</button></span>
    </li>`;
  }).join('');
  renderWorkflows();
}

function readConfig() {
  const mode = document.querySelector('input[name=mode]:checked').value;
  const team = teamDraft.filter(mb => mb.on).map(mb => ({ id: mb.id, role: mb.role.trim() }));
  return {
    mode,
    maxRounds: Number($('rounds').value) || undefined,
    minScore: Number($('minScore').value) || undefined,
    team,
    template: templateId,
    workflow: workflowId,
    chair: team.some(mb => mb.id === chairDraft) ? chairDraft : team[0]?.id,
    maxParallel: Number($('maxParallel').value) || undefined,
  };
}

// ---------- Modos de trabajo (Relevo, Delphi, Consejo) ----------

const wfOf = id => workflowsMeta.find(w => w.id === id) || null;

function renderWorkflows() {
  if (!workflowsMeta.length) return;
  $('wfCards').innerHTML = workflowsMeta.map(w => `
    <button type="button" class="wf-card${w.id === workflowId ? ' on' : ''}" data-wf="${esc(w.id)}" role="radio" aria-checked="${w.id === workflowId}">
      <span class="wf-ic">${esc(w.icon)}</span>
      <span class="wf-tx"><b>${esc(w.name)}</b>${w.alias ? ` <small>(${esc(w.alias)})</small>` : ''}<span>${esc(w.tagline)}</span></span>
      ${w.id === suggestedWf && w.id !== workflowId ? `<span class="wf-sug">${t('ui.wf.suggested')}</span>` : w.id === suggestedWf ? `<span class="wf-sug ok">✓ ${t('ui.wf.suggested')}</span>` : ''}
    </button>`).join('');
  const w = wfOf(workflowId);
  $('wfExplain').innerHTML = w ? `<p>${esc(w.explain)}</p>
    <p class="wf-meta"><span><b>${t('ui.wf.idealFor')}</b> ${esc(w.ideal)}</span><span><b>${t('ui.wf.careful')}</b> ${esc(w.careful)}</span></p>` : '';
  const parallel = workflowId !== 'relevo';
  $('cfgModeSet').hidden = parallel;
  $('cfgParSet').hidden = !parallel;
  $('chairLabel').hidden = workflowId !== 'consejo';
  const team = teamDraft.filter(mb => mb.on);
  if (!team.some(mb => mb.id === chairDraft)) chairDraft = team[0]?.id || null;
  $('chair').innerHTML = team.map(mb => `<option value="${esc(mb.id)}"${mb.id === chairDraft ? ' selected' : ''}>${esc(agentOf(mb.id).name)}</option>`).join('');
  $('roundsLabel').textContent = parallel ? w.roundsLabel : document.querySelector('input[name=mode]:checked').value === 'auto' ? t('ui.safetyCap') : t('ui.maxRounds');
  updateCfgSummary();
}

const suggestFromText = debounce(async () => {
  const text = $('input').value.trim();
  if (current?.running) return;
  const prev = suggestedWf;
  suggestedWf = text.length > 8 ? (await api(`/api/workflows/suggest?q=${encodeURIComponent(text)}`).catch(() => ({}))).workflow || null : null;
  if (suggestedWf !== prev) renderWorkflows();
}, 450);

// ---------- Plantillas de misión ----------

const templateOf = id => templates.find(mb => mb.id === id) || null;

async function loadTemplates() {
  templates = await api('/api/templates').catch(() => templates);
  if (templateId && !templateOf(templateId)) templateId = null; // la borraron (aquí o en otra pestaña)
  renderTemplates();
  setRunning(!!current?.running);
}

function renderTemplates() {
  if (!templates.length) return;
  $('tplChips').innerHTML = [{ id: '', name: t('ui.tpl.freeName'), icon: '·' }, ...templates].map(item =>
    `<button type="button" class="chip${(templateId || '') === item.id ? ' on' : ''}${item.custom ? ' custom' : ''}" data-tpl="${esc(item.id)}" title="${esc(item.desc || t('ui.tpl.freeTitle'))}${item.custom ? t('ui.tpl.ownTag') : ''}"><b>${esc(item.icon)}</b>${esc(item.name.toUpperCase())}</button>`).join('');
  const tpl = templateOf(templateId);
  $('tplDesc').textContent = tpl
    ? `${tpl.desc}.${tpl.output ? t('ui.tpl.deliverable', { output: tpl.output }) : ''}${tpl.criteria?.length ? t('ui.tpl.criteriaInBrief') : ''}`
    : t('ui.tpl.chooseType');
  $('tplDeleteBtn').hidden = !tpl?.custom;
}

// Guardar como plantilla propia: el compositor actual (texto, ciclo y equipo) + criterios y entregable.
function openTemplateDialog() {
  const tpl = templateOf(templateId);
  const c = readConfig();
  if (!c.team.length) return toast(t('ui.tpl.chooseAgentFirst'), true);
  $('tplName').value = tpl?.custom ? tpl.name : '';
  $('tplDescIn').value = tpl?.custom ? tpl.desc : '';
  $('tplCriteria').value = (tpl?.criteria || []).join('\n');
  $('tplOutput').value = tpl?.output || '';
  $('tplSummary').textContent = c.mode === 'auto' ? t('ui.tpl.summaryAuto', { rounds: c.maxRounds, score: c.minScore, team: c.team.map(x => agentOf(x.id).name).join(' → ') }) : t('ui.tpl.summaryRounds', { rounds: c.maxRounds, score: c.minScore, team: c.team.map(x => agentOf(x.id).name).join(' → ') });
  $('tplDialog').showModal();
  $('tplName').focus();
}

async function saveTemplate() {
  const { template: _, ...cfg } = readConfig();
  try {
    const r = await api('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ ...cfg, name: $('tplName').value, desc: $('tplDescIn').value, criteria: $('tplCriteria').value, output: $('tplOutput').value, skeleton: $('input').value }),
    });
    templateId = r.template.id;
    $('tplDialog').close();
    await loadTemplates();
    updateCfgSummary();
    toast(r.replaced ? t('ui.tpl.updated', { name: r.template.name }) : t('ui.tpl.saved', { name: r.template.name }));
  } catch (err) { toast(err.message, true); }
}

async function deleteTemplate() {
  const tpl = templateOf(templateId);
  if (!tpl?.custom || !confirm(t('ui.tpl.deleteConfirm', { name: tpl.name }))) return;
  try {
    await api(`/api/templates/${encodeURIComponent(tpl.id)}`, { method: 'DELETE' });
    templateId = null;
    await loadTemplates();
    updateCfgSummary();
    toast(t('ui.tpl.deleted', { name: tpl.name }));
  } catch (err) { toast(err.message, true); }
}

// Aplica la configuración sugerida y el pedido guiado. No pisa lo que el usuario ya escribió.
function applyTemplate(id) {
  const prev = templateOf(templateId);
  const tpl = templateOf(id);
  templateId = tpl ? tpl.id : null;
  if (tpl) {
    document.querySelector(`input[name=mode][value=${tpl.mode}]`).checked = true;
    $('rounds').value = tpl.maxRounds;
    $('minScore').value = tpl.minScore;
    const usable = agentId => agents.filter(allowedAgent).some(a => a.id === agentId && a.installed);
    teamDraft = [
      ...tpl.team.filter(x => agents.filter(allowedAgent).some(a => a.id === x.id)).map(x => ({ id: x.id, role: x.role, on: usable(x.id) })),
      ...agents.filter(allowedAgent).filter(a => !tpl.team.some(x => x.id === a.id)).map(a => ({ id: a.id, role: a.role, on: false })),
    ];
    renderTeam();
    const text = $('input').value.trim();
    if (!text || (prev && text === prev.skeleton.trim())) $('input').value = tpl.skeleton;
    else toast(t('ui.tpl.textKept'));
  } else {
    // Libre: vuelve a la configuración por defecto; el texto propio del usuario se queda.
    if (prev && $('input').value.trim() === prev.skeleton.trim()) $('input').value = '';
    fillComposerFromConfig(null);
  }
  renderTemplates();
  $('input').focus();
}

// ---------- Avisos de escritorio ----------

const canNotify = 'Notification' in window;
let notifyOn = canNotify && Notification.permission === 'granted' && localStorage.getItem('om-notify') === '1';
let unseen = 0;

function renderNotifyBtn() {
  $('notifyBtn').innerHTML = `${notifyOn ? '🔔' : '🔕'} <span class="lbl">${esc(t('ui.notify.label'))}</span>`; // en móvil solo el icono
  $('notifyBtn').classList.toggle('on', notifyOn);
  $('notifyBtn').dataset.hover = 'txt:' + t(!canNotify ? 'ui.notify.unsupported' : notifyOn ? 'ui.notify.onHover' : 'ui.notify.offHover');
}

async function toggleNotify() {
  if (!canNotify) return toast(t('ui.notify.unsupported'), true);
  if (notifyOn) notifyOn = false;
  else {
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (perm !== 'granted') return toast(t('ui.notify.blocked'), true);
    notifyOn = true;
  }
  localStorage.setItem('om-notify', notifyOn ? '1' : '0');
  renderNotifyBtn();
  toast(notifyOn ? t('ui.notify.active') : t('ui.notify.inactive'));
}

// ---------- Tema claro u oscuro (D65) ----------
// index.html fija data-tema antes del primer pintado; aquí solo se alterna y se recuerda. La escena sigue oscura en
// los dos: es un mundo de pixel art, no un panel. Las gráficas se repintan porque Charts.distinct mezcla hacia el fondo.

function renderThemeBtn() {
  const claro = document.documentElement.dataset.tema === 'claro';
  $('themeBtn').textContent = claro ? '☾' : '☀';
  $('themeBtn').dataset.hover = 'txt:' + t(claro ? 'ui.theme.toDark' : 'ui.theme.toLight');
}

function toggleTheme() {
  const tema = document.documentElement.dataset.tema === 'claro' ? 'oscuro' : 'claro';
  document.documentElement.dataset.tema = tema;
  try { localStorage.setItem('om-tema', tema); } catch {}
  renderThemeBtn();
  renderReports();
  renderCharts();
}

const OUTCOME_ICON = { unanime: '✅', consenso: '✅', aceptado: '✓', agotado: '⏹', meseta: '⏸', retroceso: '⚠', detenido: '■', error: '⚠', 'sin-agentes': '⚠' };

// Aviso de escritorio (si está activado) y contador en el título si la pestaña está oculta.
// No molesta si el usuario ya está mirando esa misión.
function notify(chatId, icon, title, body, tag) {
  if (document.hidden) { unseen++; document.title = `(${unseen}) ${icon} ${t('ui.pageTitle')}`; }
  if (!notifyOn || (!document.hidden && chatId === currentId)) return;
  const n = new Notification(`${icon} OfficeMatrix · ${title}`, { body, tag });
  n.onclick = () => { window.focus(); openChat(chatId).catch(err => toast(err.message, true)); n.close(); };
}

function cycleEnded(ev) {
  const title = ev.title || ev.chatId;
  const icon = OUTCOME_ICON[ev.outcome] || '■';
  if (ev.chatId !== currentId) toast(t('ui.notify.finished', { icon, title }), ev.outcome === 'error');
  notify(ev.chatId, icon, title, ev.summary || t('ui.notify.cycleEnded'), `om-${ev.chatId}`);
}

// Un agente respondió a una objeción que planteó el usuario.
function objectionAnswered(ev) {
  const verb = { resuelta: t('ui.notify.verbResolved'), rechazada: t('ui.notify.verbRejected'), apoyo: t('ui.notify.verbAgreed') }[ev.stance] || ev.stance;
  toast(t('ui.notify.objRepliedToast', { agent: ev.agentName, id: ev.id, verb }));
  notify(ev.chatId, '↳', t('ui.notify.objRepliedToast', { agent: ev.agentName, id: ev.id, verb }), t('ui.notify.objRepliedBody', { obj: ev.objection.slice(0, 80), verb, reply: ev.reply.slice(0, 160) }), `om-obj-${ev.chatId}-${ev.id}`);
}

// Una CLI se quedó sin saldo, sin sesión, colgada…: sale del ciclo y el resto sigue.
function agentFailed(ev) {
  const rest = ev.remaining.length ? t('ui.toast.remaining', { names: ev.remaining.join(', ') }) : t('ui.toast.nobodyLeft');
  toast(t('ui.toast.agentFailedRest', { name: ev.agentName, label: ev.failure.label, rest }), true);
  notify(ev.chatId, '⛔', `${ev.agentName}: ${ev.failure.label}`, `${ev.failure.detail}\n${ev.failure.hint}`, `om-fail-${ev.chatId}-${ev.agentId}`);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && unseen) { unseen = 0; document.title = t('ui.pageTitle'); }
});

function updateCfgSummary() {
  const c = readConfig();
  const w = wfOf(c.workflow);
  const parallel = c.workflow && c.workflow !== 'relevo';
  if (!parallel) $('roundsLabel').textContent = c.mode === 'auto' ? t('ui.safetyCap') : t('ui.maxRounds');
  $('cfgSummary').textContent = `· ${w ? `${w.icon} ${w.name.toUpperCase()} ` : ''}${templateOf(c.template) ? `· ${templateOf(c.template).name.toUpperCase()} ` : ''}· ` +
    (parallel ? t('ui.cfg.rounds', { rounds: c.maxRounds, par: c.maxParallel, chair: c.workflow === 'consejo' ? t('ui.cfg.chair', { name: agentOf(c.chair).name }) : '' }) : (c.mode === 'auto' ? t('ui.cfg.autoRounds', { rounds: c.maxRounds }) : t('ui.cfg.simpleRounds', { rounds: c.maxRounds }))) +
    ` · ${t('ui.cfg.minScore', { score: c.minScore })} · ` + (c.team.map(member => agentOf(member.id).name).join(parallel ? ' · ' : ' → ') || t('ui.cfg.noTeam'));
  renderIntent();
}

const DEFAULT_PLACEHOLDER = () => t('ui.ph.default');
const LIVE_PLACEHOLDER = () => t('ui.ph.live');
const RESUME_PLACEHOLDER = () => t('ui.ph.resume');

function setRunning(isRunning) {
  const interrupted = !isRunning && current?.outcome === 'interrupted';
  $('stopBtn').hidden = !isRunning;
  $('interveneLabel').hidden = !isRunning || isParallelRun(); // en Delphi y Consejo no hay hilo de objeciones
  $('tplStrip').hidden = isRunning || !templates.length;
  $('wfStrip').hidden = isRunning || !workflowsMeta.length;
  // Compacto incluso durante el ciclo; el foco o un borrador abren el compositor.
  $('composer').classList.toggle('compact', (!!currentId || oficina !== 'edificio') && !composerOpen && !$('input').value.trim());
  $('input').placeholder = isRunning ? LIVE_PLACEHOLDER() : interrupted ? RESUME_PLACEHOLDER() : DEFAULT_PLACEHOLDER();
  const text = $('input').value.trim();
  $('sendBtn').textContent = isRunning ? t('ui.btn.intervene') : interrupted ? (text ? t('ui.btn.newRequest') : t('ui.btn.resumeCycle'))
    : currentId ? (text ? t('ui.btn.newRequest') : t('ui.btn.anotherPass')) : t('ui.btn.deploy');
  $('composer').classList.toggle('live', isRunning);
  renderIntent();
}

// ---------- Eventos de la interfaz ----------

// Archivos que acompañan el próximo envío. Se suben al enviar y quedan en adjuntos/ de la misión.
let pendingFiles = [];
const kb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
function addFiles(list) {
  for (const f of list) {
    if (f.size > 50 * 1048576) { toast(t('ui.toast.tooBig', { name: f.name }), true); continue; }
    if (!pendingFiles.some(p => p.name === f.name && p.size === f.size)) pendingFiles.push(f);
  }
  renderAttachments();
  openComposer();
}
function renderAttachments() {
  $('attachList').hidden = !pendingFiles.length;
  $('attachList').innerHTML = pendingFiles.map((f, i) =>
    `<span class="attach-chip">📎 ${esc(f.name)} <small>${kb(f.size)}</small><button type="button" data-i="${i}" title="Quitar">✕</button></span>`).join('');
}
async function uploadPending() {
  const ids = [];
  for (const f of pendingFiles) {
    const res = await fetch(`/api/adjuntos?nombre=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${f.name}: ${data.error || res.statusText}`);
    ids.push(data.id);
  }
  return ids;
}
const clearAttachments = () => { pendingFiles = []; renderAttachments(); };

$('fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
$('attachList').addEventListener('click', e => {
  const b = e.target.closest('button[data-i]');
  if (b) { pendingFiles.splice(Number(b.dataset.i), 1); renderAttachments(); }
});
$('composer').addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); $('composer').classList.add('dragging'); } });
$('composer').addEventListener('dragleave', e => { if (!$('composer').contains(e.relatedTarget)) $('composer').classList.remove('dragging'); });
$('composer').addEventListener('drop', e => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  $('composer').classList.remove('dragging');
  addFiles(e.dataTransfer.files);
});

$('composer').addEventListener('submit', e => {
  e.preventDefault();
  withBusy($('sendBtn'), sendComposer);
});

async function sendComposer() {
  const text = $('input').value.trim();
  if (currentId && current?.running) {
    if (!text) return toast(t('ui.toast.writeDirective'), true);
    try {
      const { working, next } = whoIsNext();
      const attachments = await uploadPending();
      const r = await api(`/api/chats/${encodeURIComponent(currentId)}/intervene`, {
        method: 'POST',
        body: JSON.stringify({ text, asObjection: $('interveneObj').checked && !isParallelRun(), attachments }),
      });
      $('input').value = '';
      clearAttachments();
      // Confirmación concreta: quién la recibe y cuándo.
      const workingPart = working.length ? (working.length > 1 ? t('ui.intent.liveHasItNowPlural', { who: names(working) }) : t('ui.intent.liveHasItNow', { who: names(working) })) : t('ui.intent.liveNextReceives');
      const nextPart = next.length ? (next.length > 1 ? t('ui.toast.interveneNextTurnPlural', { who: names(next) }) : t('ui.toast.interveneNextTurn', { who: names(next) })) : '';
      const objPart = r.objection ? t('ui.toast.interveneObjNotice', { id: r.objection.id }) : '';
      toast(t('ui.toast.directiveSent', { who: `${workingPart}${nextPart}.${objPart}` }));
      await openChat(currentId, { keepLog: true });
    } catch (err) { toast(err.message, true); }
    return;
  }
  if (!text && !currentId) return toast(t('ui.toast.describeFirst'), true);
  const config = readConfig();
  if (!config.team.length) return toast(t('ui.toast.selectAgent'), true);
  try {
    const attachments = await uploadPending();
    if (currentId) {
      const resumed = !text && current?.outcome === 'interrupted';
      await api(`/api/chats/${encodeURIComponent(currentId)}/messages`, { method: 'POST', body: JSON.stringify({ text, config, attachments }) });
      $('input').value = '';
      clearAttachments();
      toast(resumed ? t('ui.toast.resumedSame') : text ? t('ui.toast.newReqSent', { agent: agentOf(config.team[0].id).name }) : t('ui.toast.anotherPassSent'));
      await openChat(currentId, { keepLog: true });
    } else {
      const chat = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text, config, attachments }) });
      $('input').value = '';
      clearAttachments();
      toast(t('ui.toast.deployed', { path: `${projectsRoot()}${chat.id}` }));
      await loadChats();
      await openChat(chat.id);
    }
  } catch (err) { toast(err.message, true); }
}

$('input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('composer').requestSubmit(); });
$('input').addEventListener('input', suggestFromText);
$('input').addEventListener('input', () => setRunning(!!current?.running));
$('interveneObj').addEventListener('change', renderIntent);
const openComposer = () => { if (composerOpen) return; composerOpen = true; setRunning(!!current?.running); };
$('input').addEventListener('focus', openComposer);
$('composer').addEventListener('click', e => { if (e.target.closest('.wf-strip, .tpl-strip')) openComposer(); });
$('wfCards').addEventListener('click', e => {
  const b = e.target.closest('[data-wf]');
  if (!b) return;
  workflowId = b.dataset.wf;
  // Delphi necesita una ronda menos que borradores para que cada uno pase por todos.
  if (workflowId === 'delphi') $('rounds').value = Math.max(2, teamDraft.filter(mb => mb.on).length - 1);
  else if (workflowId === 'consejo') $('rounds').value = 2;
  else $('rounds').value = (document.querySelector('input[name=mode]:checked').value === 'auto' ? globalCfg.autoMaxRounds : globalCfg.maxRounds) || 3;
  renderWorkflows();
});
$('chair').addEventListener('change', e => { chairDraft = e.target.value; updateCfgSummary(); });
$('newChatBtn').onclick = newChat;
$('notifyBtn').onclick = toggleNotify;
$('themeBtn').onclick = toggleTheme;
$('tplChips').addEventListener('click', e => { const b = e.target.closest('[data-tpl]'); if (b) applyTemplate(b.dataset.tpl); });
$('tplSaveBtn').onclick = openTemplateDialog;
$('tplDeleteBtn').onclick = deleteTemplate;
$('tplForm').addEventListener('submit', e => { e.preventDefault(); saveTemplate(); });
$('stopBtn').onclick = () => {
  if (!currentId || !confirm(t('ui.confirm.stopCycle'))) return;
  withBusy($('stopBtn'), () => api(`/api/chats/${encodeURIComponent(currentId)}/stop`, { method: 'POST' }).then(() => toast(t('ui.toast.stoppingCycle'))).catch(err => toast(err.message, true)));
};
// Abre la carpeta (o la del archivo, con él seleccionado) y dice dónde está, por si la ventana sale detrás.
const reveal = (btn, p) => currentId && withBusy(btn, () => api(`/api/chats/${encodeURIComponent(currentId)}/open`, { method: 'POST', body: JSON.stringify(p ? { path: p } : {}) })
  .then(r => toast(t('ui.toast.openedExplorer', { path: r.path }))).catch(err => toast(err.message, true)));
$('openFolderBtn').onclick = () => reveal($('openFolderBtn'));
$('deliverBtn').onclick = () => current?.deliverables?.main && openViewer(current.deliverables.main);
$('exportBtn').onclick = () => { if (currentId) location.href = `/api/chats/${encodeURIComponent(currentId)}/export`; };
$('chatFilter').addEventListener('input', renderChats);
$('chatList').addEventListener('click', e => { const li = e.target.closest('li[data-id]'); if (li) { openChat(li.dataset.id); drawer(null); } });

// Cajones (pantallas estrechas): las misiones a la izquierda y el log a la derecha. En escritorio son columnas y estos
// botones no se ven; el CSS decide. Uno abierto a la vez; se cierran con el velo, con Escape o al elegir una misión.
function drawer(which) {
  for (const [id, btn] of [['missions', 'missionsBtn'], ['intel', 'intelBtn']]) {
    const open = which === id && !document.body.classList.contains(`${id}-open`);
    document.body.classList.toggle(`${id}-open`, open);
    $(btn).setAttribute('aria-expanded', String(open));
  }
  $('scrim').hidden = !document.body.matches('.missions-open, .intel-open');
}
$('missionsBtn').onclick = () => drawer('missions');
$('intelBtn').onclick = () => drawer('intel');
$('scrim').onclick = () => drawer(null);
$('newChatBtn').addEventListener('click', () => drawer(null));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('scrim').hidden && !document.querySelector('dialog[open]')) drawer(null); });
$('situation').addEventListener('click', async e => {
  if (e.target.id !== 'acceptMissionBtn' || !currentId) return;
  e.preventDefault();
  if (!confirm(t('ui.confirm.acceptDeliverable'))) return;
  try {
    await api(`/api/chats/${encodeURIComponent(currentId)}/accept`, { method: 'POST' });
    toast(t('ui.toast.accepted'));
    await openChat(currentId);
    await loadChats();
  } catch (err) { toast(err.message, true); }
});

$('cycleConfig').addEventListener('change', e => {
  if (e.target.name === 'mode') $('rounds').value = (e.target.value === 'auto' ? globalCfg.autoMaxRounds : globalCfg.maxRounds) || 3;
  const li = e.target.closest('#teamList li');
  if (li && e.target.type === 'checkbox') { teamDraft[li.dataset.i].on = e.target.checked; renderTeam(); return; }
  if (e.target.name === 'mode') renderWorkflows();
  updateCfgSummary();
});
$('teamList').addEventListener('input', e => {
  const li = e.target.closest('li');
  if (li && e.target.classList.contains('field')) { teamDraft[li.dataset.i].role = e.target.value; updateCfgSummary(); }
});
$('teamList').addEventListener('click', e => {
  const b = e.target.closest('button[data-mv]');
  if (!b) return;
  const i = Number(b.closest('li').dataset.i), j = i + Number(b.dataset.mv);
  if (j < 0 || j >= teamDraft.length) return;
  [teamDraft[i], teamDraft[j]] = [teamDraft[j], teamDraft[i]];
  renderTeam();
});

$('mainTabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  for (const x of $('mainTabs').children) x.classList.toggle('on', x === b);
  for (const tab of ['reports', 'debate', 'handoff', 'charts', 'agents', 'editorial']) $(`tab-${tab}`).hidden = tab !== b.dataset.tab;
  if (b.dataset.tab === 'editorial') loadEditorial();
  if (b.dataset.tab === 'charts') renderCharts();
  syncHash();
});
$('sideTabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-side]');
  if (!b) return;
  for (const x of $('sideTabs').children) x.classList.toggle('on', x === b);
  for (const side of ['log', 'files', 'brain']) $(`side-${side}`).hidden = side !== b.dataset.side;
  syncHash();
});

$('tab-reports').addEventListener('click', async e => {
  if (e.target.matches('[data-resume]')) {
    if (!currentId) return;
    await withBusy(e.target, async () => {
      try {
        await api(`/api/chats/${encodeURIComponent(currentId)}/messages`, { method: 'POST', body: JSON.stringify({ resume: true, config: readConfig() }) });
        toast(t('server.notice.resume'));
        await openChat(currentId, { keepLog: true });
      } catch (err) { toast(err.message, true); }
    });
    return;
  }
  const rv = e.target.closest('[data-reveal]');
  if (rv) return reveal(rv, rv.dataset.reveal);
  if (!e.target.classList.contains('more')) return;
  const body = e.target.previousElementSibling;
  body.classList.toggle('collapsed');
  e.target.textContent = body.classList.contains('collapsed') ? t('ui.viewAll') : t('ui.viewLess');
});
$('tab-debate').addEventListener('submit', async e => {
  if (e.target.id !== 'debateForm' || !currentId) return;
  e.preventDefault();
  const text = $('debateInput')?.value.trim();
  if (!text) return;
  try {
    await api(`/api/chats/${encodeURIComponent(currentId)}/debate`, { method: 'POST', body: JSON.stringify({ text }) });
    toast(t('ui.toast.objAdded'));
    await openChat(currentId, { keepLog: true });
  } catch (err) { toast(err.message, true); }
});
$('tab-debate').addEventListener('click', async e => {
  const b = e.target.closest('[data-obj-status]');
  if (!b || !currentId) return;
  try {
    await api(`/api/chats/${encodeURIComponent(currentId)}/debate`, {
      method: 'POST',
      body: JSON.stringify({ id: Number(b.dataset.objId), status: b.dataset.objStatus }),
    });
    await openChat(currentId, { keepLog: true });
  } catch (err) { toast(err.message, true); }
});
$('tab-agents').addEventListener('click', e => {
  const b = e.target.closest('[data-scope]');
  if (!b) return;
  statsScope = b.dataset.scope;
  if (statsScope === 'global') globalStats = null; // siempre fresco
  renderAgents();
});

$('logAgents').addEventListener('click', e => {
  const b = e.target.closest('[data-agent]');
  if (!b) return;
  const id = b.dataset.agent;
  if (!id) logFilter.agents.clear();
  else if (logFilter.agents.has(id)) logFilter.agents.delete(id);
  else logFilter.agents.add(id);
  renderLogChips(); renderLog();
});
$('logKind').addEventListener('change', e => { logFilter.kind = e.target.value; renderLog(); });
$('logSearch').addEventListener('input', debounce(e => { logFilter.q = e.target.value.trim(); renderLog(); }, 200));
$('log').addEventListener('click', e => { const ev = e.target.closest('.ev.has-dt'); if (ev) ev.classList.toggle('open'); });

// ---------- Visor de entregables ----------
// Cada archivo como lo verá el lector: HTML en un iframe aislado (sandbox sin allow-same-origin + CSP del servidor),
// Markdown con sus imágenes, imágenes con galería, PDF, audio/vídeo y código resaltado. En vivo se refresca solo
// cuando un agente escribe el archivo (o salta al que están escribiendo, con SEGUIR).

const pv = { chatId: null, path: null, kind: null, mode: 'render', stamp: 0 };
const previewable = p => kindOfPath(p) !== 'binary';

function openViewer(p, chatId = currentId) {
  if (!p || !chatId) return;
  pv.chatId = chatId;
  pv.path = p;
  pv.kind = kindOfPath(p);
  pv.mode = pv.kind === 'code' ? 'code' : 'render';
  pv.stamp = Date.now();
  if (!$('viewer').open) $('viewer').showModal();
  renderPvList();
  loadPv();
}

function renderPvList() {
  const items = pv.chatId === currentId ? (current?.deliverables?.items || []) : [{ path: pv.path, kind: pv.kind }];
  const main = pv.chatId === currentId ? current?.deliverables?.main : null;
  const show = items.filter(i => i.kind !== 'binary');
  $('pvList').hidden = show.length < 2;
  $('pvList').innerHTML = show.map(i => `<button type="button" class="${i.path === pv.path ? 'on' : ''}${i.touched ? ' fresh' : ''}" data-pv="${esc(i.path)}" data-hover="file:${esc(i.path)}">` +
    `<span>${i.path === main ? '★' : KIND_ICON[i.kind] || '·'}</span><span class="nm">${esc(i.path)}</span></button>`).join('');
}

async function loadPv({ quiet = false } = {}) {
  const { chatId, path: p, kind } = pv;
  const url = rawUrl(chatId, p);
  const stage = $('pvStage');
  $('viewerTitle').textContent = p;
  $('pvKind').textContent = `${KIND_ICON[kind] || ''} ${KIND_LABEL[kind] || ''}`;
  $('pvTab').href = url;
  for (const b of $('pvMode').children) {
    b.classList.toggle('on', b.dataset.mode === pv.mode);
    b.disabled = b.dataset.mode === 'render' ? kind === 'code' || kind === 'binary' : ['image', 'pdf', 'media', 'binary'].includes(kind);
  }
  const file = (pv.chatId === currentId ? current?.files : [])?.find(f => f.path === p);
  const sep = current?.path?.includes('\\') ? '\\' : '/';
  $('pvFoot').innerHTML = `${pv.chatId === currentId && current?.path ? `<code>${esc(I18N.shortHome(`${current.path}${sep}${p.split('/').join(sep)}`))}</code>` : ''}` +
    `${file ? ` · ${file.size > 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${file.size} B`}${t('ui.pv.modified', { time: hhmmss(file.mtime) })}` : ''}` +
    (kind === 'html' && pv.mode === 'render' ? ` · <span class="muted">${t('ui.pv.isolated')}</span>` : '');
  if (!quiet) stage.innerHTML = `<div class="pv-loading"><span class="spin"></span> ${t('ui.pv.loading')}</div>`;
  const bust = `?v=${pv.stamp}`;
  if (pv.mode === 'code' || kind === 'md') {
    try {
      const { content } = await api(`/api/chats/${encodeURIComponent(chatId)}/file?path=${encodeURIComponent(p)}`);
      if (pv.path !== p || pv.chatId !== chatId) return; // el usuario ya abrió otro archivo u otra misión
      stage.innerHTML = pv.mode === 'code'
        ? `<pre class="pv-code">${highlightCode(content, p)}</pre>`
        : `<article class="md pv-md">${md(content, { chatId, base: dirOf(p) })}</article>`;
    } catch (err) {
      if (pv.path !== p || pv.chatId !== chatId) return;
      stage.innerHTML = `<div class="pv-empty">${esc(err.message)}<br><a class="btn small" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${t('ui.pv.openNewTab')}</a></div>`;
    }
    return;
  }
  if (kind === 'html') {
    // Sin allow-same-origin: el documento corre en un origen opaco y no ve cookies, almacenamiento ni la API de la app.
    const frame = Object.assign(document.createElement('iframe'), { className: 'pv-frame', src: url + bust, title: p });
    frame.setAttribute('sandbox', 'allow-scripts allow-popups allow-modals');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.addEventListener('load', () => stage.querySelector('.pv-loading')?.remove());
    if (quiet) stage.querySelector('iframe')?.replaceWith(frame); else stage.appendChild(frame);
    return;
  }
  if (kind === 'image') {
    const imgs = (pv.chatId === currentId ? current?.deliverables?.items || [] : []).filter(i => i.kind === 'image');
    stage.innerHTML = `<div class="pv-img"><img src="${esc(url + bust)}" alt="${esc(p)}"></div>` +
      (imgs.length > 1 ? `<div class="pv-gallery">${imgs.map(i => `<button type="button" class="${i.path === p ? 'on' : ''}" data-pv="${esc(i.path)}" data-hover="file:${esc(i.path)}"><img src="${esc(rawUrl(chatId, i.path))}" alt="" loading="lazy"></button>`).join('')}</div>` : '');
    return;
  }
  if (kind === 'pdf') { stage.innerHTML = `<iframe class="pv-frame pdf" src="${esc(url + bust)}" title="${esc(p)}"></iframe>`; return; }
  if (kind === 'media') {
    stage.innerHTML = /\.(mp3|wav|ogg)$/i.test(p) ? `<div class="pv-img"><audio controls src="${esc(url)}"></audio></div>` : `<div class="pv-img"><video controls src="${esc(url)}"></video></div>`;
    return;
  }
  stage.innerHTML = `<div class="pv-empty">${t('ui.pv.noPreview')}<br><a class="btn small" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${t('ui.pv.downloadOpen')}</a></div>`;
}

// Escrituras de los agentes en vivo: refresca el archivo abierto (o salta al que escriben, con SEGUIR).
const reloadPv = debounce(() => { if ($('viewer').open) { pv.stamp = Date.now(); loadPv({ quiet: true }); $('pvStamp').textContent = t('ui.pv.updated', { time: hhmmss(Date.now()) }); } }, 1500);
const followPv = debounce(p => { if ($('viewer').open && p !== pv.path) openViewer(p); }, 800);
function onAgentWrite(entry) {
  if (entry.kind !== 'write' || !entry.file) return;
  const p = projectRel(entry.file);
  lastWrite = { path: p, agentId: entry.agentId, ts: Date.now() };
  renderSituation();
  if (!$('viewer').open || pv.chatId !== currentId) return;
  if ($('pvFollow').checked && previewable(p)) { followPv(p); reloadPv(); return; }
  // Un HTML depende de su CSS, sus scripts y sus imágenes: cualquier escritura en su carpeta lo refresca.
  const related = samePath(p, pv.path) || (pv.kind === 'html' && (p.startsWith(`${dirOf(pv.path)}/`) || !dirOf(pv.path)));
  if ($('pvLive').checked && related) reloadPv();
}

$('pvMode').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (!b || b.disabled || b.dataset.mode === pv.mode) return;
  pv.mode = b.dataset.mode;
  loadPv();
});
$('pvReload').onclick = () => { pv.stamp = Date.now(); loadPv(); };
$('pvFolder').onclick = () => pv.chatId === currentId && reveal($('pvFolder'), pv.path);
$('viewer').addEventListener('click', e => { const b = e.target.closest('[data-pv]'); if (b) openViewer(b.dataset.pv, pv.chatId); });
$('viewer').addEventListener('close', () => { $('pvStage').innerHTML = ''; $('pvStamp').textContent = ''; });
// Cualquier enlace o botón con data-preview (situación, entrega, log, Markdown) abre el visor.
document.addEventListener('click', e => {
  const el = e.target.closest('[data-preview]');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  openViewer(el.dataset.preview, pv.chatId && $('viewer').open ? pv.chatId : currentId);
}, true);

$('files').addEventListener('click', e => {
  const li = e.target.closest('li[data-path]');
  if (li && !li.classList.contains('dir')) openViewer(li.dataset.path);
});

$('memory').addEventListener('click', e => { const li = e.target.closest('li[data-memory]'); if (li) openEditor(li.dataset.memory).catch(err => toast(err.message, true)); });
$('brainQuery').addEventListener('input', searchBrain);
$('brainResults').addEventListener('click', e => {
  const hit = e.target.closest('.hit');
  if (!hit) return;
  if (hit.dataset.open) openEditor(hit.dataset.open).catch(err => toast(err.message, true));
  else if (hit.dataset.project) {
    const [chatId, ...rest] = hit.dataset.project.split('/');
    openViewer(rest.join('/'), chatId);
  }
});
$('newTopicBtn').onclick = () => openEditor(null);
$('editorSave').onclick = saveEditor;
$('editorHistory').addEventListener('change', async e => {
  const v = e.target.value;
  if (!v) { $('editorBody').value = editing.base; $('editorBody').readOnly = false; $('editorRestore').hidden = true; $('editorSave').hidden = false; return; }
  const epoch = editing?.epoch;
  const data = await api(`/api/memory/file?name=${encodeURIComponent(editing.name)}&version=${encodeURIComponent(v)}`);
  if (!editing || editing.epoch !== epoch || epoch !== officeEpoch) return;
  $('editorBody').value = data.content;
  $('editorBody').readOnly = true;
  $('editorRestore').hidden = false; $('editorSave').hidden = true;
});
$('editorRestore').onclick = () => {
  // Restaurar = guardar esa versión como contenido nuevo (la actual queda en el historial).
  $('editorBody').readOnly = false;
  $('editorHistory').value = '';
  saveEditor();
};
document.addEventListener('click', e => { if (e.target.matches('[data-close]')) e.target.closest('dialog').close(); });

// ---------- Eventos en vivo ----------

const refresh = debounce(() => currentId && openChat(currentId, { keepLog: true }), 350);

function connect() {
  const events = new EventSource('/api/events');
  events.onopen = () => { $('linkState').textContent = t('ui.link.on'); $('linkState').classList.remove('down'); };
  events.onerror = () => { $('linkState').textContent = t('ui.link.off'); $('linkState').classList.add('down'); };
  events.onmessage = e => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'office-chat') onOfficeChat(ev);
    if (ev.type === 'editorial-updated' && ev.oficina === oficina) loadEditorial();
    if (ev.type === 'cycle-ended') cycleEnded(ev);
    if (ev.type === 'objection-answered') objectionAnswered(ev);
    if (ev.type === 'agent-failed') agentFailed(ev);
    if (ev.type === 'templates-updated') loadTemplates();
    if (ev.type === 'oficinas-updated' || ev.type === 'cycle-started' || ev.type === 'cycle-ended') loadOffices();
    if (ev.type === 'oficinas-updated' && oficina !== 'edificio') {
      const epoch = officeEpoch;
      loadAgents().then(() => { if (epoch !== officeEpoch || currentId) return; fillComposerFromConfig(null); renderStations(); });
    }
    // Un bot que contesta a «Probar» (o cualquier cambio de bots) se ve al momento en la ventana de la oficina.
    if (ev.type === 'oficinas-updated' && $('officeDialog').open && officeEditing) loadOfficeBots(officeEditing).catch(() => {});
    if (ev.type === 'entrantes-updated' && ev.oficina === oficina) loadInbound();
    // El tablero «Hoy» se rehace con cada hecho del servidor (si no hay misión abierta).
    if (['cycle-started', 'cycle-ended', 'chat-updated', 'memory-updated', 'entrantes-updated', 'oficinas-updated', 'agent-failed'].includes(ev.type)) loadHoySoon();
    // Cada oficina tiene su cerebro: solo se recarga el de la oficina que se está viendo.
    if (ev.type === 'memory-updated' && (ev.oficina || 'edificio') === oficina) { Nave.sabia(); loadMemory(); if ($('brainQuery').value.trim()) searchBrain(); }
    if (['chat-updated', 'cycle-started', 'cycle-ended', 'cierre-updated', 'debate-updated'].includes(ev.type)) {
      if (ev.chatId === currentId) refresh();
      loadChats();
    }
    if (ev.chatId !== currentId) return;
    if (ev.type === 'progress' && current) {
      // Un cierre (closed) no es un ciclo en marcha: si no, «lo acepto así» pinta «preparando el siguiente turno».
      if (ev.progress && ev.progress.closed) {
        current.running = false;
        current.progress = null;
        setRunning(false);
        renderSituation();
        renderNow();
        renderStations();
      } else {
        current.progress = ev.progress; current.running = true; renderProgress(ev.progress); setRunning(true); renderNow(); renderStations();
      }
    }
    if (ev.type === 'agent-status') {
      if (ev.status === 'working') setLive(ev.agentId, { activity: ev.activity, said: ev.said, started: ev.started, phase: ev.phase });
      else setLive(ev.agentId, null);
    }
    if (ev.type === 'activity') { pushLog(ev.entry); onAgentWrite(ev.entry); }
    if (ev.type === 'agent-status' && ev.status !== 'working' && $('viewer').open && pv.chatId === currentId && $('pvLive').checked) reloadPv(); // fin de turno
  };
}

// ---------- Inicio ----------

async function setupRequest(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function showSetup() {
  if (!$('setupDialog').open) $('setupDialog').showModal();
  $('setupStatus').textContent = t('setup.checking');
  try {
    // La instalación pertenece al edificio, aunque estés viendo una oficina con empleados.
    const info = await setupRequest('/api/agents?oficina=edificio');
    $('setupAgents').innerHTML = info.agents.filter(a => !a.bot).map(a => {
      const help = primerosPasosCatalog[a.id];
      return `<section class="setup-agent"><h3>${esc(a.name)} · ${t(a.installed ? 'setup.found' : 'setup.notInstalled')}${a.enabled === false ? ` · ${t('setup.disabled')}` : ''}</h3>
        ${help ? `<p>Windows: <code>${esc(help.windows)}</code></p><p>macOS / Linux: <code>${esc(help.unix)}</code></p><p>${t('setup.login')}: <code>${esc(help.login)}</code></p><p>${help.noteKey ? esc(t(help.noteKey)) : ''}</p>` : `<p>${esc(t('setup.unknownCli'))}</p>`}
        <button type="button" class="btn ghost small" data-setup-test="${esc(a.id)}" ${!a.installed || a.enabled === false ? 'disabled' : ''}>${t('setup.test')}</button></section>`;
    }).join('');
    $('setupStatus').textContent = t('setup.status');
    try { localStorage.setItem('om-setup-seen-v1', '1'); } catch {}
  } catch (err) { $('setupStatus').textContent = err.message; }
}
$('setupBtn').onclick = showSetup;
$('setupRefresh').onclick = showSetup;
$('setupAgents').onclick = async e => {
  const btn = e.target.closest('[data-setup-test]');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  try {
    const chat = await setupRequest('/api/chats?oficina=edificio', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: t('setup.testPrompt'), config: { mode: 'rondas', workflow: 'relevo', maxRounds: 1, team: [{ id: btn.dataset.setupTest }] } }),
    });
    $('setupDialog').close();
    await openChat(chat.id);
    toast(t('setup.testStarted'));
  } catch (err) { $('setupStatus').textContent = err.message; }
  finally { btn.disabled = false; }
};

// Un fallo de la interfaz no debe pasar desapercibido: se muestra como aviso.
window.addEventListener('error', e => toast(t('ui.errUi', { msg: e.message }), true));
window.addEventListener('unhandledrejection', e => toast(t('ui.errUi', { msg: e.reason?.message || e.reason }), true));

// Cambio de idioma sin recargar: el HTML lo traduce I18N.apply (public/i18n.js); aquí se repinta lo que pinta el código.
window.addEventListener('om-lang', () => {
  renderNotifyBtn();
  renderThemeBtn();
  Nave.relabel();
  $('linkState').textContent = t($('linkState').classList.contains('down') ? 'ui.link.off' : 'ui.link.on');
  if ($('simWizard').open) $('wzStepName').textContent = t(`ui.wz.stepName${wz.step}`);
  if ($('setupDialog').open) showSetup();
  renderAll();
  renderChats();
  renderOffices();
  renderWorkflows();
  renderTemplates();
  if (!currentId) loadHoy(); // el tablero «Hoy» lo escribe el servidor: se pide otra vez en el idioma nuevo
  loadMemory(); // la lista del cerebro y los entrantes también se pintan desde el código
  if (typeof loadEditorial === 'function') loadEditorial();
});

(async () => {
  await I18N.ready; // el diccionario del idioma elegido (EN por defecto) antes de pintar nada
  setInterval(tick, 1000);
  tick();
  Nave.init();
  renderThemeBtn();
  const params = new URLSearchParams(location.hash.slice(1)); // #s=<oficina>&m=<id>&tab=debate&side=brain
  if (params.get('s')) oficina = params.get('s'); // (si no existe, loadOffices vuelve al edificio)
  await loadOffices();
  await loadAgents();
  await loadTemplates();
  renderNotifyBtn();
  renderLogChips();
  const wanted = params.get('m') || '';
  if (params.get('tab')) document.querySelector(`#mainTabs [data-tab="${CSS.escape(params.get('tab'))}"]`)?.click();
  if (params.get('side')) document.querySelector(`#sideTabs [data-side="${CSS.escape(params.get('side'))}"]`)?.click();
  newChat();
  await Promise.all([loadChats(), loadMemory()]);
  connect();
  // Abre la misión del enlace (#m=<id>, de esta oficina o de otra: openChat cambia de oficina) o la que esté en curso.
  const target = chats.find(c => c.id === wanted) || (wanted ? { id: wanted } : null) || chats.find(c => c.running);
  if (target) openChat(target.id).catch(err => toast(err.message, true));
  let seen = false;
  try { seen = localStorage.getItem('om-setup-seen-v1') === '1'; } catch {}
  if (!seen) await showSetup();
})();
