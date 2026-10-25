// Imita a Kimi Code CLI en modo no interactivo (`kimi -p "<prompt>" [--output-format text|stream-json]`), sin gastar
// la membresía. La forma de las líneas sale de la referencia oficial del comando `kimi` y de una captura publicada con
// kimi 0.27.0 (fuentes en docs/AGENTES.md §3): un mensaje de chat por línea; el progreso va a stderr.
// Escribe hola.txt (como haría su herramienta WriteFile) y termina con el bloque del protocolo.
const fs = require('fs');

const argv = process.argv.slice(2);
const i = argv.findIndex(a => a === '-p' || a === '--prompt');
if (i < 0 || !argv[i + 1]) { process.stderr.write('error: --prompt es obligatorio en esta CLI falsa\n'); process.exit(2); }
const of = argv.indexOf('--output-format');
const format = of >= 0 ? argv[of + 1] : 'text';

const reporte = 'Creé hola.txt.\n\nOBJECIONES:\n- ninguna\nRESPUESTAS:\n- ninguna\nNOTA: 9/10\nVEREDICTO: APROBADO\nTERMINADO: SÍ';
process.stderr.write('⠋ thinking…\n');
fs.writeFileSync('hola.txt', 'OK\n');

if (format === 'stream-json') {
  const line = o => process.stdout.write(JSON.stringify(o) + '\n');
  line({ role: 'assistant', content: 'Voy a leer el turno.', tool_calls: [{ type: 'function', id: 'c1', function: { name: 'ReadFile', arguments: JSON.stringify({ path: '.office/turno.md' }) } }] });
  line({ role: 'tool', tool_call_id: 'c1', content: '# Turno' });
  line({ role: 'assistant', content: '', tool_calls: [{ type: 'function', id: 'c2', function: { name: 'WriteFile', arguments: JSON.stringify({ path: 'hola.txt', content: 'OK' }) } }] });
  line({ role: 'tool', tool_call_id: 'c2', content: 'Wrote hola.txt' });
  line({ role: 'assistant', content: [{ type: 'text', text: reporte }] });
  line({ role: 'meta', type: 'session.resume_hint', session_id: 'session_demo', command: 'kimi -r session_demo' });
} else {
  console.log(reporte);
}
