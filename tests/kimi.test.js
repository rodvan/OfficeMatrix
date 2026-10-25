// Kimi Code CLI no está instalada aquí: estas pruebas usan tests/helpers/kimi-falsa.js, que imita su salida, y el perfil
// `kimi` de agents.example.json. Si Kimi cambia el formato, actualiza la CLI falsa con una captura real (docs/AGENTES.md §3).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createStreamParser } = require('../lib/streams');
const { parseVerdict, parseScore } = require('../lib/protocol');

const FALSA = path.join(__dirname, 'helpers', 'kimi-falsa.js');
const PROMPT = 'Eres Kimi en OfficeMatrix. Lee el archivo .office/turno.md y sigue sus instrucciones al pie de la letra.';

function correr(args, format) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-kimi-'));
  const r = spawnSync(process.execPath, [FALSA, ...args], { cwd: dir, encoding: 'utf8' });
  const parser = createStreamParser(format, { cwd: dir });
  const events = [];
  for (let i = 0; i < r.stdout.length; i += 7) events.push(...parser.feed(r.stdout.slice(i, i + 7))); // líneas partidas
  events.push(...parser.end());
  return { r, dir, parser, events };
}

test('perfil kimi de agents.example.json: viene apagado, usa -p con {prompt} y el lector kimi', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agents.example.json'), 'utf8'));
  const kimi = cfg.agents.find(a => a.id === 'kimi');
  assert.ok(kimi, 'falta el perfil kimi');
  assert.strictEqual(kimi.enabled, false);
  assert.strictEqual(kimi.cmd, 'kimi');
  assert.strictEqual(kimi.stream, 'kimi');
  assert.strictEqual(kimi.args[kimi.args.indexOf('-p') + 1], '{prompt}');
  // La referencia oficial: --prompt no admite --yolo, --auto ni --plan (ya aprueba solo).
  assert.ok(!kimi.args.some(a => ['--yolo', '-y', '--auto', '--plan'].includes(a)));
});

test('kimi stream-json: se reconoce, dice qué archivo escribe y el reporte trae el protocolo', () => {
  const { r, dir, parser, events } = correr(['-p', PROMPT, '--output-format', 'stream-json'], 'kimi');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(parser.usedStreaming);
  assert.ok(!events.some(e => e.kind === 'raw'), 'ninguna línea como texto crudo');
  assert.ok(!events.some(e => e.kind === 'error'));
  assert.ok(events.some(e => e.kind === 'read' && /turno\.md/.test(e.label)), 'debería decir que lee el turno');
  assert.ok(events.some(e => e.kind === 'write' && e.file === 'hola.txt'), 'debería decir que escribe hola.txt');
  assert.ok(events.some(e => e.label === require('../lib/i18n').t('stream.turnDone')));
  assert.ok(events.every(e => e.label && e.label.length <= 60));
  const final = parser.finalText();
  assert.match(final, /^Creé hola\.txt/);
  assert.strictEqual(parseVerdict(final), 'APROBADO');
  assert.strictEqual(parseScore(final), 9);
  assert.ok(fs.existsSync(path.join(dir, 'hola.txt')));
});

test('kimi en texto plano: con stream "text" también se leen la nota y el veredicto', () => {
  const { r, parser } = correr(['-p', PROMPT], 'text');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!parser.usedStreaming);
  assert.strictEqual(parseVerdict(parser.finalText()), 'APROBADO');
  assert.strictEqual(parseScore(parser.finalText()), 9);
});
