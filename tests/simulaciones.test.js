// Simulaciones nivel «contexto» (S1 de docs/simulaciones/SIMULACIONES.md, §1.7 y §8.4) sobre las oficinas de siempre:
// empleados con modelo, herencia cero, traspaso explícito, argv y entorno limpios, reserva, instantánea y concurrencia.
// Con la CLI falsa de tests/helpers/cli-falsa.js: deja escrito lo que recibió, no gasta suscripción.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-sims-'));
const cli = path.join(__dirname, 'helpers', 'cli-falsa.js');
// Cuatro CLIs falsas con el "kind" de las reales: así reciben los flags de modelo y aislamiento de cada una.
const fakeAgent = (id, kind, guion, pre = []) => ({ id, name: id, role: 'CLI', color: '#999', cmd: 'node', kind, stream: 'text', args: [cli, ...pre, guion, '{prompt}'] });
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  agents: [
    fakeAgent('claude', 'claude', 'ok'), fakeAgent('codex', 'codex', 'ok', ['exec']), fakeAgent('gemini', 'agy', 'sin-saldo'), fakeAgent('grok', 'grok', 'ok'),
  ],
  maxRounds: 1, minScore: 9, turnTimeoutMinutes: 1, idleTimeoutMinutes: 0,
}));
const CANARIO_EDIFICIO = `CANARIO-edificio-${crypto.randomBytes(4).toString('hex')}`;
const CANARIO_B = `CANARIO-b-${crypto.randomBytes(4).toString('hex')}`;
fs.mkdirSync(path.join(home, 'memoria'), { recursive: true });
fs.writeFileSync(path.join(home, 'memoria', 'lecciones.md'), `# Lecciones\n\n### Secreto del edificio\n- ${CANARIO_EDIFICIO}: no debe llegar a ninguna oficina.\n`);
process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');
// P-ENTORNO: lo que el servidor tiene en su entorno y un empleado nunca debe recibir.
const SECRETS = { CLAUDE_CODE_SESSION_ID: 'sesion-padre', ANTHROPIC_API_KEY: 'sk-ant-x', OPENAI_API_KEY: 'sk-x', XAI_API_KEY: 'xai-x', OM_SECRET_X: 'om' };
Object.assign(process.env, SECRETS);

const { server, running } = require('../server');
let base;
test.before(() => new Promise(resolve => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); })));
test.after(() => { server.close(); server.closeAllConnections?.(); for (const k of Object.keys(SECRETS)) delete process.env[k]; fs.rmSync(home, { recursive: true, force: true }); });

