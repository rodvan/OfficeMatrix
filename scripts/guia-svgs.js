// Genera los diagramas animados de la guía visual (docs/VISUAL-GUIDE.md y docs/es/VISUAL-GUIDE.md) en inglés y en español.
// SVG con animación SMIL y sin scripts ni fuentes externas: GitHub los muestra animados dentro de <img>.
// Uso: node scripts/guia-svgs.js  →  docs/img/guia/<nombre>-en.svg y <nombre>-es.svg
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'docs', 'img', 'guia');
const FONT = 'Segoe UI, Helvetica, Arial, sans-serif';
const C = { bg: '#12141c', card: '#1a1d29', line: '#3a3f52', soft: '#2a2e3c', text: '#eeeaf8', dim: '#a9a4b8', accent: '#7c5cff', ok: '#3dba7a', warn: '#e0a84f', discord: '#5865f2' };
const AGENTS = [
  { id: 'claude', name: 'Claude', color: '#d0704f' },
  { id: 'grok', name: 'Grok', color: '#c062d6' },
  { id: 'gemini', name: 'Gemini', color: '#4f8df5' },
  { id: 'codex', name: 'Codex', color: '#10a37f' },
  { id: 'kimi', name: 'Kimi', color: '#3b6cff' },
];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const svg = (w, h, title, desc, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d">
  <title id="t">${esc(title)}</title>
  <desc id="d">${esc(desc)}</desc>
  <rect width="${w}" height="${h}" rx="18" fill="${C.bg}"/>
  <g font-family="${FONT}">
${body}
  </g>
</svg>
`;
const text = (x, y, s, { size = 13, fill = C.text, weight = 400, anchor = 'start', spacing = 0 } = {}) =>
  `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}"${spacing ? ` letter-spacing="${spacing}em"` : ''}>${esc(s)}</text>`;
const lines = (x, y, arr, opts = {}, gap = 17) => arr.map((s, i) => text(x, y + i * gap, s, opts)).join('');
const kicker = (s, x = 28, y = 34) => text(x, y, s.toUpperCase(), { size: 12, fill: '#c8c4d4', spacing: 0.08 });
// Aparece una vez y se queda (fill="freeze"), con retraso; se repite cada `ciclo` segundos para que el GIF mental no muera.
const fadeIn = (delay, dur = 0.6) => `<animate attributeName="opacity" from="0" to="1" begin="${delay}s" dur="${dur}s" fill="freeze"/>`;
const dot = (pathId, color, dur, begin = 0, r = 5) =>
  `<circle r="${r}" fill="${color}"><animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite" rotate="auto"><mpath href="#${pathId}"/></animateMotion></circle>`;
const dash = (d, color = C.line, id = '') =>
  `<path${id ? ` id="${id}"` : ''} d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="7 9"><animate attributeName="stroke-dashoffset" from="0" to="-32" dur="1.4s" repeatCount="indefinite"/></path>`;
const avatar = (cx, cy, a, r = 17) =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${a.color}22" stroke="${a.color}" stroke-width="2"/>${text(cx, cy + 5, a.name.slice(0, 2), { size: 12.5, weight: 700, fill: a.color, anchor: 'middle' })}`;

