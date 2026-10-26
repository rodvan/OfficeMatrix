// Informe de cierre (lib/cierre.js, RF1–RF8): un caso por cada final, números contra un repositorio git de prueba,
// los botones con la petición exacta y, de punta a punta, el informe que deja el servidor sin ninguna CLI real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-cierre-'));
const fake = path.join(__dirname, 'helpers', 'fake-agent.js');
const agent = (id, name, script, stream) => ({ id, name, role: 'Probador', color: '#fff', cmd: 'node', stream, args: [fake, id, script, stream, '{prompt}'] });
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: [agent('autor', 'Autor', 'autor', 'claude'), agent('revisor', 'Revisor', 'revisor', 'text')],
  maxRounds: 3, minScore: 9, autoMaxRounds: 4, turnTimeoutMinutes: 1, idleTimeoutMinutes: 0.05,
}));
fs.mkdirSync(path.join(home, 'memoria'), { recursive: true });
fs.writeFileSync(path.join(home, 'memoria', 'lecciones.md'), '# Lecciones aprendidas\n\n- Lección base.\n');
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');
process.env.FAKE_GLOBAL_MEMORY = path.join(home, 'memoria', 'lecciones.md');

const cierre = require('../lib/cierre');

const git = (dir, ...args) => execFileSync('git', ['-c', 'user.name=Prueba', '-c', 'user.email=prueba@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

// ---------- Fixtures ----------
const CICLO = 1792800000000;
const ts = min => new Date(CICLO + min * 60000).toISOString();
const turno = (agentId, round, verdict, score, extra = {}) => ({
  kind: 'agent', agentId, agentName: agentId[0].toUpperCase() + agentId.slice(1), role: 'Rol', round, cycle: CICLO, seconds: 300,
  verdict, score, done: verdict === 'APROBADO' || extra.done === true, files: [], workFiles: [], ts: ts(round * 10), text: '', ...extra,
});
const chatCon = (turnos, fin, extra = {}) => ({
  id: 'mision-prueba', title: 'Misión de prueba', created: new Date(CICLO - 1000).toISOString(), config: { mode: 'auto', maxRounds: 3, minScore: 9, workflow: 'relevo' },
  messages: [
    { kind: 'user', text: 'Construye la función de exportar. Lee docs/BRIEF-PRUEBA.md', ts: ts(-1) },
    { kind: 'system', cycle: CICLO, outcome: 'started', text: 'Comienza el ciclo automático', ts: ts(0) },
    ...turnos,
    ...(fin ? [{ kind: 'system', cycle: CICLO, outcome: fin, text: `fin ${fin}`, ts: ts(40) }] : []),
  ],
  debate: [], ...extra,
});

function repoDePrueba() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cierre-git-'));
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'a.js'), 'uno\ndos\ntres\n');
  fs.writeFileSync(path.join(dir, 'b.md'), 'se borra\n');
  fs.writeFileSync(path.join(dir, 'interno.md'), 'sale de git\nsigue en disco\n');
  fs.writeFileSync(path.join(dir, 'tests', 'x.test.js'), "test('uno', () => {});\n");
  fs.writeFileSync(path.join(dir, '.gitignore'), '.office/\n');
  fs.writeFileSync(path.join(dir, 'docs', 'BRIEF-PRUEBA.md'), [
    '# Brief', '', '## Lo que pide el usuario', '- esto es contexto y no cuenta', '', '## Qué construir',
    '### 1. Exportar a CSV', '- Botón de exportar en la tabla', '  - con el nombre del archivo', '- Sincronización con Dropbox y OneDrive',
    '', '## Reglas', '- Cero dependencias nuevas', '',
  ].join('\n'));
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  const base = git(dir, 'rev-parse', 'HEAD').trim();
  // Trabajo de la misión, sin commit: como lo dejan los agentes.
  fs.writeFileSync(path.join(dir, 'a.js'), 'uno\nDOS\ntres\ncuatro\n'); // +2 −1
  fs.rmSync(path.join(dir, 'b.md')); // borrado de verdad
  git(dir, 'rm', '-q', '--cached', 'interno.md'); // sale de git, sigue en disco
  fs.writeFileSync(path.join(dir, 'c.js'), 'a\nb\nc\nd'); // 4 líneas sin salto final
  fs.writeFileSync(path.join(dir, 'tests', 'y.test.js'), "test('dos', () => {});\ntest(\"tres\", () => {});\n");
  fs.mkdirSync(path.join(dir, 'docs', 'evidencia'));
  fs.writeFileSync(path.join(dir, 'docs', 'evidencia', 'captura.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1]));
  fs.writeFileSync(path.join(dir, 'pruebas.txt'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('l1\nl2\nl3\n', 'utf16le')]));
  fs.writeFileSync(path.join(dir, 'viralhunt.secreto.json'), '{"token":"vh_abcdefghijklmnop"}');
  fs.mkdirSync(path.join(dir, '.office'));
  return { dir, base };
}