const api = async (url, opts = {}, key) => {
  const headers = { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  const res = await fetch(base + url, { ...opts, headers });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const post = (url, body, key) => api(url, { method: 'POST', body: JSON.stringify(body) }, key);
const waitIdle = async id => {
  for (let i = 0; i < 400 && running.has(id); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(!running.has(id), 'el ciclo debería haber terminado');
};
const officeDir = id => path.join(home, 'oficinas', id);
const missionDir = (office, id) => path.join(officeDir(office), 'proyectos', id);
const vista = (office, id, who) => JSON.parse(fs.readFileSync(path.join(missionDir(office, id), '.office', `vista-${who}.json`), 'utf8'));
const hashDir = dir => {
  const h = crypto.createHash('sha256');
  const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else h.update(f.name).update(fs.readFileSync(p)); } };
  if (fs.existsSync(dir)) walk(dir);
  return h.digest('hex');
};

const emp = (id, nombre, puesto, modelo, reserva, extra = {}) => ({ id, nombre, puesto, modelo, reserva, modelo_rapido: null, degradable: false, objetivo: `Objetivo de ${nombre}`, estilo: 'Breve.', poderes: [], ...extra });
const REDACCION = {
  nombre: 'Redacción A', descripcion: 'Oficina de prueba',
  marca: { nombre: 'Marca A', idioma: 'es', publico: 'Curiosos', voz: 'Asombro con rigor', evitar: ['cifras sin fuente'] },
  empleados: [
    emp('irene', 'Irene Vidal', 'Directora editorial', { cli: 'claude', id: 'opus' }, { cli: 'codex', id: null }, { poderes: ['moderar', 'vetar'] }),
    emp('sara', 'Sara Quintero', 'SEO', { cli: 'claude', id: 'sonnet' }, { cli: 'codex', id: null }),
    emp('lucia', 'Lucía Andrade', 'Redactora', { cli: 'agy', id: 'gemini-4-argon-medium' }, { cli: 'claude', id: 'sonnet' }),
    emp('kenji', 'Kenji Morales', 'Verificador', { cli: 'codex', id: null }, { cli: 'claude', id: 'opus' }, { poderes: ['vetar'] }),
  ],
};

let A, missionA;

test('S1-VALIDAR: el ejemplo de Acme Ciencia pasa; los errores de la §8.4 que aplican a empleados se rechazan', async () => {
  const E = require('../lib/empleados');
  const agents = JSON.parse(fs.readFileSync(path.join(home, 'agents.json'), 'utf8')).agents;
  const ejemplo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'simulaciones', 'simulacion.ejemplo.json'), 'utf8'));
  const ok = E.validar(ejemplo, agents);
  assert.deepStrictEqual(ok.errores, [], 'el ejemplo del plan pasa sin errores');
  assert.ok(ok.avisos.some(a => /taller/.test(a)), 'el taller local (apagado, CLI que aún no existe) es solo un aviso');

  const one = (patch, extra = {}) => E.validar({ empleados: [{ ...emp('x', 'X', 'P', { cli: 'claude', id: 'opus' }, null), ...patch }], ...extra }, agents).errores.join(' | ');
  assert.match(one({ poderes: ['vetar'], degradable: true, modelo_rapido: { cli: 'claude', id: 'sonnet' } }), /veto.*degradable/);
  assert.match(one({ degradable: true, modelo_rapido: null }), /modelo_rapido/);
  assert.match(one({ degradable: false, modelo_rapido: { cli: 'claude', id: 'sonnet' } }), /null/);
  assert.match(one({ modelo: { cli: 'no-existe', id: 'x' } }), /does not exist/);
  assert.match(one({ tope_api_dia: 3 }), /unknown key/);
  assert.match(one({ poderes: ['publicar'] }), /poderes/);
  assert.match(one({ id: 'Con Espacios' }), /invalid id/);
  assert.match(one({ estilo: 'x'.repeat(700) }), /600/);
  assert.match(one({}, { marca: { nombre: 'M', token: 'x' } }), /marca: unknown key/);
  const dup = E.validar({ empleados: [emp('x', 'X', 'P', { cli: 'claude', id: 'opus' }), emp('x', 'Y', 'P', { cli: 'grok', id: 'grok-4.7' })] }, agents);
  assert.match(dup.errores.join(), /duplicate/);
  const twins = E.validar({ empleados: [emp('a', 'Ana', 'P', { cli: 'claude', id: 'opus' }), emp('b', 'Bea', 'P', { cli: 'claude', id: 'opus' })] }, agents);
  assert.deepStrictEqual(twins.errores, []);
  assert.match(twins.avisos.join(), /False diversity: Ana and Bea/);

  // Por la API: 400 con la lista de errores, y nada se crea.
  const bad = await post('/api/oficinas', { ...REDACCION, nombre: 'Mala', empleados: [{ ...REDACCION.empleados[0], degradable: true }] });
  assert.strictEqual(bad.status, 400);
  assert.ok(bad.body.errores.length);
  assert.ok(!fs.existsSync(officeDir('mala')));
});

test('S1-VALIDAR: listas de ficha mal tipadas devuelven 400 sin crear la oficina', async () => {
  for (const patch of [{ no_hace: 'publicar' }, { poderes: 'vetar' }, { poderes: { includes: true }, degradable: true }]) {
    const result = await post('/api/oficinas', { ...REDACCION, nombre: 'Ficha inválida', empleados: [{ ...REDACCION.empleados[0], ...patch }] });
    assert.strictEqual(result.status, 400);
    assert.ok(result.body.errores.some(e => /no_hace|poderes/.test(e)));
    assert.ok(!fs.existsSync(officeDir('ficha-invalida')));
  }
});

