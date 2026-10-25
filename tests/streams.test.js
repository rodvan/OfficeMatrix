// El parser de streaming contra capturas REALES de las 4 CLIs (tests/fixtures/, grabadas en oct 2026
// con los flags de agents.json en una carpeta de prueba: "leer" = leer nota.txt y ejecutar echo; "escribir" = crear
// saludo.txt y editar nota.txt). Si una CLI cambia su formato, estas pruebas lo detectan.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { t } = require('../lib/i18n');
const { createStreamParser, cleanCommand, classifyCommand, commandEvents, normalizeUsage, sayText } = require('../lib/streams');
const writing = file => t('stream.writing', { file });
const reading = file => t('stream.reading', { file });
const runningTests = () => t('stream.runningTests');

const FIX = path.join(__dirname, 'fixtures');
const PROBE_CWD = 'C:\\Users\\demo\\Documents\\code\\OfficeMatrix\\proyectos\\2026-10-22-officematrix-se-mejora-a-si-misma\\.probe\\';

function run(file, { chunk = 0 } = {}) {
  const format = file.split('-')[0];
  const parser = createStreamParser(format, { cwd: PROBE_CWD + format });
  const text = fs.readFileSync(path.join(FIX, file), 'utf8');
  let events = [];
  if (chunk) for (let i = 0; i < text.length; i += chunk) events.push(...parser.feed(text.slice(i, i + chunk)));
  else events = parser.feed(text);
  events.push(...parser.end());
  return { parser, events, labels: events.map(e => e.label) };
}

for (const file of fs.readdirSync(FIX).filter(f => f.endsWith('.jsonl'))) {
  test(`fixture ${file}: se reconoce el streaming, el reporte final y los tokens (usage)`, () => {
    const { parser, events } = run(file);
    assert.ok(parser.usedStreaming, 'debería reconocer JSON');
    assert.strictEqual(parser.finalText(), 'OK');
    assert.ok(events.some(e => e.kind === 'text' && e.detail?.trim() === 'OK'), 'debería emitir evento text con el reporte final');
    assert.ok(!events.some(e => e.kind === 'raw'), 'ninguna línea debería quedar como texto crudo');
    assert.ok(!events.some(e => e.kind === 'error'), 'no hubo errores en la captura');
    assert.ok(events.every(e => e.label && e.label.length <= 60), 'etiquetas cortas para la burbuja');
    assert.ok(parser.usage && parser.usage.totalTokens > 0 && parser.usage.inputTokens > 0 && parser.usage.outputTokens > 0, `${file}: falta usage`);
    if (file.startsWith('claude-') || file.startsWith('grok-')) assert.ok(parser.usage.costUsd > 0, `${file}: falta costUsd`);
  });
}

test('lecturas: todas las CLIs dicen "leyendo nota.txt"', () => {
  for (const f of ['agy-leer.jsonl', 'codex-leer.jsonl', 'grok-leer.jsonl']) {
    const { events } = run(f);
    const read = events.find(e => e.kind === 'read');
    assert.ok(read, `${f}: falta la lectura`);
    assert.strictEqual(read.file, 'nota.txt', f);
    assert.ok(events.some(e => e.kind === 'cmd' && /echo probando/.test(e.label)), `${f}: falta el comando`);
  }
});

test('escrituras: se detectan los archivos tocados con su ruta relativa', () => {
  for (const f of ['claude-escribir.jsonl', 'agy-escribir.jsonl', 'grok-escribir.jsonl']) {
    const files = run(f).events.filter(e => e.kind === 'write').map(e => e.file);
    assert.ok(files.includes('saludo.txt'), `${f}: ${files}`);
    assert.ok(files.includes('nota.txt'), `${f}: ${files}`);
  }
  // Codex escribe con PowerShell: un solo comando puede crear un archivo y editar otro.
  const codex = run('codex-escribir.jsonl').events;
  assert.deepStrictEqual(codex.filter(e => e.kind === 'write').map(e => e.file), ['saludo.txt', 'nota.txt']);
  assert.deepStrictEqual(codex.filter(e => e.kind === 'read').map(e => e.file), ['nota.txt']);
});

test('un comando encadenado lista cada archivo y un comando simple no cambia de resumen', () => {
  const chain = `node --test; Set-Content -LiteralPath saludo.txt -Value hola; Get-Content -LiteralPath nota.txt`;
  const events = commandEvents(chain, 'C:/proyecto');
  assert.deepStrictEqual(events.map(e => e.label), [runningTests(), writing('saludo.txt'), reading('nota.txt')]);
  assert.strictEqual(commandEvents('Get-Content -LiteralPath C:/proyecto/docs/BRIEF.md', 'C:/proyecto')[0].label, reading('docs/BRIEF.md'));
  assert.strictEqual(commandEvents('node --check server.js')[0].label, t('stream.checkingSyntax'));
  assert.strictEqual(commandEvents(`echo listo; Get-Content -LiteralPath nota.txt`)[0].file, 'nota.txt');
});