const L = {
  en: {
    flow: {
      title: 'How a Discord message reaches your AIs', desc: 'You write on your phone, the office bot receives it, your PC runs the AI read-only and the answer goes back to the channel.',
      kicker: 'From your phone to your office and back',
      phone: ['@Ship sweep', 'Artemis III news'], reply: ['⚖️ Judge: 3 facts', 'agree, 1 is false'],
      bot: ['Office bot', 'connects out to', 'Discord'], office: 'Your PC · office', ro: 'read-only', back: 'answer + images',
      foot: 'No open ports and no tunnel: the bot dials out. Only the Discord IDs you authorize are obeyed.',
    },
    scope: {
      title: 'What OfficeMatrix can do', desc: 'Six areas: offices, missions, the judge, editorial with ViralHunt, Discord and external agents.',
      kicker: 'Everything in one repository',
      cards: [
        ['🏢', 'Offices', ['Separate teams, memory', 'and keys per project']],
        ['🔁', 'Missions', ['Relay, Delphi or Council:', 'AIs build and review']],
        ['⚖️', 'The judge', ['One AI gives the final', 'verdict and closes it']],
        ['📰', 'Editorial', ['Viral topics to drafts,', 'sent to ViralHunt']],
        ['💬', 'Discord', ['Talk to every AI from', 'your phone, get alerts']],
        ['🔎', 'Research sweep', ['AIs research apart, a', 'judge spots misinformation']],
      ],
    },
    steps: {
      title: 'Connect an office to Discord in six steps', desc: 'Create the application, copy the token, paste it in the office settings, invite the bot, authorize your ID and send a test.',
      kicker: 'Connect Discord · about 5 minutes',
      items: [
        ['Create the app', 'discord.com/developers'], ['Copy the token', 'Bot → Reset Token'], ['Paste it', 'office ⚙ → Discord'],
        ['Invite the bot', 'button in ⚙'], ['Authorize you', 'mention it, copy ID'], ['Send a test', '🟢 Connected'],
      ],
    },
    team: {
      title: 'Your AI team in Discord', desc: 'What each AI is good at, whether it searches the web and whether it makes images.',
      kicker: 'Who does what · write @name',
      web: 'web', img: 'images', noImg: 'no images', ifOn: 'if enabled',
      best: { claude: ['Writes, summarizes,', 'default judge'], grok: ['Trends right now,', 'X, images'], gemini: ['Google research,', 'images'], codex: ['Checks data and', 'reasoning, images'], kimi: ['A second,', 'independent search'] },
    },
    sweep: {
      title: 'Research sweep', desc: 'The topic goes to every researcher at the same time; each works alone; the judge compares the reports and returns five parts.',
      kicker: 'sweep <topic> · they research apart, a judge compares',
      topic: 'Topic', judge: 'Judge', alone: 'each one alone, at the same time',
      out: ['Summary', 'They agree', 'False or contradictory', 'Blind spots', 'Post ideas'],
    },
  },
  es: {
    flow: {
      title: 'Cómo llega un mensaje de Discord a tus IAs', desc: 'Escribes en el teléfono, el bot de la oficina lo recibe, tu PC corre la IA en solo lectura y la respuesta vuelve al canal.',
      kicker: 'De tu teléfono a tu oficina y de vuelta',
      phone: ['@Nave barrida', 'novedades Artemis III'], reply: ['⚖️ Juez: 3 datos', 'coinciden, 1 es falso'],
      bot: ['Bot de la oficina', 'sale hacia', 'Discord'], office: 'Tu PC · oficina', ro: 'solo lectura', back: 'respuesta + imágenes',
      foot: 'Sin puertos abiertos ni túnel: el bot llama hacia fuera. Solo obedece a los IDs de Discord que autorices.',
    },
    scope: {
      title: 'Lo que puede hacer OfficeMatrix', desc: 'Seis áreas: oficinas, misiones, el juez, editorial con ViralHunt, Discord y la barrida de investigación.',
      kicker: 'Todo en un solo repositorio',
      cards: [
        ['🏢', 'Oficinas', ['Equipos, memoria y llaves', 'separados por proyecto']],
        ['🔁', 'Misiones', ['Relevo, Delphi o Consejo:', 'las IAs hacen y revisan']],
        ['⚖️', 'El juez', ['Una IA da el veredicto', 'final y la cierra']],
        ['📰', 'Editorial', ['Temas virales a borradores', 'que van a ViralHunt']],
        ['💬', 'Discord', ['Habla con cada IA desde', 'el teléfono, recibe avisos']],
        ['🔎', 'Barrida', ['Investigan por separado, un', 'juez detecta desinformación']],
      ],
    },
    steps: {
      title: 'Conecta una oficina a Discord en seis pasos', desc: 'Crea la aplicación, copia el token, pégalo en los ajustes de la oficina, invita al bot, autoriza tu ID y manda una prueba.',
      kicker: 'Conectar Discord · unos 5 minutos',
      items: [
        ['Crea la app', 'discord.com/developers'], ['Copia el token', 'Bot → Reset Token'], ['Pégalo', 'oficina ⚙ → Discord'],
        ['Invita al bot', 'botón en ⚙'], ['Autorízate', 'menciónalo, copia ID'], ['Manda prueba', '🟢 Conectado'],
      ],
    },
    team: {
      title: 'Tu equipo de IAs en Discord', desc: 'Para qué sirve cada IA, si busca en la web y si hace imágenes.',
      kicker: 'Quién hace qué · escribe @nombre',
      web: 'web', img: 'imágenes', noImg: 'sin imágenes', ifOn: 'si está activa',
      best: { claude: ['Redacta, resume,', 'juez por defecto'], grok: ['Tendencias del', 'momento, X, imágenes'], gemini: ['Investiga con', 'Google, imágenes'], codex: ['Revisa datos y', 'razonamientos'], kimi: ['Una segunda', 'búsqueda aparte'] },
    },
    sweep: {
      title: 'Barrida de investigación', desc: 'El tema llega a todos los investigadores a la vez; cada uno trabaja solo; el juez compara los informes y devuelve cinco partes.',
      kicker: 'barrida <tema> · investigan aparte, un juez compara',
      topic: 'Tema', judge: 'Juez', alone: 'cada uno solo, todos a la vez',
      out: ['Resumen', 'Coinciden', 'Lo falso y lo contradictorio', 'Puntos ciegos', 'Ideas para posts'],
    },
  },
};

