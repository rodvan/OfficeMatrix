// Pruebas de la directiva del dueño: ronda de cierre tras meseta, bloqueo de entorno y detalles por modo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isEnvironmentBlock, blocking } = require('../lib/debate');
const cierre = require('../lib/cierre');

test('bloqueo de entorno: sandbox y permisos se identifican y no bloquean el producto', () => {
  const objEntorno1 = { id: 1, text: 'Fallo en sandbox de Codex: taskkill devuelve Access denied contra nodo hijo', by: 'codex', status: 'abierta' };
  const objEntorno2 = { id: 2, text: 'Prueba S1F CORTE_NO_CONFIRMADO por restricción de entorno', by: 'codex', status: 'abierta' };
  const objProducto = { id: 3, text: 'Falta implementar la tarjeta de cierre en mobile a 390px', by: 'grok', status: 'abierta' };

  assert.strictEqual(isEnvironmentBlock(objEntorno1), true, 'detecta sandbox y access denied');
  assert.strictEqual(isEnvironmentBlock(objEntorno2), true, 'detecta restricción de entorno y corte no confirmado');
  assert.strictEqual(isEnvironmentBlock(objProducto), false, 'no confunde defecto de producto');

  const debate = [objEntorno1, objEntorno2, objProducto];
  const allBlocking = blocking(debate, ['codex', 'grok']);
  assert.strictEqual(allBlocking.length, 3, 'todas las objeciones abiertas');

  const productBlocking = blocking(debate, ['codex', 'grok'], { excludeEnvironment: true });
  assert.strictEqual(productBlocking.length, 1, 'solo queda la de producto');
  assert.strictEqual(productBlocking[0].id, 3);
});