test('P-ARGV y P-FLAGS-PROHIBIDOS: cada CLI recibe su flag de modelo y de aislamiento; Codex sin -m si su id es null', () => {
  const E = require('../lib/empleados');
  const claude = { id: 'claude', cmd: 'claude', args: ['-p', '{prompt}', '--model', 'viejo'] };
  assert.deepStrictEqual(E.argsParaEmpleado(claude, { cli: 'claude', id: 'sonnet' }),
    ['-p', '{prompt}', '--model', 'sonnet', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence'], 'sin dos --model');
  const codex = { id: 'codex', cmd: 'codex', args: ['exec', '--json', '{prompt}'] };
  const cx = E.argsParaEmpleado(codex, { cli: 'codex', id: null });
  assert.deepStrictEqual(cx, ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--json', '{prompt}']);
  assert.ok(!cx.includes('-m'));
  assert.deepStrictEqual(E.argsParaEmpleado(codex, { cli: 'codex', id: 'gpt-x' }).slice(0, 3), ['exec', '-m', 'gpt-x']);
  assert.deepStrictEqual(E.argsParaEmpleado({ cmd: 'grok', args: ['-p', '{prompt}'] }, { id: 'grok-4.7' }), ['-p', '{prompt}', '-m', 'grok-4.7', '--no-subagents']);
  assert.deepStrictEqual(E.argsParaEmpleado({ cmd: 'agy.cmd', args: ['-p', '{prompt}'] }, { id: 'gemini-4-argon-low' }), ['-p', '{prompt}', '--model', 'gemini-4-argon-low', '--disable-slash-commands']);
  for (const bad of [['--continue'], ['-r', 'x'], ['resume'], ['--add-dir', '..'], ['-c']]) {
    assert.throws(() => E.argsParaEmpleado({ cmd: 'claude', args: ['-p', '{prompt}', ...bad] }, { id: 'opus' }), /FLAG_PROHIBIDO/, bad.join(' '));
  }
  assert.doesNotThrow(() => E.argsParaEmpleado({ cmd: 'codex', args: ['exec', '-c', 'x=1', '{prompt}'] }, { id: null }), 'en Codex -c es --config');
});

test('una oficina con empleados: misma CLI en dos empleados, ficha y marca arriba del brief, argv, entorno y herencia cero', async () => {
  const created = await post('/api/oficinas', REDACCION);
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  A = created.body;
  const { body: agentsA } = await api(`/api/agents?oficina=${A.id}`);
  assert.strictEqual(agentsA.empleados, true);
  assert.deepStrictEqual(agentsA.agents.map(a => `${a.name} · ${a.modeloLabel}`),
    ['Irene Vidal · claude opus', 'Sara Quintero · claude sonnet', 'Lucía Andrade · gemini gemini-4-argon-medium', 'Kenji Morales · codex']);
  assert.deepStrictEqual((await api('/api/agents')).body.agents.map(a => a.id), ['claude', 'codex', 'gemini', 'grok'], 'el edificio sigue con sus IAs');

  const { status, body } = await post(`/api/chats?oficina=${A.id}`, { text: 'Escribe el artículo del martes', config: { mode: 'rondas', maxRounds: 1 } });
  assert.strictEqual(status, 201);
  missionA = body;
  assert.deepStrictEqual(missionA.config.team.map(t => t.id), ['irene', 'sara', 'lucia', 'kenji']);
  await waitIdle(missionA.id);

  // Dos empleados con la misma CLI (Claude): cada uno su turno-<id>.md y su fila en Expedientes.
  const office = path.join(missionDir(A.id, missionA.id), '.office');
  for (const who of ['irene', 'sara', 'lucia', 'kenji']) assert.ok(fs.existsSync(path.join(office, `turno-${who}.md`)), `turno-${who}.md`);
  assert.ok(!fs.existsSync(path.join(office, 'turno.md')));
  const { body: detail } = await api(`/api/chats/${missionA.id}`);
  const turns = detail.messages.filter(m => m.kind === 'agent');
  assert.deepStrictEqual(turns.map(m => `${m.agentName}|${m.modelo}`), ['Irene Vidal|claude opus', 'Sara Quintero|claude sonnet', 'Lucía Andrade|claude sonnet', 'Kenji Morales|codex']);
  assert.ok(turns.every(m => m.score === 9), 'nota de cada uno');
  assert.deepStrictEqual(detail.stats.filter(s => s.turns).map(s => s.name), ['Irene Vidal', 'Sara Quintero', 'Lucía Andrade', 'Kenji Morales']);

  // Ficha y marca arriba, con texto fijo; ni rastro del cerebro del edificio (P-CANARIO-EDIFICIO).
  const irene = vista(A.id, missionA.id, 'irene');
  assert.match(irene.brief, /^# Turno en OfficeMatrix\n\n## Quién eres en esta oficina\nTrabajas en la oficina «Redacción A»/);
  assert.match(irene.brief, /Irene Vidal · Directora editorial\nObjetivo: Objetivo de Irene Vidal\nEstilo: Breve\.\nPoderes: moderar, vetar/);
  assert.match(irene.brief, /## La marca \(bloque fijo\)\nMarca: Marca A \(idioma: es\)/);
  for (const who of ['irene', 'sara', 'kenji']) assert.ok(!vista(A.id, missionA.id, who).brief.includes(CANARIO_EDIFICIO));

  // P-ARGV con las CLIs falsas: flags de modelo y aislamiento.
  assert.deepStrictEqual(irene.argv.slice(-5), ['--model', 'opus', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']);
  assert.ok(vista(A.id, missionA.id, 'sara').argv.includes('sonnet'));
  const kenji = vista(A.id, missionA.id, 'kenji').argv;
  assert.deepStrictEqual(kenji.slice(0, 4), ['exec', '--ephemeral', '--ignore-user-config', '--ignore-rules']);
  assert.ok(!kenji.includes('-m'));

  // P-ENTORNO: nada del entorno secreto del servidor; la memoria propia de las CLIs, apagada.
  for (const who of ['irene', 'sara', 'kenji']) {
    const env = vista(A.id, missionA.id, who).env;
    for (const k of Object.keys(SECRETS)) assert.ok(!(k in env), `${k} no llega a ${who}`);
    assert.ok(!Object.keys(env).some(k => /^CLAUDE_CODE_(?!DISABLE_AUTO_MEMORY)/.test(k) || /API_KEY|TOKEN|SECRET/.test(k)));
    assert.strictEqual(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
    assert.strictEqual(env.OFFICEMATRIX_OFICINA, A.id);
    assert.ok(env.PATH || env.Path, 'el PATH sí pasa');
  }

  // P-FUSION: lo aprendido queda en la memoria de A; el edificio, byte a byte igual.
  assert.match(fs.readFileSync(path.join(officeDir(A.id), 'memoria', 'lecciones.md'), 'utf8'), /Lección de Irene Vidal/);
  assert.doesNotMatch(fs.readFileSync(path.join(home, 'memoria', 'lecciones.md'), 'utf8'), /Lección de/);
});

test('S1-RESERVA: Lucía (Antigravity sin saldo) repite UNA vez con su reserva; diversidad reducida si coincide con Sara', async () => {
  const { body: detail } = await api(`/api/chats/${missionA.id}`);
  const lucia = detail.messages.find(m => m.kind === 'agent' && m.agentId === 'lucia');
  assert.strictEqual(lucia.verdict !== 'ERROR', true, 'con la reserva trabajó');
  assert.deepStrictEqual(lucia.reserva, { motivo: 'NO CREDIT', de: 'gemini gemini-4-argon-medium', a: 'claude sonnet', diversidadReducida: true });
  assert.ok(detail.messages.some(m => m.kind === 'system' && /Lucía Andrade is working with the backup \(claude sonnet\).*Reduced diversity/s.test(m.text)));
  assert.ok(vista(A.id, missionA.id, 'lucia').argv.includes('sonnet'), 'la reserva recibe su propio modelo');
  const { body: log } = await api(`/api/oficinas/${A.id}/bitacora`);
  assert.ok(log.some(l => /Lucía Andrade worked with the backup/.test(l)));
});

test('S1-SNAPSHOT: cambiar la ficha a mitad no cambia el equipo de esa misión; el cambio de modelo queda en la bitácora', async () => {
  const changed = REDACCION.empleados.map(e => (e.id === 'irene' ? { ...e, modelo: { cli: 'claude', id: 'sonnet' } } : e));
  assert.strictEqual((await api(`/api/oficinas/${A.id}`, { method: 'PATCH', body: JSON.stringify({ empleados: changed }) })).status, 200);
  const { body: log } = await api(`/api/oficinas/${A.id}/bitacora`);
  assert.ok(log.some(l => /Irene Vidal switches model: claude opus → claude sonnet/.test(l)));

  assert.strictEqual((await post(`/api/chats/${missionA.id}/messages`, { text: 'Otra pasada' })).status, 202);
  await waitIdle(missionA.id);
  const irene = vista(A.id, missionA.id, 'irene');
  assert.strictEqual(irene.turnos, 2);
  assert.ok(irene.argv.includes('opus') && !irene.argv.includes('sonnet'), 'la misión conserva su instantánea (Opus)');

  const { body: nueva } = await post(`/api/chats?oficina=${A.id}`, { text: 'Misión nueva tras el cambio', config: { maxRounds: 1, team: [{ id: 'irene' }] } });
  await waitIdle(nueva.id);
  assert.ok(vista(A.id, nueva.id, 'irene').argv.includes('sonnet'), 'las misiones nuevas usan la ficha nueva');
  // Continuidad (D56): la misión nueva sabe qué cerró antes esta oficina, debajo de la marca dinámica.
  const brief = vista(A.id, nueva.id, 'irene').brief;
  assert.match(brief.split('<!-- dinámico -->')[1], /## Lo último que cerró esta oficina\n[\s\S]*«Escribe el artículo del martes»/);
  assert.ok(!brief.includes(missionDir(A.id, missionA.id)), 'sin rutas a otras misiones');
});

test('P-MANIFIESTO: alterar chat.json y contexto.json no cambia el equipo autoritativo al reanudar', async () => {
  const office=(await post('/api/oficinas',{...REDACCION,nombre:'Equipo autoritativo'})).body;
  const mission=(await post(`/api/chats?oficina=${office.id}`,{text:'Primera misión',config:{maxRounds:1,team:[{id:'sara'}]}})).body;
  await waitIdle(mission.id);
  const file=path.join(missionDir(office.id,mission.id),'.office','chat.json');
  const chat=JSON.parse(fs.readFileSync(file,'utf8'));
  chat.plantilla_equipo.empleados.find(e=>e.id==='sara').modelo.id='opus';
  fs.writeFileSync(file,JSON.stringify(chat));
  fs.writeFileSync(path.join(missionDir(office.id,mission.id),'.office','contexto.json'),JSON.stringify({oficina:'edificio',team:{snapshot:chat.plantilla_equipo},base:{}}));
  await post(`/api/chats/${mission.id}/messages?oficina=${office.id}`,{text:'Otra revisión'});
  await waitIdle(mission.id);
  const received=vista(office.id,mission.id,'sara');
  const modelIndex=received.argv.indexOf('--model');
  assert.equal(received.argv[modelIndex+1],'sonnet');
  const authoritative=JSON.parse(fs.readFileSync(path.join(home,'.control','oficinas',office.id,'misiones',mission.id,'manifiesto.json'),'utf8'));
  assert.equal(authoritative.equipo.empleados.find(e=>e.id==='sara').modelo.id,'sonnet');
});

test('P-CANARIO-HERMANA, S1-CONCURRENCIA y P-API-ALCANCE: dos oficinas a la vez, cada una con su memoria', async () => {
  const B = (await post('/api/oficinas', { ...REDACCION, nombre: 'Redacción B', marca: { nombre: 'Marca B' } })).body;
  fs.writeFileSync(path.join(officeDir(B.id), 'memoria', 'lecciones.md'), `# Lecciones\n\n### Artículo del martes en B\n- ${CANARIO_B}: artículo, martes, solo de B.\n`);
  const hashEdificio = hashDir(path.join(home, 'memoria'));
  const [ra, rb] = await Promise.all([
    post(`/api/chats?oficina=${A.id}`, { text: 'Escribe el artículo del martes', config: { maxRounds: 1, team: [{ id: 'sara' }] } }),
    post(`/api/chats?oficina=${B.id}`, { text: 'Escribe el artículo del martes', config: { maxRounds: 1, team: [{ id: 'sara' }] } }),
  ]);
  await Promise.all([waitIdle(ra.body.id), waitIdle(rb.body.id)]);
  assert.ok(vista(B.id, rb.body.id, 'sara').brief.includes(CANARIO_B), 'B ve lo suyo');
  const briefA = vista(A.id, ra.body.id, 'sara').brief;
  assert.ok(!briefA.includes(CANARIO_B) && !briefA.includes(officeDir(B.id)), 'A no ve ni el canario ni la ruta de B');
  assert.match(vista(B.id, rb.body.id, 'sara').brief, /Marca: Marca B/);
  const memA = fs.readFileSync(path.join(officeDir(A.id), 'memoria', 'lecciones.md'), 'utf8');
  assert.ok(!memA.includes(CANARIO_B));
  assert.strictEqual(hashDir(path.join(home, 'memoria')), hashEdificio, 'el edificio no cambia ni un byte');
  assert.strictEqual((await api(`/api/memory/search?oficina=${A.id}&q=${CANARIO_B}`)).body.hits.length, 0);
  assert.deepStrictEqual((await api(`/api/chats?oficina=${A.id}`)).body.filter(c => c.id === rb.body.id), []);
});

test('P-TRASPASO: un entrante no está en brief, búsqueda ni memoria de B hasta que lo aceptas dentro de B', async () => {
  const { body: entradas } = await api('/api/memory/entradas?name=lecciones.md');
  const i = entradas.findIndex(e => e.text.includes(CANARIO_EDIFICIO));
  assert.ok(i >= 0);
  const t = await post('/api/memory/traspaso', { name: 'lecciones.md', index: i, destino: A.id });
  assert.strictEqual(t.status, 201);
  assert.match(t.body.archivo, /^\d{8}-\d{6}-secreto-del-edificio\.md$/);
  assert.strictEqual((await post('/api/memory/traspaso', { name: 'lecciones.md', index: i, destino: 'edificio' })).status, 400, 'a sí mismo no');

  // Sin aceptar: fuera del árbol de A, invisible para su búsqueda y para el brief de una misión nueva.
  const { body: pend } = await api(`/api/memory/entrantes?oficina=${A.id}`);
  assert.strictEqual(pend.length, 1);
  assert.match(pend[0].content, /^> Transfer from: Edificio · lecciones.md · «Secreto del edificio»\n> sha256 of the original: [0-9a-f]{16}…/);
  const grep = dir => { let hit = false; const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (fs.readFileSync(p, 'utf8').includes(CANARIO_EDIFICIO)) hit = true; } }; walk(dir); return hit; };
  assert.strictEqual(grep(officeDir(A.id)), false, 'nada bajo oficinas/A');
  assert.strictEqual((await api(`/api/memory/search?oficina=${A.id}&q=${CANARIO_EDIFICIO}`)).body.hits.length, 0);
  const { body: m } = await post(`/api/chats?oficina=${A.id}`, { text: `Secreto del edificio ${CANARIO_EDIFICIO}`, config: { maxRounds: 1, team: [{ id: 'kenji' }] } });
  await waitIdle(m.id);
  assert.ok(!vista(A.id, m.id, 'kenji').brief.split('## Pedido actual')[0].includes(CANARIO_EDIFICIO));
  assert.doesNotMatch(vista(A.id, m.id, 'kenji').brief.split('## Memoria: léela')[1], new RegExp(CANARIO_EDIFICIO), 'no está en la memoria relevante');

  // Una llave de agente de A no puede traspasar ni aceptar.
  const key = (await post(`/api/oficinas/${A.id}/llaves`, { nombre: 'asistente' })).body.llave;
  assert.strictEqual((await post('/api/memory/traspaso', { name: 'lecciones.md', index: 0, destino: 'edificio' }, key)).status, 403);
  assert.strictEqual((await post('/api/memory/entrantes/aceptar', { archivo: pend[0].archivo, tema: 'x.md' }, key)).status, 403);
  assert.strictEqual((await api('/api/memory/entrantes', {}, key)).status, 403);

  // Aceptar dentro de A: entra en el tema elegido, con su procedencia, y ya se encuentra.
  assert.strictEqual((await post(`/api/memory/entrantes/aceptar?oficina=${A.id}`, { archivo: '../x.md', tema: 'traspasos.md' })).status, 400);
  const ok = await post(`/api/memory/entrantes/aceptar?oficina=${A.id}`, { archivo: pend[0].archivo, tema: 'traspasos.md' });
  assert.strictEqual(ok.status, 200);
  assert.match(fs.readFileSync(path.join(officeDir(A.id), 'memoria', 'traspasos.md'), 'utf8'), new RegExp(`Transfer from: Edificio[\\s\\S]*${CANARIO_EDIFICIO}`));
  assert.ok((await api(`/api/memory/search?oficina=${A.id}&q=${CANARIO_EDIFICIO}`)).body.hits.length > 0);
  assert.deepStrictEqual((await api(`/api/memory/entrantes?oficina=${A.id}`)).body, []);
  assert.ok((await api(`/api/oficinas/${A.id}/bitacora`)).body.some(l => /Transfer accepted into traspasos\.md/.test(l)));
});

test('P-PADRE: un AGENTS.md en una carpeta padre bloquea la misión antes de gastar un turno', async () => {
  const intruso = path.join(home, 'oficinas', 'AGENTS.md');
  fs.writeFileSync(intruso, '# Instrucciones heredadas\nCANARIO-padre');
  try {
    const before = (await api(`/api/chats?oficina=${A.id}`)).body.length;
    const r = await post(`/api/chats?oficina=${A.id}`, { text: 'No debería empezar', config: { maxRounds: 1 } });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.body.codigo, 'INSTRUCCION_PADRE');
    assert.ok(r.body.rutas.includes(intruso));
    assert.strictEqual((await api(`/api/chats?oficina=${A.id}`)).body.length, before, 'no se creó la misión');
    // El edificio (sin empleados) sigue como hoy.
    const ed = await post('/api/chats', { text: 'El edificio no cambia', config: { maxRounds: 1, team: [{ id: 'grok' }] } });
    assert.strictEqual(ed.status, 201);
    await waitIdle(ed.body.id);
    const edDir = (await api(`/api/chats/${ed.body.id}`)).body.path;
    const edBrief = fs.readFileSync(path.join(edDir, '.office', 'turno.md'), 'utf8');
    assert.doesNotMatch(edBrief, /Lo último que cerró esta oficina/, 'el edificio no mezcla encargos sin relación');
  } finally { fs.rmSync(intruso, { force: true }); }
  const E = require('../lib/empleados');
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'om-home-'));
  fs.mkdirSync(path.join(fakeHome, '.grok'));
  fs.mkdirSync(path.join(fakeHome, 'a', '.grok'), { recursive: true });
  // (El temporal puede vivir dentro de tu perfil real: solo se miran los hallazgos dentro del perfil falso.)
  const found = E.instruccionesEnPadres(path.join(fakeHome, 'a', 'b', 'mision'), { home: fakeHome }).filter(f => f.startsWith(fakeHome));
  assert.deepStrictEqual(found, [path.join(fakeHome, 'a', '.grok')], '~/.grok es el hogar de Grok, no instrucciones; otro .grok sí cuenta');
  fs.rmSync(fakeHome, { recursive: true, force: true });
});

test('plantilla «Redacción de contenido» y lista de modelos por CLI', async () => {
  const { body: [tpl] } = await api('/api/oficinas/plantillas');
  assert.strictEqual(tpl.id, 'redaccion');
  assert.deepStrictEqual(tpl.oficina.empleados.map(e => e.id), ['irene', 'tomas', 'lucia', 'kenji', 'sara', 'nico', 'taller']);
  assert.ok(!('rutinas' in tpl.oficina) && !('conexiones' in tpl.oficina), 'sin rutinas ni conexiones (S2+)');
  const { body: modelos } = await api('/api/clis/modelos');
  assert.deepStrictEqual(modelos.find(m => m.id === 'claude').modelos, ['opus', 'sonnet', 'fable', 'haiku']);
  assert.strictEqual(modelos.find(m => m.id === 'codex').flag, '-m');
});

test('HOY: el tablero de la oficina sale de lo que confirmó el servidor (turnos, cierres, reserva, cerebro, entrantes)', async () => {
  // Un traspaso pendiente hacia A, para que aparezca en «esperan tu decisión».
  const { body: entradas } = await api('/api/memory/entradas?name=lecciones.md');
  await post('/api/memory/traspaso', { name: 'lecciones.md', index: entradas.findIndex(e => e.text.includes(CANARIO_EDIFICIO)), destino: A.id });
  const { status, body: h } = await api(`/api/oficinas/${A.id}/hoy`);
  assert.strictEqual(status, 200);
  assert.strictEqual(h.hoy, true);
  assert.strictEqual(h.frontera.nivel, 'contexto');
  // Equipo: los cuatro empleados, con su modelo y lo que hizo cada uno; Lucía con la reserva del día.
  assert.deepStrictEqual(h.equipo.map(e => `${e.nombre} · ${e.modelo}`), ['Irene Vidal · claude sonnet', 'Sara Quintero · claude sonnet', 'Lucía Andrade · gemini gemini-4-argon-medium', 'Kenji Morales · codex']);
  const irene = h.equipo.find(e => e.id === 'irene');
  assert.ok(irene.turnos >= 2 && irene.nota === 9 && irene.ultimo.chatId);
  assert.strictEqual(h.equipo.find(e => e.id === 'lucia').reserva.a, 'claude sonnet');
  assert.ok(h.atencion.some(a => /Lucía Andrade worked with the backup \(claude sonnet\)/.test(a.texto)));
  // La interfaz pide el tablero en su idioma (?lang=); sin él, el del servidor (inglés por defecto).
  const hEs = (await api(`/api/oficinas/${A.id}/hoy?lang=es`)).body;
  assert.ok(hEs.atencion.some(a => /Lucía Andrade trabajó con la reserva \(claude sonnet\)/.test(a.texto)));
  assert.match(hEs.proximo.texto, /Sin rutinas/);
  assert.match(h.proximo.texto, /No routines/);
  // Hecho: un cierre por ciclo terminado, con la nota media y quién trabajó (lo dice el orquestador, no un agente).
  const art = h.hecho.find(x => x.chatId === missionA.id && x.quien.length === 4);
  assert.ok(art && ['agotado', 'unanime'].includes(art.estado), JSON.stringify(art));
  assert.strictEqual(art.nota, 9);
  assert.ok(h.hecho.every(x => x.chatId && /^\d\d:\d\d$/.test(x.hora)));
  // Aprendido: la fusión de memoria que hizo el servidor.
  assert.ok(h.aprendido.some(a => a.archivos.includes('lecciones.md')));
  // La CLI falsa no informa uso: cuenta como desconocido, nunca como 0 tokens.
  assert.strictEqual(h.gasto.turnos, h.gasto.turnosMedidos + h.gasto.desconocidos);
  assert.ok(h.gasto.desconocidos > 0);
  assert.ok(h.esperan.some(x => x.tipo === 'entrante' && /Secreto del edificio/.test(x.texto)));
  // Otro día: vacío. Sin misiones de B ni del edificio.
  const ayer = (await api(`/api/oficinas/${A.id}/hoy?dia=2001-01-01`)).body;
  assert.deepStrictEqual([ayer.hecho.length, ayer.gasto.turnos, ayer.hoy], [0, 0, false]);
  const ids = new Set((await api(`/api/chats?oficina=${A.id}`)).body.map(c => c.id));
  assert.ok(h.hecho.every(x => ids.has(x.chatId)), 'solo misiones de A');
  // Una llave de agente no lee el tablero (es del panel).
  const key = (await post(`/api/oficinas/${A.id}/llaves`, { nombre: 'tablero' })).body.llave;
  assert.strictEqual((await api(`/api/oficinas/${A.id}/hoy`, {}, key)).status, 403);
  assert.strictEqual((await api('/api/oficinas/no-existe/hoy')).status, 404);
});

test('PERSONAJE: la ficha elige cualquier personaje con sprites; uno desconocido da 400 y la plantilla reparte la tripulación', async () => {
  const E = require('../lib/empleados');
  const agents = JSON.parse(fs.readFileSync(path.join(home, 'agents.json'), 'utf8')).agents;
  for (const p of E.AVATARES) assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'oficina', `${p}-1.png`)), p);
  const tpl = E.plantillaRedaccion().oficina.empleados.filter(e => e.activo !== false);
  // Cuatro de la tripulación y dos de la redacción: el operador y la sabia quedan como personal fijo de la oficina
  // (si un empleado los llevara, ese personal desaparecería de la escena).
  assert.deepStrictEqual(tpl.map(e => e.avatar.base), ['lider', 'piloto', 'capitana', 'elegido', 'sara', 'nico']);
  const malo = await post('/api/oficinas', { ...REDACCION, nombre: 'Personaje malo', empleados: [{ ...REDACCION.empleados[0], avatar: { base: 'neo' } }] });
  assert.strictEqual(malo.status, 400);
  assert.ok(malo.body.errores.some(e => /unknown character «neo»/.test(e)));
  assert.ok(!fs.existsSync(officeDir('personaje-malo')));
  const tipo = await post('/api/oficinas', { ...REDACCION, nombre: 'Personaje texto', empleados: [{ ...REDACCION.empleados[0], avatar: 'irene' }] });
  assert.strictEqual(tipo.status, 400);
  // Un personaje de la redacción y otro sin personaje (automático) valen; el elegido llega al agente virtual.
  const [a, b] = REDACCION.empleados;
  const ok = await post('/api/oficinas', { ...REDACCION, nombre: 'Personajes', empleados: [{ ...a, avatar: { base: 'irene' } }, { ...b, avatar: undefined }] });
  assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
  assert.deepStrictEqual(ok.body.empleados.map(e => e.avatar?.base ?? null), ['irene', null]);
  const twins = E.validar({ empleados: [{ ...a, avatar: { base: 'kenji' } }, { ...b, avatar: { base: 'kenji' } }] }, agents);
  assert.match(twins.avisos.join(), /same character \(kenji\)/);
});