function flow(l) {
  const t = l.flow;
  const W = 760, H = 300;
  let b = kicker(t.kicker);
  // Teléfono
  b += `<rect x="36" y="58" width="150" height="196" rx="22" fill="${C.card}" stroke="${C.line}" stroke-width="2"/>`;
  b += `<rect x="86" y="68" width="50" height="5" rx="2.5" fill="${C.line}"/>`;
  b += `<g><rect x="50" y="92" width="122" height="46" rx="12" fill="${C.discord}"/>${lines(60, 111, t.phone, { size: 11.5, fill: '#fff' }, 16)}</g>`;
  b += `<g opacity="0"><rect x="50" y="176" width="122" height="46" rx="12" fill="#2b2f3f" stroke="${C.ok}" stroke-width="1.5"/>${lines(60, 195, t.reply, { size: 11.5 }, 16)}<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.55;0.62;0.95;1" dur="6s" repeatCount="indefinite"/></g>`;
  // Bot
  b += `<circle cx="330" cy="150" r="46" fill="${C.discord}22" stroke="${C.discord}" stroke-width="2.5"><animate attributeName="r" values="46;50;46" dur="2.4s" repeatCount="indefinite"/></circle>`;
  b += text(330, 157, '🤖', { size: 26, anchor: 'middle' });
  b += lines(330, 222, t.bot, { size: 12, fill: C.dim, anchor: 'middle' }, 15);
  // Oficina
  b += `<rect x="470" y="70" width="256" height="170" rx="16" fill="${C.card}" stroke="${C.accent}" stroke-width="2"/>`;
  b += text(486, 96, t.office, { size: 13, weight: 600 });
  AGENTS.forEach((a, i) => { b += avatar(510 + i * 44, 140, a); });
  b += `<rect x="486" y="176" width="110" height="26" rx="13" fill="${C.ok}22" stroke="${C.ok}"/>${text(541, 193, '🔒 ' + t.ro, { size: 11.5, fill: '#c8f5dc', anchor: 'middle' })}`;
  // Caminos
  b += dash('M186 115 C 240 115 250 140 284 140', C.line, 'ida1');
  b += dash('M376 140 C 420 140 430 120 470 120', C.line, 'ida2');
  b += dash('M470 205 C 420 205 410 175 376 168', C.line, 'vuelta1');
  b += dash('M284 168 C 240 175 230 199 186 199', C.line, 'vuelta2');
  b += dot('ida1', C.discord, 3) + dot('ida2', C.discord, 3, 1.5) + dot('vuelta1', C.ok, 3, 0.75) + dot('vuelta2', C.ok, 3, 2.25);
  b += text(616, 226, t.back, { size: 11.5, fill: C.dim, anchor: 'middle' });
  b += text(W / 2, 282, t.foot, { size: 12, fill: C.dim, anchor: 'middle' });
  return svg(W, H, t.title, t.desc, b);
}

