// Diagnóstico de fallos de las CLIs (lib/failure.js) y validación de plantillas propias (lib/templates.js).
const test = require('node:test');
const assert = require('node:assert');
const { classifyFailure } = require('../lib/failure');
const { normalizeCustomTemplate, templateById, setCustomTemplates, templateBrief } = require('../lib/templates');

test('fallos: el 402 real de Grok es "sin saldo" y la línea útil es el mensaje de la API', () => {
  const stderr = 'Error: Internal error: {\n  "message": "API error (status 402 Payment Required): Grok Build usage balance exhausted",\n  "http_status": 402\n}';
  const f = classifyFailure({ code: 1, stderr });
  assert.strictEqual(f.kind, 'saldo');
  assert.strictEqual(f.label, 'NO CREDIT');
  assert.strictEqual(f.detail, 'API error (status 402 Payment Required): Grok Build usage balance exhausted');
  assert.match(f.hint, /rest of the team keeps working/);
});

test('fallos: límite de uso, sesión caducada, CLI no encontrada, red y fallo genérico', () => {
  assert.strictEqual(classifyFailure({ code: 1, stderr: "You've hit your usage limit. Try again in 3 hours." }).kind, 'limite');
  assert.strictEqual(classifyFailure({ code: 1, stderr: 'Error 429 Too Many Requests' }).kind, 'limite');
  assert.strictEqual(classifyFailure({ code: 1, stderr: 'Not logged in · Please run /login' }).kind, 'sesion');
  assert.strictEqual(classifyFailure({ code: 1, stderr: 'Error: 401 Unauthorized' }).kind, 'sesion');
  assert.strictEqual(classifyFailure({ code: 1, stderr: "'grok' no se reconoce como un comando interno o externo," }).kind, 'no-instalada');
  assert.strictEqual(classifyFailure({ code: 1, stderr: 'TypeError: fetch failed' }).kind, 'red');
  const generic = classifyFailure({ code: 3, stderr: '' });
  assert.strictEqual(generic.kind, 'fallo');
  assert.match(generic.detail, /code 3/);
});

test('fallos: colgada y tiempo agotado; un reporte completo con código 1 es un turno válido', () => {
  assert.strictEqual(classifyFailure({ code: 1, idle: true, idleMinutes: 10 }).kind, 'colgada');
  assert.match(classifyFailure({ code: 1, idle: true, idleMinutes: 10 }).detail, /10 min/);
  assert.strictEqual(classifyFailure({ code: 1, timedOut: true, timeoutMinutes: 20 }).kind, 'tiempo');
  assert.strictEqual(classifyFailure({ code: 1, timedOut: true, report: 'Hecho.\nNOTA: 9/10\nVEREDICTO: APROBADO' }), null);
  assert.strictEqual(classifyFailure({ code: 1, report: 'Hice cosas.\nNOTA: 8/10\nVEREDICTO: CAMBIOS', stderr: 'warning: rate limit close' }), null);
  assert.strictEqual(classifyFailure({ code: 0, report: 'Trabajo sin veredicto' }), null);
});

test('fallos: un reporte parcial o inválido no oculta errores ni tiempos agotados', () => {
  for (const report of ['NOTA: 9/10', 'VEREDICTO:', 'NOTA: 99/10\nVEREDICTO: APROBADO', 'NOTA: 9/10\nVEREDICTO: ERROR']) {
    assert.strictEqual(classifyFailure({ code: 1, stderr: 'Error: 402 Payment Required', report }).kind, 'saldo');
    assert.strictEqual(classifyFailure({ code: 1, timedOut: true, report }).kind, 'tiempo');
  }
  assert.strictEqual(classifyFailure({ code: 1, report: '**NOTA:** 9/10\n**VEREDICTO:** APROBADO' }), null);
});

test('fallos: una CLI que imprime el error de cuenta y sale con 0 también cae; un trabajo largo que menciona "quota" no', () => {
  assert.strictEqual(classifyFailure({ code: 0, stdout: 'Error: insufficient credits. Please top up.' }).kind, 'saldo');
  const long = 'Analicé la quota de la API en el informe. '.repeat(30);
  assert.strictEqual(classifyFailure({ code: 0, stdout: long, report: long }), null);
});

test('plantillas propias: validación, id estable, equipo filtrado y criterios en el brief', () => {
  const agents = [{ id: 'claude', role: 'Arquitecto' }, { id: 'grok', role: 'Auditor' }];
  assert.match(normalizeCustomTemplate({ name: '' }, agents).error, /name/);
  assert.match(normalizeCustomTemplate({ name: 'Sin equipo', team: [{ id: 'nadie' }] }, agents).error, /agent/);
  const { template: t } = normalizeCustomTemplate({
    name: 'Informe Técnico', mode: 'auto', maxRounds: 99, minScore: 0,
    team: [{ id: 'grok' }, { id: 'claude', role: '  Redactor ' }, { id: 'grok' }], criteria: ['- uno', '', '* dos'],
  }, agents);
  assert.strictEqual(t.id, 'u-informe-tecnico');
  assert.strictEqual(t.maxRounds, 20);
  assert.strictEqual(t.minScore, 9);
  assert.deepStrictEqual(t.team, [{ id: 'grok', role: 'Auditor' }, { id: 'claude', role: 'Redactor' }]);
  assert.deepStrictEqual(t.criteria, ['uno', 'dos']);
  setCustomTemplates([t]);
  try {
    assert.strictEqual(templateById('u-informe-tecnico').name, 'Informe Técnico');
    assert.match(templateBrief('u-informe-tecnico'), /- uno\n- dos/);
    setCustomTemplates([{ ...t, criteria: [], output: '' }]);
    assert.strictEqual(templateBrief('u-informe-tecnico'), '## Mission type: Informe Técnico');
  } finally { setCustomTemplates([]); }
  assert.strictEqual(templateById('u-informe-tecnico'), null);
});
