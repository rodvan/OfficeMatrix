// CLI falsa para las pruebas de simulaciones (SIMULACIONES.md §1.7): se comporta como una CLI de IA y deja escrito lo
// que recibió, para que la prueba compruebe argv, entorno y brief sin gastar suscripción.
// Uso: node cli-falsa.js [exec] <guion> "<prompt>" [flags que añade OfficeMatrix…]
//   guion "ok":        lee su .office/turno-<empleado>.md, escribe .office/vista-<empleado>.json, deja una lección en
//                      memoria-oficina/lecciones.md y aprueba.
//   guion "sin-saldo": imprime el 402 real de Grok y sale con 1 (para probar la reserva).
// El retardo de la demo llega por argumento ("lento"), no por entorno: el entorno de un empleado va con lista blanca.
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const guion = argv.find(a => ['ok', 'sin-saldo'].includes(a)) || 'ok';
const prompt = argv.find(a => /^(?:Eres|You are) /.test(a)) || '';
const lento = argv.includes('lento');

if (guion === 'sin-saldo') {
  process.stderr.write('Error: Internal error: {\n  "message": "API error (status 402 Payment Required): Grok Build usage balance exhausted",\n  "http_status": 402\n}\n');
  process.exit(1);
}

const briefFile = (prompt.match(/\.office\/(turno[\w-]*\.md)/) || [])[1] || 'turno.md';
const brief = fs.readFileSync(path.join('.office', briefFile), 'utf8');
const who = (briefFile.match(/^turno-([\w-]+)\.md$/) || [])[1] || 'anon';
const name = (prompt.match(/^(?:Eres|You are) (.+?) (?:en|in) OfficeMatrix/) || [])[1] || who;
const vista = path.join('.office', `vista-${who}.json`);
const prev = fs.existsSync(vista) ? JSON.parse(fs.readFileSync(vista, 'utf8')) : { turnos: 0 };
fs.writeFileSync(vista, JSON.stringify({ turnos: prev.turnos + 1, argv, env: process.env, brief, briefFile }, null, 1));

fs.mkdirSync('memoria-oficina', { recursive: true });
const lec = path.join('memoria-oficina', 'lecciones.md');
const before = fs.existsSync(lec) ? fs.readFileSync(lec, 'utf8') : '# Lecciones\n';
if (!before.includes(`Lección de ${name}`)) fs.writeFileSync(lec, `${before.trimEnd()}\n\n### Lección de ${name}\n- Aprendido en ${process.env.OFFICEMATRIX_OFICINA || '?'}.\n`);
fs.writeFileSync(`trabajo-${who}.md`, `trabajo de ${name}\n`);

setTimeout(() => {
  console.log(`Reporte de ${name}.\n\nOBJECIONES:\n- ninguna\nRESPUESTAS:\n- ninguna\nNOTA: 9/10\nVEREDICTO: APROBADO\nTERMINADO: SÍ`);
}, lento ? 2500 + Math.random() * 2500 : 0);