// ---------- Números: git contra el commit base ----------
test('los números salen de git contra el commit base: nuevos, modificados, borrados, sacados, líneas y pruebas', () => {
  const { dir, base } = repoDePrueba();
  const c = cierre.construirCierre({ chat: chatCon([turno('autor', 1, 'APROBADO', 9)], 'unanime', { base: { commit: base } }), dir });
  const n = c.numeros;
  assert.strictEqual(n.fuente, 'git');
  assert.strictEqual(n.base, base);
  assert.strictEqual(n.baseComo, 'start');
  const por = Object.fromEntries(n.archivos.map(f => [f.ruta, f]));
  assert.deepStrictEqual([por['a.js'].estado, por['a.js'].mas, por['a.js'].menos], ['modificado', 2, 1]);
  assert.strictEqual(por['b.md'].estado, 'borrado');
  assert.strictEqual(por['interno.md'].estado, 'sacado', 'borrado para git pero sigue en disco');
  assert.strictEqual(por['c.js'].mas, 4, 'la última línea sin salto también cuenta');
  assert.strictEqual(por['pruebas.txt'].mas, 3, 'UTF-16 con BOM es texto');
  assert.strictEqual(por['docs/evidencia/captura.png'].binario, true);
  assert.ok(!por['viralhunt.secreto.json'], 'un *.secreto.json nunca entra en el informe');
  assert.ok(!n.archivos.some(f => f.ruta.startsWith('.office/')));
  assert.strictEqual(n.nuevos, 4); // c.js, y.test.js, captura.png, pruebas.txt
  assert.strictEqual(n.modificados, 1);
  assert.strictEqual(n.borrados, 1);
  assert.strictEqual(n.sacados, 1);
  assert.strictEqual(n.lineasMas, 2 + 4 + 2 + 3);
  assert.strictEqual(n.lineasMenos, 1 + 1, 'a.js −1 y b.md −1; las de interno.md no se quitaron');
  assert.deepStrictEqual(n.pruebasDefinidas, { antes: 1, despues: 3 });
  assert.deepStrictEqual(c.ejecutado.capturas, ['docs/evidencia/captura.png']);
  assert.ok(c.riesgos.some(r => /1 archivo sigue en tu carpeta pero ya no viaja/.test(r.texto)));
  assert.ok(c.riesgos.some(r => /Se borra 1 archivo respecto a como estaba al empezar/.test(r.texto)));
});

test('sin chat.base, la base es el último commit antes de crear la misión; un repo padre no cuenta', () => {
  const { dir, base } = repoDePrueba();
  const c = cierre.construirCierre({ chat: chatCon([], 'unanime', { created: new Date(Date.now() + 60000).toISOString() }), dir });
  assert.strictEqual(c.numeros.base, base);
  assert.strictEqual(c.numeros.baseComo, 'before-created');
  // Una misión sin .git propio dentro de un repo (la app en vivo): no se cuentan los cambios de la app.
  const hija = path.join(dir, 'proyectos', 'mision');
  fs.mkdirSync(hija, { recursive: true });
  const t = turno('autor', 1, 'APROBADO', 9, { files: ['hola.py', '.office/turno.md'] });
  const h = cierre.construirCierre({ chat: chatCon([t], 'unanime'), dir: hija });
  assert.strictEqual(h.numeros.fuente, 'instantaneas');
  assert.deepStrictEqual(h.numeros.archivos.map(f => f.ruta), ['hola.py']);
  assert.strictEqual(h.numeros.lineasMas, null, 'sin git no se inventan líneas');
  assert.strictEqual(cierre.registrarBase(hija, {}), null);
});

