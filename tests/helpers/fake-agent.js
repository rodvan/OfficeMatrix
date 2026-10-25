// Agente falso para las pruebas de integración: se comporta como una CLI (lee .office/turno.md, toca archivos,
// imprime su reporte). Uso: node fake-agent.js <id> <guion> <formato> "<prompt>"
//   guion "autor":   turno 1 crea trabajo + objeción; después responde lo pendiente y aprueba.
//   guion "revisor": turno 1 resuelve las objeciones cambiando archivos y aun así dice APROBADO; después aprueba.
//   guion "falla":   sale con código 1 sin salida.
//   guion "tramposo": cambia un archivo y aun así dice APROBADO (el servidor debe corregirlo).
//   guion "sin-saldo": imprime el error 402 real de Grok y sale con 1.
//   guion "colgado": no imprime nada y no termina (lo corta el vigilante de inactividad).
//   formato "claude" imprime stream-json como Claude Code; "text" imprime texto plano.
const fs = require('fs');
const path = require('path');

const [id, script, format] = process.argv.slice(2);
// El retardo también llega como argumento "delay=<ms>": el entorno de un empleado de oficina va con lista blanca.
const argDelay = Number((process.argv.find(a => /^delay=\d+$/.test(a)) || '').slice(6)) || 0;
const counterFile = path.join('.office', `fake-${id}.count`);
const n = (fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) : 0) + 1;
fs.writeFileSync(counterFile, String(n));

if (script === 'falla') process.exit(1);
if (script === 'sin-saldo') {
  // Lo que imprimió Grok de verdad al quedarse sin créditos (22-oct-2026).
  process.stderr.write('Error: Internal error: {\n  "message": "API error (status 402 Payment Required): Grok Build usage balance exhausted",\n  "http_status": 402\n}\n');
  process.exit(1);
}
if (script === 'colgado') { setTimeout(() => {}, 120000); return; }
// guion "cortado": en su primer turno cambia un archivo de trabajo y se queda callado (lo corta el vigilante: PARCIAL).
if (script === 'cortado' && n === 1) { fs.appendFileSync('trabajo.txt', 'mitad de un cambio\n'); setTimeout(() => {}, 120000); return; }
// guion "saturado": la primera vez responde como Claude Code con los servidores saturados (529); después trabaja normal.
if (script === 'saturado' && n === 1) {
  process.stdout.write('{"type":"system","subtype":"init","tools":["Bash"],"description":"usage limit quota rate limit try again later"}\n');
  process.stdout.write('{"type":"assistant","message":{"content":[{"type":"text","text":"API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment."}]}}\n');
  process.exit(1);
}
// guion "cuota": con "--model modelo-agotado" responde como Antigravity sin cuota; con otro modelo trabaja normal.
if (script === 'cuota' && process.argv.includes('modelo-agotado')) {
  process.stderr.write('AGY_ERROR: RESOURCE_EXHAUSTED (code 429): You have exhausted your capacity on this model.\n');
  process.exit(1);
}

// El prompt dice qué archivo de turno leer: .office/turno.md (relevo) o .office/turno-<id>.md (modos paralelos).
const briefFile = (String(process.argv[5] || '').match(/\.office\/(turno[\w-]*\.md)/) || [])[1] || 'turno.md';
const brief = fs.readFileSync(path.join('.office', briefFile), 'utf8');
const isEn = /^# Turn in OfficeMatrix/m.test(brief) || /## Mission instructions|## Your turn/i.test(brief);