test('un solo archivo conserva el aviso de tests y las comas dentro de rutas entre comillas', () => {
  assert.deepStrictEqual(
    commandEvents('node --test; Set-Content -LiteralPath salida.txt -Value ok').map(e => e.label),
    [runningTests(), writing('salida.txt')]);
  assert.deepStrictEqual(
    commandEvents(`Get-Content -LiteralPath 'notas,final.md', "otra,nota.md",simple.md`).map(e => e.file),
    ['notas,final.md', 'otra,nota.md', 'simple.md']);
});

test('el log no confunde un tipo .NET con un archivo y no pierde git, la búsqueda ni la redirección', () => {
  assert.deepStrictEqual(
    commandEvents("$p = 'HANDOFF.md'; [System.IO.File]::WriteAllText($p, $text, [System.Text.UTF8Encoding]::new($false))").map(e => e.label),
    [writing('HANDOFF.md')]);
  assert.deepStrictEqual(
    commandEvents("[System.IO.File]::ReadAllText([System.IO.Path]::Combine($PWD, 'nota.txt'))").map(e => e.file),
    ['nota.txt']);
  assert.deepStrictEqual(
    commandEvents('Get-Content -LiteralPath a.txt; git status --short').map(e => e.label),
    ['git: status --short', reading('a.txt')]);
  assert.deepStrictEqual(
    commandEvents('Get-Content nota.txt; git diff').map(e => e.label),
    ['git: diff', reading('nota.txt')]);
  assert.deepStrictEqual(
    commandEvents('Set-Content -LiteralPath a.txt,b.txt -Value x; rg TODO lib').map(e => e.label),
    [t('stream.searching', { q: 'TODO lib' }), writing('a.txt'), writing('b.txt')]);
  assert.deepStrictEqual(
    commandEvents('echo hola > saludo.txt').map(e => e.label),
    [writing('saludo.txt')]);
  assert.deepStrictEqual(
    commandEvents('node --test > resultado.txt').map(e => e.label),
    [runningTests(), writing('resultado.txt')]);
  assert.deepStrictEqual(
    commandEvents('echo hola > "mi archivo.txt"').map(e => e.file),
    ['mi archivo.txt']);
  assert.deepStrictEqual(commandEvents('node --test 2>&1').map(e => e.label), [runningTests()]);
  assert.deepStrictEqual(
    commandEvents("Set-Content -LiteralPath nota.txt -Value 'a > b'").map(e => e.label),
    [writing('nota.txt')]);
});

test('las líneas pueden llegar partidas en trozos arbitrarios', () => {
  for (const f of ['claude-escribir.jsonl', 'grok-escribir.jsonl']) {
    assert.deepStrictEqual(run(f, { chunk: 7 }).labels, run(f).labels, f);
  }
});

test('sin streaming (formato text o salida no JSON) la app sigue funcionando', () => {
  const p = createStreamParser('text');
  const ev = [...p.feed('Hola\nNOTA: 9/10\nVEREDICTO: APROBADO'), ...p.end()];
  assert.strictEqual(p.usedStreaming, false);
  assert.ok(ev.every(e => e.kind === 'raw'));
  assert.match(p.finalText(), /VEREDICTO: APROBADO$/);
  // Una CLI configurada con streaming que imprime texto plano (p. ej. un error) tampoco rompe nada.
  const q = createStreamParser('claude');
  q.feed('Error: not logged in\n');
  assert.strictEqual(q.finalText(), 'Error: not logged in');
});

test('el primer delta de texto ya dice "redactando", sin esperar al fin del segmento', () => {
  const grok = createStreamParser('grok');
  const early = grok.feed(JSON.stringify({ type: 'text', data: 'Voy' }) + '\n');
  assert.ok(early.some(e => e.kind === 'text' && e.label === t('stream.drafting') && e.detail === 'Voy'));
  const more = grok.feed(JSON.stringify({ type: 'text', data: ' a leer' }) + '\n');
  assert.ok(!more.some(e => e.kind === 'text'), 'los deltas siguientes no deben inundar el log');
  const done = [...grok.feed(JSON.stringify({ type: 'end', stopReason: 'end_turn', usage: { input_tokens: 2, output_tokens: 2 } }) + '\n'), ...grok.end()];
  assert.ok(done.some(e => e.kind === 'text' && e.detail === 'Voy a leer'));
  assert.strictEqual(grok.finalText(), 'Voy a leer');

  const agy = createStreamParser('agy');
  const live = agy.feed(JSON.stringify({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'OK' } }) + '\n');
  assert.ok(live.some(e => e.kind === 'text' && e.detail === 'OK'));
});