// ---------- Un caso por cada final ----------
const sinGit = fs.mkdtempSync(path.join(os.tmpdir(), 'cierre-sin-git-'));

test('consenso: verde, «aprobado por todos», sin «Aceptar» y los opcionales como pendientes', () => {
  const traspaso = '**De:** Revisor\n\n**Qué hice:**\n- Exportar a CSV desde la tabla, en `a.js`.\n\n**Decisiones y por qué:**\n- `edit_log` sigue opcional y sin hacer.\n\n**Objeciones abiertas:** ninguna.\n\n**Siguiente paso recomendado:** Si nadie objeta, se cierra.';
  const chat = chatCon([
    turno('autor', 1, 'CAMBIOS', 9, { done: true, workFiles: ['a.js'], handoffText: traspaso, text: 'npm test: 12/12 en 3,1 s. Demo en el puerto 4400.' }),
    turno('revisor', 1, 'APROBADO', 10, { done: true }),
  ], 'consenso');
  const c = cierre.construirCierre({ chat, dir: sinGit });
  assert.strictEqual(c.causa, 'aprobado');
  assert.strictEqual(c.semaforo, 'verde');
  assert.strictEqual(c.veredicto.frase, 'Terminado y aprobado por todos');
  assert.strictEqual(c.autor, 'plantilla');
  assert.deepStrictEqual(c.logros.map(l => l.texto), ['Exportar a CSV desde la tabla, en `a.js`.']);
  assert.ok(c.pendientes.otraRonda.some(p => p.tipo === 'opcional' && /edit_log/.test(p.texto)));
  assert.ok(!c.pendientes.otraRonda.some(p => /se cierra/.test(p.texto)), 'el «siguiente paso» de cerrar ya pasó');
  assert.deepStrictEqual(c.ejecutado.pruebas.map(p => [p.de, p.pasan, p.total, p.segundos, p.declarado]), [['Autor', 12, 12, 3.1, true]]);
  assert.deepStrictEqual(c.ejecutado.puertos, [4400]);
  const aceptar = c.opciones.find(o => o.id === 'aceptar');
  assert.strictEqual(aceptar.disponible, false);
  assert.ok(!aceptar.ruta);
  assert.match(cierre.aMarkdown(c), /🟢 \*\*Terminado y aprobado por todos\*\*/);
});