test('informe de cierre clasifica bloqueos de entorno y separa de objeciones de producto', () => {
  const chat = {
    id: 'm-entorno',
    title: 'Misión con bloqueo de entorno',
    created: '2026-10-24T20:00:00.000Z',
    debate: [
      { id: 1, text: 'Fallo en sandbox de Codex: Access denied', by: 'codex', agentName: 'Codex', status: 'abierta' },
      { id: 2, text: 'Falta validar los botones en la UI', by: 'gemini', agentName: 'Gemini', status: 'abierta' },
    ],
    messages: [
      { kind: 'user', text: 'Haz esto' },
      { kind: 'agent', agentId: 'codex', agentName: 'Codex', round: 1, verdict: 'CAMBIOS', score: 8, text: 'NOTA: 8/10\nVEREDICTO: CAMBIOS' },
    ],
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-cierre-entorno-'));
  try {
    const c = cierre.construirCierre({ chat, dir, conGit: false });
    assert.strictEqual(c.noLogrado.objeciones.length, 1, 'solo 1 objeción de producto');
    assert.strictEqual(c.noLogrado.objeciones[0].id, 2);
    assert.strictEqual(c.noLogrado.bloqueosEntorno.length, 1, '1 bloqueo de entorno clasificado');
    assert.strictEqual(c.noLogrado.bloqueosEntorno[0].id, 1);
    assert.ok(c.riesgos.some(r => /límite de su ordenador/i.test(r.texto)));

    const md = cierre.aMarkdown(c);
    assert.match(md, /Límite del equipo de Codex \(no es un fallo del trabajo\) #1/);
    assert.doesNotMatch(md, /restricción de sandbox\/permisos/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detalles por modo (RF8) y estado de aplicación en informe de cierre', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-proyectos-mision-'));
  const finalDir = path.join(dir, 'final');
  fs.mkdirSync(finalDir, { recursive: true });
  fs.writeFileSync(path.join(finalDir, 'articulo.html'), '<h1>Final</h1>');

  const chatDelphi = {
    id: 'm-delphi',
    title: 'Misión Delphi',
    created: '2026-10-24T20:00:00.000Z',
    config: { workflow: 'delphi' },
    modoDetalle: { modo: 'delphi', borrador: 'B', autor: 'Gemini', avgs: { B: 9.2 } },
    messages: [{ kind: 'user', text: 'Investigación' }],
  };

  try {
    const cDelphi = cierre.construirCierre({ chat: chatDelphi, dir, conGit: false });
    assert.strictEqual(cDelphi.modoDetalle?.modo, 'delphi');
    assert.strictEqual(cDelphi.modoDetalle?.borrador, 'B');
    assert.strictEqual(cDelphi.modoDetalle?.autor, 'Gemini');
    assert.strictEqual(cDelphi.aplicado, false, 'al vivir en carpeta temporal con om-proyectos no está aplicado');

    const mdDelphi = cierre.aMarkdown(cDelphi);
    assert.match(mdDelphi, /## Modo DELPHI/);
    assert.match(mdDelphi, /Borrador consolidado en `final\/`: \*\*B\*\*/);

    // Editorial
    const chatEditorial = {
      id: 'm-editorial',
      title: 'Tanda editorial de la semana',
      created: '2026-10-24T20:00:00.000Z',
      editorial: { tipo: 'tanda', franja: '12:00' },
      editorialResultado: { creadas: 3, descartadas: 1, temas: ['Tecnología', 'Productividad'] },
      messages: [{ kind: 'user', text: 'Tanda de contenido para la semana' }],
    };
    const cEditorial = cierre.construirCierre({ chat: chatEditorial, dir, conGit: false });
    assert.strictEqual(cEditorial.modoDetalle?.modo, 'editorial');
    assert.strictEqual(cEditorial.modoDetalle?.creadas, 3);
    assert.strictEqual(cEditorial.modoDetalle?.descartadas, 1);
    assert.strictEqual(cEditorial.autor, 'plantilla', 'en editorial no hay relator');

    const mdEd = cierre.aMarkdown(cEditorial);
    assert.match(mdEd, /## Editorial: tanda de contenido/);
    assert.match(mdEd, /Propuestas listas en la bandeja: \*\*3\*\*/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('opción «▶ Continuar hasta terminar» presente con pendientes escritos cuando se detiene sin terminar', () => {
  const CICLO = 1792800000000;
  const chat = {
    id: 'm-meseta',
    title: 'Misión detenida por meseta',
    created: new Date(CICLO - 1000).toISOString(),
    debate: [
      { id: 1, text: 'Corregir contraste en botones', by: 'gemini', status: 'abierta' },
    ],
    messages: [
      { kind: 'user', text: 'Mejora diseño' },
      { kind: 'system', cycle: CICLO, outcome: 'started', text: 'Comienza el ciclo' },
      { kind: 'agent', cycle: CICLO, agentId: 'autor', agentName: 'Autor', round: 1, verdict: 'CAMBIOS', score: 8, handoffText: '## Último traspaso\n\n**De:** Autor, ronda 1\n\n**Qué hice:**\n- nada\n\n**Decisiones y por qué:**\n- ok\n\n**Objeciones abiertas:**\n- #1 Corregir contraste en botones\n\n**Siguiente paso recomendado:**\n- Corregir contraste en botones' },
      { kind: 'agent', cycle: CICLO, agentId: 'revisor', agentName: 'Revisor', round: 1, verdict: 'CAMBIOS', score: 8, handoffText: '## Último traspaso\n\n**De:** Revisor, ronda 1\n\n**Qué hice:**\n- nada\n\n**Decisiones y por qué:**\n- ok\n\n**Objeciones abiertas:**\n- #1 Corregir contraste en botones\n\n**Siguiente paso recomendado:**\n- Corregir contraste en botones' },
      { kind: 'system', cycle: CICLO, outcome: 'meseta', text: 'Detenido por meseta, sin aprobar' },
    ],
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-opciones-'));
  try {
    const c = cierre.construirCierre({ chat, dir, conGit: false });
    assert.strictEqual(c.causa, 'meseta');
    const optContinuar = c.opciones.find(o => o.id === 'seguir');
    assert.ok(optContinuar, 'opción presente');
    assert.strictEqual(optContinuar.etiqueta, '▶ Continuar hasta terminar');
    assert.match(optContinuar.cuerpo.text, /Corregir contraste en botones/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('permisos del producto no se descartan como limitaciones del agente', () => {
  for (const text of [
    'La API permite modificar archivos sin comprobar permisos',
    'Un usuario autorizado recibe Access denied al exportar',
    'Exportar falla con EPERM y EACCES',
    'El sandbox del producto permite escapar de la carpeta',
  ]) {
    const obj = { id: 10, by: 'user', status: 'abierta', text };
    assert.strictEqual(isEnvironmentBlock(obj), false, text);
    assert.strictEqual(blocking([obj], [], { excludeEnvironment: true }).length, 1, text);
  }
  assert.strictEqual(isEnvironmentBlock({ text: 'Fallo en sandbox de Codex', bloqueoEntorno: false }), false);
});

test('bloqueo de entorno en inglés: los agentes escriben en el idioma del pedido', () => {
  for (const text of [
    "S1F fails in my sandbox: taskkill returns Access denied",
    'CUT_NOT_CONFIRMED because of a runner restriction',
    'Only fails on my machine; restricted environment',
  ]) assert.strictEqual(isEnvironmentBlock({ id: 1, by: 'codex', status: 'abierta', text }), true, text);
  for (const text of [
    'An authorized user gets Access denied when exporting',
    'Export fails with EPERM and EACCES',
    "The product's sandbox lets a mission escape its folder",
  ]) assert.strictEqual(isEnvironmentBlock({ id: 2, by: 'user', status: 'abierta', text }), false, text);
});


test('directivas de ronda de cierre comparten claves ES y EN', () => {
  for (const lang of ['es', 'en']) {
    const t = cierre.textos[lang];
    const lista = t.objecionCierre({ id: 1, by: 'user', text: 'X' }) + '\n' + t.puntoCierre({ estado: 'falta', texto: 'Y' });
    assert.match(t.rondaCierre(2, lista), /X[\s\S]*Y/);
  }
  assert.match(cierre.textos.en.rondaCierre(2, '1. X'), /Closing round/);
});