//   guion "paralelo": sigue la fase que indica el brief (Delphi y Consejo).
if (script === 'paralelo') {
  const [, fase, carpeta, objetivo] = brief.match(/officematrix: fase=(\w+) carpeta=(\S*) objetivo=(\S*)/) || [];
  let verdict = 'CAMBIOS', score = 8, extra = '';
  if (fase === 'borrador') {
    fs.writeFileSync(path.join(carpeta, 'propuesta.md'), `propuesta de ${id}
`);
    fs.writeFileSync(path.join(carpeta, 'LEEME.md'), `# Borrador
`);
  } else if (fase === 'revision') {
    const f = path.join(objetivo, 'propuesta.md');
    const text = fs.readFileSync(f, 'utf8');
    if (/revisado/.test(text)) { verdict = 'APROBADO'; score = 9; fs.appendFileSync(path.join(objetivo, 'LEEME.md'), `## Revisión de ${id}
sin cambios
`); }
    else fs.appendFileSync(f, `revisado por ${id}
`);
  } else if (fase === 'evaluacion') {
    const letters = [...brief.matchAll(/\*\*Borrador ([A-Z])\*\*/g)].map(m => m[1]);
    extra = `PUNTAJES:
${letters.map((l, i) => `- ${l}: ${9 - i}/10 porque sí`).join('\n')}
`;
  } else if (fase === 'sintesis') {
    fs.mkdirSync('final', { recursive: true });
    fs.writeFileSync(path.join('final', 'final.md'), `versión final de ${id}
`);
  } else if (fase === 'aprobacion') { verdict = 'APROBADO'; score = 9; }
  // En la demo (FAKE_DELAY_MS) el turno dura un poco, para ver varias estaciones trabajando a la vez.
  const wait = (Number(process.env.FAKE_DELAY_MS) || argDelay) * 3;
  if (wait) console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.resolve(objetivo || carpeta || '.', 'LEEME.md') } }] } }));
  setTimeout(() => console.log(isEn ? `Report from ${id} in ${fase} phase.

${extra}OBJECTIONS:
- none
SCORE: ${score}/10
VERDICT: ${verdict === 'APROBADO' ? 'APPROVED' : 'CHANGES'}` : `Reporte de ${id} en fase ${fase}.

${extra}OBJECIONES:
- ninguna
NOTA: ${score}/10
VEREDICTO: ${verdict}`), wait);
  return;
}
// guion "meseta": cada turno hace un retoque menor y pone 8/10 (la media no se mueve).
// guion "baja": igual, pero 9/10 en su primer turno y 7/10 después (retroceso).
// Los dos guardan en .office/ el aviso de turno cortado si su brief lo trae.
if (script === 'meseta' || script === 'baja') {
  const aviso = brief.match(/## ⚠ Turno cortado a medias[^\n]*\n[^#]*/);
  if (aviso) fs.writeFileSync(path.join('.office', `vio-parcial-${id}.txt`), aviso[0]);
  fs.appendFileSync('trabajo.txt', `retoque de ${id} ${n}\n`);
  const nota = script === 'baja' && n > 1 ? 7 : script === 'baja' ? 9 : 8;
  const hfm = fs.existsSync('HANDOFF.md') ? fs.readFileSync('HANDOFF.md', 'utf8') : '# HANDOFF\n';
  const j = hfm.search(/^## (?:Último traspaso|Latest handoff)/m);
  fs.writeFileSync('HANDOFF.md', (j === -1 ? hfm : hfm.slice(0, j)) +
    `## Último traspaso\n\n**De:** ${id}, turno ${n}\n\n**Qué hice:** un retoque.\n\n**Decisiones y por qué:** menor.\n\n**Objeciones abiertas:** ninguna.\n\n**Siguiente paso recomendado:** pulir.\n`);
  console.log(`Retoque de ${id}.\n\nOBJECIONES:\n- ninguna\nRESPUESTAS:\n- ninguna\nNOTA: ${nota}/10\nVEREDICTO: CAMBIOS\nTERMINADO: NO`);
  return;
}
// El brief llega en el idioma del pedido: entiende los dos.
const pending = [...brief.matchAll(/^- \*\*#(\d+)\*\* (?:de|by) [^\n]*\n(?:[^\n]*\n)*?\s+→ (Es TUYA|This is YOUR)?/gm)].map(m => ({ id: m[1], own: !!m[2] }));

const events = [];
const tool = (name, input) => events.push({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });

let objections = [isEn ? '- none' : '- ninguna'];
let verdict = 'APROBADO', score = 9;

if (script === 'autor' && n === 1) {
  tool('Write', { file_path: path.resolve('trabajo.txt') });
  fs.writeFileSync('trabajo.txt', isEn ? 'first draft\n' : 'primer borrador\n');
  objections = [isEn ? '- Missing API documentation because nobody will know how to use it' : '- Falta documentar la API porque nadie sabrá usarla'];
  verdict = 'CAMBIOS'; score = 7;
  const mem = path.join('memoria-oficina', 'lecciones.md');
  fs.appendFileSync(mem, isEn ? '\n- Author lesson: test before delivering.\n' : '\n- Lección del autor: probar antes de entregar.\n');
  if (process.env.FAKE_GLOBAL_MEMORY) fs.appendFileSync(process.env.FAKE_GLOBAL_MEMORY, isEn ? '\n- Lesson from another simultaneous cycle.\n' : '\n- Lección de otro ciclo simultáneo.\n');
}
if (script === 'revisor' && n === 1) {
  tool('Bash', { command: 'node --test' });
  tool('Edit', { file_path: path.resolve('trabajo.txt') });
  fs.appendFileSync('trabajo.txt', isEn ? 'API documented\n' : 'API documentada\n');
  verdict = 'APROBADO'; score = 9; // "aprueba" aunque cambió un archivo: el servidor debe bajarlo a CAMBIOS
}

if (script === 'tramposo') {
  fs.appendFileSync('trabajo.txt', 'retoque\n');
  verdict = 'APROBADO'; score = 10;
}

const changed = (script === 'autor' || script === 'revisor') && n === 1 || script === 'tramposo';
const replies = pending.map(p => `- #${p.id} ${p.own ? (isEn ? 'WITHDRAWN' : 'RETIRADA') : (isEn ? 'RESOLVED' : 'RESUELTA')}: ${isEn ? 'documented in API guide' : 'documentado en trabajo.txt'}`);

// HANDOFF: el agente reescribe "Último traspaso" y respeta el bloque de estado.
const hf = fs.existsSync('HANDOFF.md') ? fs.readFileSync('HANDOFF.md', 'utf8') : '# HANDOFF\n';
const i = hf.search(/^## (?:Último traspaso|Latest handoff)/m);
const handoffBody = isEn
  ? `## Latest handoff\n\n**From:** ${id}, turn ${n}\n\n**What I did:** things.\n\n**Decisions and why:** because.\n\n**Open objections:** none.\n\n**Recommended next step:** review.\n`
  : `## Último traspaso\n\n**De:** ${id}, turno ${n}\n\n**Qué hice:** cosas.\n\n**Decisiones y por qué:** porque sí.\n\n**Objeciones abiertas:** ninguna.\n\n**Siguiente paso recomendado:** revisar.\n`;
fs.writeFileSync('HANDOFF.md', (i === -1 ? hf : hf.slice(0, i)) + handoffBody);

const report = isEn
  ? `Report from ${id} (turn ${n}).\n\nOBJECTIONS:\n${objections.join('\n')}\nREPLIES:\n${replies.join('\n') || '- none'}\nSCORE: ${score}/10\nVERDICT: ${verdict === 'APROBADO' ? 'APPROVED' : 'CHANGES'}\nDONE: ${verdict === 'APROBADO' && !changed ? 'YES' : 'NO'}`
  : `Reporte de ${id} (turno ${n}).\n\nOBJECIONES:\n${objections.join('\n')}\nRESPUESTAS:\n${replies.join('\n') || '- ninguna'}\nNOTA: ${score}/10\nVEREDICTO: ${verdict}\nTERMINADO: ${verdict === 'APROBADO' && !changed ? 'SÍ' : 'NO'}`;

// FAKE_DELAY_MS (lo usa demo-server.js) espacia las líneas para ver la burbuja y el log en vivo.
const lines = format === 'claude'
  ? [{ type: 'system', subtype: 'init', cwd: process.cwd() }, { type: 'assistant', message: { content: [{ type: 'thinking' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.resolve('HANDOFF.md') } }] } },
    ...events, { type: 'assistant', message: { content: [{ type: 'text', text: report }] } },
    { type: 'result', subtype: 'success', is_error: false, result: report, total_cost_usd: 0.015, usage: { input_tokens: 400, cache_read_input_tokens: 800, output_tokens: 300 } }].map(e => JSON.stringify(e))
  : [report];
const delay = Number(process.env.FAKE_DELAY_MS) || argDelay;
(function next(i) {
  if (i >= lines.length) return;
  console.log(lines[i]);
  if (delay) setTimeout(() => next(i + 1), delay); else next(i + 1);
})(0);
