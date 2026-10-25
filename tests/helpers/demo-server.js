// Servidor de demostración para probar la interfaz SIN gastar suscripciones: 4 agentes falsos con los nombres
// y colores reales, sobre una carpeta temporal. Lanza una misión de ejemplo y se cierra solo.
//   node tests/helpers/demo-server.js [puerto=4400] [segundos=90]
// Después abre http://localhost:4400 (o haz una captura con un navegador headless).
const fs = require('fs');
const os = require('os');
const path = require('path');

const port = Number(process.argv[2]) || 4400;
const seconds = Number(process.argv[3]) || 90;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'officematrix-demo-'));
const fake = path.join(__dirname, 'fake-agent.js');
const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'agents.example.json'), 'utf8')).agents;
const scripts = { claude: ['autor', 'claude'], gemini: ['revisor', 'text'], codex: ['revisor', 'claude'], grok: ['revisor', 'claude'] };
// DEMO_SIN_SALDO=grok simula que esa CLI se quedó sin créditos (error 402 real) para ver cómo lo muestra la UI.
if (scripts[process.env.DEMO_SIN_SALDO]) scripts[process.env.DEMO_SIN_SALDO] = ['sin-saldo', 'text'];
// DEMO_MODO=delphi|consejo lanza la misión de ejemplo en ese modo de trabajo (agentes en paralelo).
const workflow = ['delphi', 'consejo'].includes(process.env.DEMO_MODO) ? process.env.DEMO_MODO : null;
if (workflow) for (const id of Object.keys(scripts)) scripts[id] = ['paralelo', 'claude'];
// "kind" conserva qué CLI imita cada falso: así los empleados de la simulación de ejemplo reciben sus flags reales.
// El retardo va por argumento (delay=…) porque el entorno de un empleado va con lista blanca.
const kindOf = a => path.basename(a.cmd).replace(/\.(cmd|exe)$/, '');
fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify({
  // Los cuatro de siempre se encienden en la demo (no gastan nada); un perfil nuevo (p. ej. kimi) conserva su «enabled».
  agents: real.map(a => ({ ...a, enabled: a.id in scripts ? true : a.enabled, cmd: 'node', kind: kindOf(a), stream: (scripts[a.id] || [0, 'text'])[1], args: [fake, a.id, ...(scripts[a.id] || ['revisor', 'text']), '{prompt}', `delay=${process.env.FAKE_DELAY_MS || 1500}`] })),
  maxRounds: 3, autoMaxRounds: 6, minScore: 9, turnTimeoutMinutes: 2,
}));
fs.mkdirSync(path.join(home, 'memoria'));
// Solo los temas (.md): memoria/.historial es una carpeta y copyFileSync fallaba con EPERM. En un clon nuevo no hay
// memoria/ (está en .gitignore): la demo arranca con el cerebro vacío.
const memSrc = path.join(__dirname, '..', '..', 'memoria');
if (fs.existsSync(memSrc)) for (const f of fs.readdirSync(memSrc).filter(f => f.endsWith('.md'))) fs.copyFileSync(path.join(memSrc, f), path.join(home, 'memoria', f));

process.env.OFFICEMATRIX_HOME = home;
process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');
process.env.FAKE_DELAY_MS = process.env.FAKE_DELAY_MS || '1500';
const { server } = require('../../server');

server.listen(port, '127.0.0.1', async () => {
  console.log(`demo en http://localhost:${port} (datos en ${home}); se cierra en ${seconds}s`);
  const chat = await (await fetch(`http://127.0.0.1:${port}/api/chats`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Demo mission: write a short sample and document its API', config: workflow ? { workflow, maxRounds: 3, maxParallel: 3, chair: 'claude' } : { mode: 'auto', maxRounds: 3 } }),
  })).json();
  seedArticle(path.join(home, 'proyectos', chat.id));
  // DEMO_SIMULACION=1: además, la oficina de ejemplo (plantilla «Redacción de contenido») con una misión en marcha.
  if (process.env.DEMO_SIMULACION) {
    const call = (url, body) => fetch(`http://127.0.0.1:${port}${url}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }).then(r => r.json());
    const [tpl] = await call('/api/oficinas/plantillas');
    const o = await call('/api/oficinas', { ...tpl.oficina, color: '#e0a84f' });
    fs.writeFileSync(path.join(home, 'oficinas', o.id, 'memoria', 'lecciones.md'), '# Lecciones de la redacción\n\n### Un dato verificable por idea\n- Qué: cada afirmación lleva su fuente enlazada.\n');
    await call(`/api/chats?oficina=${o.id}`, { text: 'Artículo del martes: por qué el cielo es azul, con fuente para cada dato', config: { mode: 'auto', maxRounds: 2 } });
    console.log(`simulación de ejemplo: ${o.nombre} (${o.id})`);
  }
  setTimeout(() => { server.close(); server.closeAllConnections?.(); process.exit(0); }, seconds * 1000).unref();
});

// Un entregable de ejemplo para probar el visor: HTML con CSS, imagen y un script que intenta usar la API de la app
// (debe salir "bloqueado"), y el mismo artículo en Markdown con su imagen.
function seedArticle(dir) {
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put('final/img/portada.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="300"><defs><linearGradient id="g"><stop offset="0" stop-color="#0b3"/><stop offset="1" stop-color="#3fd0ff"/></linearGradient></defs><rect width="800" height="300" fill="url(#g)"/><text x="40" y="170" font-size="54" font-family="sans-serif" fill="#fff">Sample cover</text></svg>');
  put('final/estilo.css', 'body{font:18px/1.6 Georgia,serif;max-width:760px;margin:40px auto;padding:0 20px;color:#222}h1{color:#0a6}img{max-width:100%;border-radius:8px}#api{padding:8px;background:#fee;border:1px solid #c66}');
  put('final/article.html', `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sample article</title><link rel="stylesheet" href="estilo.css"></head>
<body><h1>Sample article</h1><img src="img/portada.svg" alt="cover"><p>This HTML is served by <code>/raw</code> with its relative CSS and image.</p>
<p id="api">Checking whether this HTML can call the app API…</p>
<script>fetch('/api/chats').then(r => r.text()).then(() => { api.textContent = 'BAD: it could read the API'; }, () => { api.textContent = 'Good: the app API is blocked for this HTML'; api.style.background = '#efe'; });</script></body></html>`);
  put('final/article.md', '# Sample article\n\n![cover](img/portada.svg)\n\nThe same text in **Markdown**, with its relative image. See [the HTML version](article.html).\n');
}