test('meseta: ámbar, «Casi listo: 3 de 4 aprueban, falta …» y Aceptar manda POST /accept', () => {
  const ronda = (r, nCodex) => [turno('claude', r, 'APROBADO', 9.5), turno('codex', r, 'CAMBIOS', nCodex), turno('gemini', r, 'APROBADO', 9.5), turno('grok', r, 'APROBADO', 9.5)];
  const chat = chatCon([...ronda(1, 8.5), ...ronda(2, 8.5)], 'meseta', { debate: [{ id: 4, text: 'La prueba S1F falla en mi equipo', status: 'abierta', by: 'codex', agentName: 'Codex' }] });
  const c = cierre.construirCierre({ chat, dir: sinGit });
  assert.strictEqual(c.causa, 'meseta');
  assert.strictEqual(c.semaforo, 'ambar');
  assert.match(c.veredicto.frase, /^Casi listo: 3 de 4 aprueban, falta Codex \(nota 8,5\)\. Se paró: la nota no mejoraba\. · 1 objeción/);
  assert.deepStrictEqual(c.numeros.porRonda.map(r => r.media), [9.25, 9.25]);
  assert.deepStrictEqual(c.noLogrado.objeciones.map(o => o.id), [4]);
  assert.ok(c.pendientes.otraRonda.some(p => /^#4 /.test(p.texto)));
  assert.ok(c.riesgos.some(r => /Codex terminó con 8,5\/10/.test(r.texto)));
  const aceptar = c.opciones.find(o => o.id === 'aceptar');
  assert.deepStrictEqual([aceptar.metodo, aceptar.ruta], ['POST', '/api/chats/mision-prueba/accept']);
  const seguir = c.opciones.find(o => o.id === 'seguir');
  assert.deepStrictEqual([seguir.metodo, seguir.ruta, seguir.cuerpo.config], ['POST', '/api/chats/mision-prueba/messages', { mode: 'auto', maxRounds: 2 }]);
  assert.match(seguir.cuerpo.text, /#4 La prueba S1F falla/);
  assert.strictEqual(seguir.editable, 'text');
  assert.match(seguir.coste, /^hasta 8 turnos/);
});

test('tope de rondas: ámbar y «se acabaron las rondas»', () => {
  const c = cierre.construirCierre({ chat: chatCon([turno('autor', 1, 'CAMBIOS', 7), turno('revisor', 1, 'CAMBIOS', 8)], 'agotado'), dir: sinGit });
  assert.strictEqual(c.causa, 'agotado');
  assert.strictEqual(c.semaforo, 'ambar');
  assert.strictEqual(c.veredicto.frase, 'Se acabaron las rondas sin cierre');
  assert.ok(c.opciones.find(o => o.id === 'aceptar').ruta.endsWith('/accept'));
});

test('caída de un agente: el que cayó sale del ciclo; el cortado a medias siguió (no «fuera del ciclo»)', () => {
  const chat = chatCon([
    turno('autor', 1, 'ERROR', null, { failure: { label: 'SIN SALDO', detail: 'Error 402 con om_abcdefghijklmnop' } }),
    turno('gemini', 1, 'PARCIAL', null, { failure: { label: 'COLGADA', detail: 'Sin salida 10 min' } }),
    turno('revisor', 1, 'APROBADO', 9),
    turno('gemini', 2, 'APROBADO', 10),
    turno('revisor', 2, 'APROBADO', 9),
  ], 'unanime');
  const c = cierre.construirCierre({ chat, dir: sinGit });
  const caidas = Object.fromEntries(c.noLogrado.caidas.map(x => [x.agente, x]));
  assert.deepStrictEqual([caidas.Autor.tipo, caidas.Autor.siguio], ['cayo', false]);
  assert.deepStrictEqual([caidas.Gemini.tipo, caidas.Gemini.siguio], ['cortado', true]);
  assert.ok(c.pendientes.tu.some(p => p.tipo === 'caida' && /Autor cayó \(sin saldo\)/.test(p.texto)));
  const md = cierre.aMarkdown(c);
  assert.match(md, /Gemini, ronda 1: lo cortaron a medias \(colgada\) y siguió en el ciclo/);
  assert.match(md, /Autor, ronda 1: cayó \(sin saldo\) y salió del ciclo/);
  assert.ok(!/om_abcdefghijklmnop/.test(md) && !/om_abcdefghijklmnop/.test(JSON.stringify(c)), 'una llave om_ nunca sale en el informe');
  assert.strictEqual(c.numeros.porRonda[0].media, null, 'una ronda con cortes no tiene media (D59)');
});

test('interrupción: un ciclo sin mensaje de fin se informa como cortado y ofrece Reanudar', () => {
  const c = cierre.construirCierre({ chat: chatCon([turno('autor', 1, 'CAMBIOS', 8)], null), dir: sinGit });
  assert.strictEqual(c.causa, 'interrumpido');
  assert.strictEqual(c.semaforo, 'ambar');
  const reanudar = c.opciones.find(o => o.id === 'reanudar');
  assert.deepStrictEqual([reanudar.metodo, reanudar.ruta, reanudar.cuerpo], ['POST', '/api/chats/mision-prueba/messages', { resume: true }]);
  assert.ok(!c.opciones.some(o => o.id === 'seguir'));
  assert.ok(c.riesgos.some(r => /a medias/.test(r.texto)));
});

test('error del orquestador y retroceso: rojo; aceptado por el usuario: ámbar y lo dice', () => {
  assert.strictEqual(cierre.construirCierre({ chat: chatCon([], 'error'), dir: sinGit }).semaforo, 'rojo');
  assert.strictEqual(cierre.construirCierre({ chat: chatCon([], 'retroceso'), dir: sinGit }).semaforo, 'rojo');
  const chat = chatCon([turno('autor', 1, 'CAMBIOS', 8)], 'meseta');
  chat.messages.push({ kind: 'system', outcome: 'aceptado', userAccepted: true, text: 'El usuario aceptó…' });
  const c = cierre.construirCierre({ chat, dir: sinGit });
  assert.deepStrictEqual([c.causa, c.semaforo, c.veredicto.frase], ['aceptado', 'ambar', 'Aceptado por ti, sin aprobación del equipo']);
});

test('el último ciclo manda: un ciclo previo interrumpido solo se cuenta; las directivas no son el pedido', () => {
  const chat = chatCon([turno('autor', 1, 'APROBADO', 9)], 'unanime');
  chat.messages.unshift({ kind: 'system', cycle: 1, outcome: 'started', text: 'Comienza el ciclo' }, { kind: 'agent', cycle: 1, agentId: 'viejo', round: 1, verdict: 'CAMBIOS' });
  chat.messages.splice(chat.messages.findIndex(m => m.outcome === 'started' && m.cycle === CICLO), 0, { kind: 'user', intervention: true, text: 'una directiva suelta' });
  const c = cierre.construirCierre({ chat, dir: sinGit });
  assert.strictEqual(c.mision.ciclosPrevios, 1);
  assert.deepStrictEqual(c.numeros.agentes.map(a => a.id), ['autor']);
});

// ---------- El brief, punto por punto ----------
test('el brief: solo lo que se pide, con ✖ para lo que nadie menciona; el relator no puede dar ✔ sin evidencia', () => {
  const { dir } = repoDePrueba();
  const t = turno('autor', 1, 'APROBADO', 9, { text: 'Hice el botón de exportar a CSV en la tabla.' });
  const c = cierre.construirCierre({ chat: chatCon([t], 'unanime'), dir });
  assert.strictEqual(c.brief.ruta, 'docs/BRIEF-PRUEBA.md');
  assert.deepStrictEqual(c.brief.puntos.map(p => [p.texto, p.estado]), [
    ['1. Exportar a CSV', 'sin-confirmar'],
    ['Botón de exportar en la tabla', 'sin-confirmar'],
    ['Sincronización con Dropbox y OneDrive', 'falta'],
  ], 'ni el contexto ni las reglas son puntos; la sub-viñeta va con su punto');
  assert.ok(c.pendientes.otraRonda.some(p => p.tipo === 'brief' && /Dropbox/.test(p.texto)));

  const r = cierre.fusionarRelato(c, {
    frase: 'Exportar a CSV listo; falta Dropbox',
    logros: [{ texto: 'Ya puedes bajar la tabla como CSV', evidencia: ['a.js', 'no-existe.js', '../fuera.txt'] }],
    brief: [{ n: 1, estado: 'hecho', evidencia: ['a.js'] }, { n: 2, estado: 'hecho', evidencia: ['no-existe.js'] }],
    riesgos: [`token sk-${'abcdefghijklmnopqrst'} filtrado`], // armado por partes: el escáner de publicación no lo toma por una clave
  }, { dir, autor: 'Claude' });
  assert.strictEqual(r.autor, 'plantilla+relator');
  assert.deepStrictEqual(r.logros[0].evidencia, ['a.js'], 'solo evidencia que existe dentro de la misión');
  assert.deepStrictEqual(r.brief.puntos.map(p => p.estado), ['hecho', 'parcial', 'falta'], 'un ✔ sin evidencia baja a ◐');
  assert.deepStrictEqual(r.numeros, c.numeros, 'el relator no toca los números');
  assert.ok(r.riesgos.some(x => x.texto === 'token [oculto] filtrado'));
  assert.match(cierre.aMarkdown(r), /\*\*Exportar a CSV listo; falta Dropbox\*\*/);
});

test('relator: quién relata, qué se le pide, cómo se lee su JSON y que sobrevive a cada regeneración', () => {
  const { dir } = repoDePrueba();
  const equipo = [{ id: 'autor', name: 'Autor' }, { id: 'revisor', name: 'Revisor' }, { id: 'bot', name: 'Bot', bot: {} }];
  const chat = chatCon([turno('autor', 1, 'CAMBIOS', 8), turno('revisor', 1, 'APROBADO', 9), turno('bot', 1, 'APROBADO', 10)], 'meseta');
  const c = cierre.construirCierre({ chat, dir });
  assert.strictEqual(cierre.elegirRelator(c, equipo).id, 'revisor', 'mejor nota; el bot por webhook no lee el disco');
  assert.strictEqual(cierre.elegirRelator(c, equipo, { presidente: 'autor' }).id, 'autor', 'en Consejo, el presidente');
  assert.strictEqual(cierre.elegirRelator(c, equipo.filter(a => a.id !== 'revisor')).id, 'autor', 'solo quien sigue en el equipo');
  assert.strictEqual(cierre.elegirRelator({ ...c, causa: 'detenido' }, equipo), null, 'si lo detuvo el usuario, no se gasta otro turno');
  assert.strictEqual(cierre.elegirRelator({ ...c, modoDetalle: { modo: 'editorial' } }, equipo), null, 'en la Editorial no hay relator');
  assert.strictEqual(cierre.elegirRelator({ ...c, autor: 'plantilla+relator' }, equipo), null, 'una sola vez por informe');

  const brief = cierre.briefRelator(c);
  assert.match(brief, /NO cambies, crees ni borres ningún archivo/);
  assert.match(brief, /"n": 3/, 'le pasa los puntos del brief con su número');
  assert.doesNotMatch(brief, /lineasMas|tokens/, 'los números no se le piden');

  assert.deepStrictEqual(cierre.leerRelato('Listo.\n```json\n{"frase":"Hecho"}\n```\nOBJECIONES: ninguna'), { frase: 'Hecho' });
  assert.deepStrictEqual(cierre.leerRelato('{"logros":[{"texto":"x"}]}'), { logros: [{ texto: 'x' }] });
  assert.strictEqual(cierre.leerRelato('Hecho, todo bien.'), null);
  assert.strictEqual(cierre.leerRelato('```json\n{"otra":"cosa"}\n```'), null, 'un JSON sin campos del relato no vale');

  const relato = { frase: 'Casi: falta Dropbox', brief: [{ n: 1, estado: 'hecho', evidencia: ['a.js'] }] };
  const conR = { ...chat, relato: { ciclo: CICLO, autor: 'Revisor', datos: relato } };
  const r = cierre.conRelato(cierre.construirCierre({ chat: conR, dir }), conR, dir);
  assert.deepStrictEqual([r.autor, r.relato.frase, r.brief.puntos[0].estado], ['plantilla+relator', 'Casi: falta Dropbox', 'hecho']);
  const otro = { ...conR, relato: { ...conR.relato, ciclo: CICLO - 1 } };
  assert.strictEqual(cierre.conRelato(cierre.construirCierre({ chat: otro, dir }), otro, dir).autor, 'plantilla', 'un relato de otro ciclo no se aplica');
  const aceptado = { ...conR, messages: [...conR.messages, { kind: 'system', cycle: CICLO, outcome: 'aceptado', text: 'aceptado', ts: ts(50) }] };
  const ra = cierre.conRelato(cierre.construirCierre({ chat: aceptado, dir }), aceptado, dir);
  assert.strictEqual(ra.causa, 'aceptado');
  assert.strictEqual(ra.relato.frase, null, 'tras «Aceptar así» manda la frase del servidor');
  assert.match(cierre.aMarkdown(ra), /\*\*Aceptado por ti/);
  const fallo = { ...chat, relato: { ciclo: CICLO, autor: 'Revisor', fallo: 'tocoArchivos' } };
  const rf = cierre.conRelato(cierre.construirCierre({ chat: fallo, dir }), fallo, dir);
  assert.strictEqual(rf.autor, 'plantilla');
  assert.strictEqual(rf.relatoFallo, 'Se queda el informe automático: Revisor cambió archivos del trabajo y su resumen se descartó.');
  assert.match(cierre.aMarkdown(rf), /Se queda el informe automático: Revisor/);
  assert.deepStrictEqual(Object.keys(cierre.textos.en.relatorMotivo), Object.keys(cierre.textos.es.relatorMotivo), 'los textos del relator, en es y en');
});

function mismasClaves(a, b, ruta = '') {
  if (Array.isArray(a) || Array.isArray(b)) {
    assert.ok(Array.isArray(a) && Array.isArray(b) && a.length === b.length, ruta);
    return;
  }
  if (a && typeof a === 'object') {
    assert.deepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort(), ruta || 'claves es/en');
    for (const k of Object.keys(a)) mismasClaves(a[k], b[k], `${ruta}.${k}`);
    return;
  }
  assert.strictEqual(typeof a, typeof b, ruta);
}

test('el diccionario del informe tiene las mismas claves en es y en', () => {
  mismasClaves(cierre.textos.es, cierre.textos.en);
});

test('el idioma del pedido elige las etiquetas, los botones y el texto que se exporta', () => {
  const chat = chatCon([turno('autor', 1, 'APROBADO', 9)], 'unanime');
  chat.messages[0].text = 'Please build the export button and make sure that the table works with the new data';
  const c = cierre.construirCierre({ chat, dir: sinGit });
  assert.strictEqual(c.idioma, 'en');
  assert.strictEqual(c.veredicto.frase, 'Done: everyone approved without changes');
  const seguir = c.opciones.find(o => o.id === 'seguir');
  assert.strictEqual(seguir.etiqueta, '▶ 1 more round');
  assert.match(seguir.coste, /^up to \d+ turn/);
  assert.match(seguir.explica, /You can edit the text/);
  const md = cierre.aMarkdown(c);
  assert.match(md, /^# Closing report/);
  assert.match(md, /What was achieved/);
  assert.doesNotMatch(md, /Qué se logró|objeción\(es\)|ronda\(s\)|archivo\(s\)/);

  const meseta = chatCon([turno('codex', 1, 'CAMBIOS', 8.5), turno('claude', 1, 'APROBADO', 9)], 'meseta', {
    debate: [{ id: 4, text: 'The table still overflows', status: 'abierta', by: 'codex', agentName: 'Codex' }],
  });
  meseta.messages[0].text = 'Please build the export and make sure that the table works with this layout';
  const m = cierre.construirCierre({ chat: meseta, dir: sinGit });
  assert.match(m.veredicto.frase, /Almost there: 1 of 2 approved, still missing Codex \(score 8\.5\)/);
  assert.match(m.veredicto.frase, /1 open objection/);
  assert.doesNotMatch(m.veredicto.frase, /nota |objeción|cayó|abierta\(s\)/);
  assert.strictEqual(m.opciones.find(o => o.id === 'seguir').etiqueta, '▶ Continue until done');
  const mdM = cierre.aMarkdown(m);
  assert.match(mdM, /Objection #4 \(open, from Codex\)/);
  assert.doesNotMatch(mdM, /\(abierta,|el servidor|Consumo \(tokens\)/);
  const aviso = cierre.mensajeRondaCierre({
    idioma: 'en', ronda: 2,
    objeciones: [{ id: 4, by: 'codex', agentName: 'Codex', text: 'The table still overflows' }],
    puntos: [{ estado: 'falta', texto: 'Save a copy' }],
  });
  assert.match(aviso, /Closing round started after a plateau \(round 2\)/);
  assert.match(aviso, /1\. Objection #4 \(Codex\): The table still overflows/);
  assert.match(aviso, /2\. Brief item \(missing\): Save a copy/);
  const avisoEs = cierre.mensajeRondaCierre({
    idioma: 'es', ronda: 2,
    objeciones: [{ id: 1, by: 'user', text: 'X' }],
    puntos: [],
  });
  assert.match(avisoEs, /^Ronda de cierre activada tras meseta \(ronda 2\): se continúa automáticamente/);
  assert.match(avisoEs, /1\. Objeción #1 \(user\): X/);
});

// ---------- De punta a punta: el servidor lo genera solo, sin ninguna CLI real ----------
const { server, running, relatores } = require('../server');
let base;
test.before(() => new Promise(resolve => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); })));
test.after(() => { server.close(); server.closeAllConnections?.(); });
const api = async (url, opts = {}) => {
  const res = await fetch(base + url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
};
const waitIdle = async id => {
  for (let i = 0; i < 300 && running.has(id); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(!running.has(id), 'el ciclo debería haber terminado');
  // El relator corre justo después, con el ciclo ya cerrado (RF2).
  for (let i = 0; i < 300 && relatores.has(id); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(!relatores.has(id), 'el relator debería haber terminado');
};

test('al terminar un ciclo el servidor deja cierre.json y CIERRE.md; la lista trae el semáforo; los botones funcionan', async () => {
  git(home, 'init', '-q'); // la casa de OfficeMatrix es un repo: la misión (sin .git propio) no debe contarlo
  const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Haz un trabajo de prueba', config: { mode: 'rondas', maxRounds: 3, team: [{ id: 'autor' }, { id: 'revisor' }] } }) });
  await waitIdle(chat.id);
  const dir = path.join(home, 'proyectos', chat.id);
  assert.ok(fs.existsSync(path.join(dir, '.office', 'cierre.json')));
  assert.ok(fs.existsSync(path.join(dir, '.office', 'CIERRE.md')));

  const { status, body: c } = await api(`/api/chats/${chat.id}/cierre`);
  assert.strictEqual(status, 200);
  // El relator (el de mejor nota: empate a 9 → el último que habló, Revisor) reescribe lo subjetivo; los números no.
  assert.deepStrictEqual([c.causa, c.semaforo, c.autor], ['aprobado', 'verde', 'plantilla+relator']);
  assert.strictEqual(c.relato.autor, 'Revisor');
  assert.strictEqual(c.relato.frase, 'Terminado: revisor lo cuenta en palabras llanas');
  assert.deepStrictEqual(c.logros, [{ texto: 'El trabajo de prueba quedó guardado', evidencia: ['trabajo.txt'], fuente: 'relator' }]);
  assert.strictEqual(c.numeros.fuente, 'instantaneas', 'sin repo propio: instantáneas, no el repo padre');
  assert.ok(c.numeros.archivos.some(f => f.ruta === 'trabajo.txt'));
  assert.strictEqual(c.numeros.turnos, 4, 'el turno del relator no cuenta como turno del ciclo');
  const { body: detalle } = await api(`/api/chats/${chat.id}`);
  assert.strictEqual(detalle.messages.filter(m => m.kind === 'system').pop().outcome, 'unanime', 'el relator no escribe en el chat: el resumen del ciclo sigue el último');
  assert.match(fs.readFileSync(path.join(dir, '.office', 'CIERRE.md'), 'utf8'), /Revisor lo reescribió en palabras llanas/);

  const md = await api(`/api/chats/${chat.id}/cierre?format=md`);
  assert.match(md.headers.get('content-disposition'), /-cierre\.md"/);
  assert.match(md.body, /^# Informe de cierre/);

  const { body: lista } = await api('/api/chats');
  assert.deepStrictEqual(lista.find(m => m.id === chat.id).cierre.semaforo, 'verde');

  // La misión pasa a ser un repo propio; el botón «Seguir» manda su petición tal cual y el ciclo nuevo cuenta contra HEAD.
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base de la misión');
  const head = git(dir, 'rev-parse', 'HEAD').trim();
  const seguir = c.opciones.find(o => o.id === 'seguir');
  const r = await api(seguir.ruta, { method: seguir.metodo, body: JSON.stringify(seguir.cuerpo) });
  assert.strictEqual(r.status, 202);
  await waitIdle(chat.id);
  const { body: c2 } = await api(`/api/chats/${chat.id}/cierre`);
  assert.strictEqual(c2.numeros.fuente, 'git');
  assert.strictEqual(c2.numeros.base, head);
  assert.strictEqual(c2.numeros.baseComo, 'start');
  assert.strictEqual(c2.mision.ciclosPrevios, 1);

  // «Generar informe de cierre» para una misión vieja sin informe: POST lo crea.
  fs.rmSync(path.join(dir, '.office', 'cierre.json'));
  assert.strictEqual((await api(`/api/chats/${chat.id}/cierre`)).status, 404);
  const gen = await api(`/api/chats/${chat.id}/cierre`, { method: 'POST' });
  assert.strictEqual(gen.status, 201);
  assert.strictEqual(gen.body.causa, c2.causa);
});

test('relator que toca archivos o no devuelve JSON: se queda la plantilla y el informe dice por qué', async () => {
  for (const [modo, motivo] of [['tocar', /cambió archivos del trabajo/], ['basura', /no devolvió el resumen/]]) {
    process.env.FAKE_RELATOR = modo;
    try {
      const { body: chat } = await api('/api/chats', { method: 'POST', body: JSON.stringify({ text: 'Haz un trabajo de prueba', config: { mode: 'rondas', maxRounds: 3, team: [{ id: 'autor' }, { id: 'revisor' }] } }) });
      await waitIdle(chat.id);
      const { body: c } = await api(`/api/chats/${chat.id}/cierre`);
      assert.strictEqual(c.autor, 'plantilla', modo);
      assert.match(c.relatoFallo, /^Se queda el informe automático: Revisor/, modo);
      assert.match(c.relatoFallo, motivo, modo);
    } finally { delete process.env.FAKE_RELATOR; }
  }
});
