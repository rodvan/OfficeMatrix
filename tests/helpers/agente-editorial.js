// Agente falso de la Editorial continua: se comporta como una CLI (lee .office/turno.md, deja archivos, imprime su reporte).
//   Tanda («propongan N contenidos»): crea propuestas/1..N/ con propuesta.json, imagen.png e investigacion.md.
//   Cambios («Cambios pedidos…»): reescribe propuestas/1/propuesta.json con un hook nuevo («… (v2)»).
//   Con EDITORIAL_COPIA=1 la propuesta 1 copia el texto de la fuente palabra por palabra (el servidor debe descartarla).
// La imagen de ejemplo: EDITORIAL_IMAGEN=<ruta png> la copia; si no, un PNG mínimo válido.
// Uso en agents.json: node agente-editorial.js <id> "{prompt}" [delay=<ms>]
const fs = require('fs');
const path = require('path');

const [id] = process.argv.slice(2);
const delay = Number((process.argv.find(a => /^delay=\d+$/.test(a)) || '').slice(6)) || 0;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const counter = path.join('.office', `editorial-${id}.count`);
const n = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0) + 1;
fs.writeFileSync(counter, String(n));

const turno = fs.readFileSync(path.join('.office', 'turno.md'), 'utf8');
let cambie = false;
const FUENTE = 'Un estudio de la universidad muestra que dormir siete horas mejora la memoria de trabajo en adultos jóvenes según los datos publicados hoy';

// El turno también lista misiones previas de la oficina: la tanda se reconoce por su pedido, no por un título suelto.
const TANDA = /(?:propongan|propose) (\d+) (?:contenidos|pieces)/;
if (!TANDA.test(turno) && /(?:Cambios pedidos por el usuario|Changes requested by the user)/.test(turno)) {
  const file = path.join('propuestas', '1', 'propuesta.json');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!/\(v2\)$/.test(p.hook)) {
    p.hook = `${p.hook} (v2)`;
    for (const red of Object.keys(p.copy || {})) p.copy[red] = `${p.copy[red]} Versión corregida.`;
    fs.writeFileSync(file, JSON.stringify(p, null, 2));
    cambie = true;
  }
} else {
  const total = Number((TANDA.exec(turno) || [])[1]) || 3;
  const redes = ((/- (?:Redes destino|Target networks): (.+)/.exec(turno) || [])[1] || 'instagram, x').split(',').map(s => s.trim());
  for (let i = 1; i <= total; i++) {
    const dir = path.join('propuestas', String(i));
    if (fs.existsSync(path.join(dir, 'propuesta.json'))) continue;
    fs.mkdirSync(dir, { recursive: true });
    const copia = process.env.EDITORIAL_COPIA === '1' && i === 1;
    const p = {
      tema: `Tema de prueba ${i}`, porQue: `Crece +${900 * i} en 9 h en X`, hook: process.env.EDITORIAL_DEMO ? ['Tu cerebro también necesita una pausa', 'Dormir es parte del trabajo', 'Menos ruido. Más ideas.'][(i - 1) % 3] : `Hook viral número ${i}`,
      copy: Object.fromEntries(redes.map(r => [r, copia ? FUENTE : `Copy propio ${i} para ${r}: lo contamos con la voz de la marca.`])),
      hashtags: ['ciencia', 'cerebro'], hora: new Date(Date.now() + (24 + i) * 3600e3).toISOString(), idiomas: ['es'], tipo: 'fact',
      fuente: { nombre: 'X · @cuenta', url: `https://example.com/x/${i}`, metricas: { likes: 1000 * i, views: 90000 * i }, texto: FUENTE },
    };
    fs.writeFileSync(path.join(dir, 'propuesta.json'), JSON.stringify(p, null, 2));
    const imageFile = process.env.EDITORIAL_IMAGEN?.replace('{n}', String(i));
    const img = imageFile && fs.existsSync(imageFile) ? fs.readFileSync(imageFile) : PNG;
    fs.writeFileSync(path.join(dir, 'imagen.png'), img);
    fs.writeFileSync(path.join(dir, 'investigacion.md'), `# Fuentes\n\n- https://example.com/x/${i} (verificado en investigacion/viralhunt.json)\n`);
    cambie = true;
  }
}

setTimeout(() => {
  process.stdout.write([
    cambie ? 'Dejé las propuestas en propuestas/.' : 'Revisé las propuestas: están listas.',
    'OBJECIONES:', '- ninguna', 'RESPUESTAS:', '- ninguna', 'NOTA: 9/10',
    `VEREDICTO: ${cambie ? 'CAMBIOS' : 'APROBADO'}`, 'TERMINADO: SÍ', '',
  ].join('\n'));
}, delay);