test('lo que va pensando llega al globo en avisos "say" cada tanto, no en cada trozo', () => {
  const grok = createStreamParser('grok');
  const ev = [];
  for (const d of ['Voy a leer ', 'el archivo de fuentes ', 'para ver si hay datos ', 'de 2024 sobre computación ', 'cuántica.'])
    ev.push(...grok.feed(JSON.stringify({ type: 'thought', data: d }) + '\n'));
  assert.strictEqual(ev.filter(e => e.kind === 'think').length, 1);
  const says = ev.filter(e => e.kind === 'say');
  assert.ok(says.length >= 1 && says.length < 5, 'avisos espaciados');
  assert.ok(says.at(-1).detail.startsWith('Voy a leer el archivo de fuentes'));
  assert.strictEqual(sayText('## Plan\n**Voy** a revisar `x`'), 'Plan Voy a revisar x');
  assert.ok(sayText('palabra '.repeat(60) + 'lo último').endsWith('lo último'), 'si es largo, se queda con el final');
});

test('comandos: se limpia el envoltorio de PowerShell y se resume la intención', () => {
  assert.strictEqual(cleanCommand(`"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command 'echo hola'`), 'echo hola');
  assert.strictEqual(classifyCommand('node --test').label, runningTests());
  assert.strictEqual(classifyCommand('node --check server.js').label, t('stream.checkingSyntax'));
  assert.strictEqual(classifyCommand('Get-Content -LiteralPath docs/BRIEF.md').label, reading('docs/BRIEF.md'));
  assert.strictEqual(classifyCommand('Get-Content -LiteralPath C:/proyecto/docs/BRIEF.md', 'C:/proyecto').label, reading('docs/BRIEF.md'));
  assert.strictEqual(classifyCommand('rg TODO').kind, 'search');
});

// Comandos y consumo tal como salieron en la primera misión real con las 4 CLIs (22-oct-2026, ver DECISIONES D19).
test('misión real: listas de -LiteralPath y lecturas/escrituras .NET dan un evento por archivo', () => {
  const labels = cmd => commandEvents(cmd).map(e => e.label);
  assert.deepStrictEqual(
    labels('Get-Content -Encoding UTF8 -LiteralPath HANDOFF.md,MEMORIA.md,memoria-oficina/alcance-de-pedidos.md,saludo.txt; Get-ChildItem -Force -Name'),
    [reading('HANDOFF.md'), reading('MEMORIA.md'), reading('memoria-oficina/alcance-de-pedidos.md'), reading('saludo.txt')]);
  assert.deepStrictEqual(labels(`Get-Content -LiteralPath 'mi nota.md', "otra.md"`), [reading('mi nota.md'), reading('otra.md')]);
  assert.deepStrictEqual(
    labels(`$utf8 = New-Object System.Text.UTF8Encoding($false) $saludo = [System.IO.File]::ReadAllText((Join-Path $PWD 'saludo.txt'), $utf8); [System.IO.File]::WriteAllText((Join-Path $PWD 'HANDOFF.md'), $t, $utf8)`),
    [reading('saludo.txt'), writing('HANDOFF.md')]);
  // Grok lee el mismo archivo de tres formas a través de una variable: un solo evento.
  assert.deepStrictEqual(
    labels('$p = "saludo.txt"; $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $p)); $text = [System.IO.File]::ReadAllText((Resolve-Path $p)); $lines = [System.IO.File]::ReadAllLines((Resolve-Path $p)); Write-Output ("bytes=" + $bytes.Length)'),
    [reading('saludo.txt')]);
});

test('misión real: el consumo se normaliza igual en las 4 CLIs (Agy no incluye la caché en input_tokens)', () => {
  const agy = normalizeUsage({ input_tokens: 2451, output_tokens: 105, thinking_tokens: 19, cache_read_tokens: 4745, total_tokens: 2556 });
  assert.deepStrictEqual(agy, { inputTokens: 7196, outputTokens: 105, cachedTokens: 4745, totalTokens: 7301 });
  const codex = normalizeUsage({ input_tokens: 33198, cached_input_tokens: 26880, output_tokens: 107 });
  assert.deepStrictEqual(codex, { inputTokens: 33198, outputTokens: 107, cachedTokens: 26880, totalTokens: 33305 });
  const grok = normalizeUsage({ input_tokens: 16943, cache_read_input_tokens: 37888, cache_creation_input_tokens: 0, output_tokens: 363, total_tokens: 55194 });
  assert.strictEqual(grok.totalTokens, 55194);
  for (const u of [agy, codex, grok]) assert.ok(u.cachedTokens <= u.inputTokens, 'la caché es parte de la entrada');
});