function scope(l) {
  const t = l.scope;
  const W = 760, H = 312;
  let b = kicker(t.kicker);
  const colors = [C.accent, '#4f8df5', C.warn, '#d0704f', C.discord, C.ok];
  t.cards.forEach(([icon, name, desc], i) => {
    const x = 28 + (i % 3) * 240, y = 54 + Math.floor(i / 3) * 124;
    b += `<g opacity="0">${fadeIn(0.25 * i)}
      <rect x="${x}" y="${y}" width="224" height="108" rx="14" fill="${C.card}" stroke="${colors[i]}" stroke-width="1.8"/>
      <rect x="${x}" y="${y}" width="6" height="108" rx="3" fill="${colors[i]}"/>
      ${text(x + 22, y + 36, icon, { size: 22 })}${text(x + 58, y + 34, name, { size: 15, weight: 700 })}
      ${lines(x + 22, y + 64, desc, { size: 12, fill: C.dim }, 17)}</g>`;
  });
  return svg(W, H, t.title, t.desc, b);
}

function steps(l) {
  const t = l.steps;
  const W = 760, H = 196, x0 = 70, gap = 124, y = 96;
  let b = kicker(t.kicker);
  b += `<path d="M${x0} ${y} H${x0 + gap * 5}" stroke="${C.soft}" stroke-width="4" stroke-linecap="round"/>`;
  b += `<path d="M${x0} ${y} H${x0 + gap * 5}" stroke="${C.discord}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${gap * 5}" stroke-dashoffset="${gap * 5}"><animate attributeName="stroke-dashoffset" values="${gap * 5};0;0" keyTimes="0;0.8;1" dur="6s" repeatCount="indefinite"/></path>`;
  t.items.forEach(([name, hint], i) => {
    const x = x0 + gap * i, last = i === t.items.length - 1;
    const on = (0.8 * 6 * i) / 5;
    b += `<circle cx="${x}" cy="${y}" r="20" fill="${C.card}" stroke="${last ? C.ok : C.discord}" stroke-width="2.5"><animate attributeName="fill" values="${C.card};${C.card};${last ? C.ok : C.discord}55;${last ? C.ok : C.discord}55" keyTimes="0;${(on / 6).toFixed(3)};${Math.min(1, on / 6 + 0.04).toFixed(3)};1" dur="6s" repeatCount="indefinite"/></circle>`;
    b += text(x, y + 5, String(i + 1), { size: 14, weight: 700, anchor: 'middle' });
    b += text(x, y + 46, name, { size: 13, weight: 600, anchor: 'middle' });
    b += text(x, y + 64, hint, { size: 11, fill: C.dim, anchor: 'middle' });
  });
  return svg(W, H, t.title, t.desc, b);
}

function team(l) {
  const t = l.team;
  const W = 760, H = 236;
  const caps = { claude: [true, false], grok: [true, true], gemini: [true, true], codex: ['ifOn', true], kimi: [true, false] };
  let b = kicker(t.kicker);
  AGENTS.forEach((a, i) => {
    const x = 28 + i * 144, y = 52;
    const [web, img] = caps[a.id];
    b += `<g opacity="0">${fadeIn(0.2 * i)}
      <rect x="${x}" y="${y}" width="132" height="164" rx="14" fill="${C.card}" stroke="${a.color}" stroke-width="1.8"/>
      ${avatar(x + 30, y + 32, a, 16)}${text(x + 54, y + 30, a.name, { size: 14, weight: 700 })}${text(x + 54, y + 46, '@' + (a.id === 'gemini' ? 'gemini' : a.id), { size: 11, fill: a.color })}
      ${text(x + 14, y + 80, `🌐 ${t.web}${web === 'ifOn' ? ` (${t.ifOn})` : ''}`, { size: 11, fill: web ? '#c8f5dc' : C.dim })}
      ${text(x + 14, y + 99, img ? `🖼️ ${t.img}` : `· ${t.noImg}`, { size: 11, fill: img ? '#c8f5dc' : C.dim })}
      <line x1="${x + 14}" y1="${y + 112}" x2="${x + 118}" y2="${y + 112}" stroke="${C.soft}"/>
      ${lines(x + 14, y + 131, t.best[a.id], { size: 11, fill: C.text }, 15)}</g>`;
  });
  return svg(W, H, t.title, t.desc, b);
}

function sweep(l) {
  const t = l.sweep;
  const W = 760, H = 322;
  const res = AGENTS.filter(a => a.id !== 'claude');
  let b = kicker(t.kicker);
  // Tema
  b += `<rect x="28" y="140" width="96" height="52" rx="14" fill="${C.card}" stroke="${C.accent}" stroke-width="2"/>${text(76, 171, '❓ ' + t.topic, { size: 13, weight: 600, anchor: 'middle' })}`;
  // Juez
  const jx = 470, jy = 166;
  b += `<circle cx="${jx}" cy="${jy}" r="36" fill="#d0704f22" stroke="#d0704f" stroke-width="2.5"/>${text(jx, jy + 7, '⚖️', { size: 22, anchor: 'middle' })}${text(jx, jy + 56, `${t.judge} · Claude`, { size: 12, fill: C.dim, anchor: 'middle' })}`;
  res.forEach((a, i) => {
    const y = 76 + i * 60, x = 272;
    b += dash(`M124 166 C 170 166 190 ${y} 248 ${y}`, C.soft, `a${i}`);
    b += dash(`M${x + 24} ${y} C 360 ${y} 390 ${jy} ${jx - 36} ${jy}`, C.soft, `b${i}`);
    b += avatar(x, y, a, 18);
    b += `<circle cx="${x + 26}" cy="${y - 14}" r="9" fill="${C.card}" stroke="${a.color}"/>${text(x + 26, y - 10, '🔎', { size: 9, anchor: 'middle' })}`;
    // Ida a la vez (mismo begin), vuelta cuando termina cada uno (begin distinto)
    b += dot(`a${i}`, C.accent, 1.2, 0, 4.5);
    b += dot(`b${i}`, a.color, 1.6, 0.3 * i, 4.5);
  });
  b += text(272, 306, t.alone, { size: 11.5, fill: C.dim, anchor: 'middle' });
  // Salida del juez
  b += dash(`M${jx + 36} ${jy} H 548`, C.soft, 'out');
  b += dot('out', '#d0704f', 1.2, 0, 4.5);
  const colors = [C.text, C.ok, C.warn, '#4f8df5', C.accent];
  t.out.forEach((s, i) => {
    const y = 92 + i * 34;
    b += `<g opacity="0">${fadeIn(0.5 + i * 0.35)}<rect x="552" y="${y - 20}" width="184" height="28" rx="9" fill="${C.card}" stroke="${colors[i]}" stroke-width="1.4"/>${text(564, y - 1, `${i + 1}. ${s}`, { size: 11.5, fill: colors[i] === C.text ? C.text : colors[i] })}</g>`;
  });
  return svg(W, H, t.title, t.desc, b);
}

fs.mkdirSync(OUT, { recursive: true });
const ALL = { 'discord-flujo': flow, alcances: scope, 'discord-pasos': steps, equipo: team, barrida: sweep };
for (const lang of ['en', 'es']) {
  for (const [name, fn] of Object.entries(ALL)) {
    const file = path.join(OUT, `${name}-${lang}.svg`);
    fs.writeFileSync(file, fn(L[lang]));
    console.log(path.relative(process.cwd(), file));
  }
}
