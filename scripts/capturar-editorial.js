// Capturas del dashboard editorial (/editorial) a 1440 y 390 px, en inglés y en español.
//   node scripts/capturar-editorial.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 4426;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function runProbe(args) {
  return new Promise((resolve, reject) => {
    const cp = spawn('node', ['tests/helpers/ui-probe.js', ...args], { stdio: 'inherit' });
    cp.on('exit', code => (code === 0 ? resolve() : reject(new Error(`ui-probe code ${code}`))));
  });
}

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'om-editorial-capture-'));
  process.env.OFFICEMATRIX_HOME = home;
  process.env.OFFICEMATRIX_LANG = 'en';

  const agentsJson = {
    agents: [
      { id: 'grok', name: 'Grok', role: 'Writer and designer', color: '#fff', cmd: 'node', enabled: true },
      { id: 'claude', name: 'Claude', role: 'Verifier', color: '#ffb547', cmd: 'node', enabled: true },
      { id: 'gemini', name: 'Gemini', role: 'Researcher', color: '#3fd0ff', cmd: 'node', enabled: true },
    ],
    maxRounds: 2, autoMaxRounds: 4, minScore: 9,
  };
  fs.writeFileSync(path.join(home, 'agents.json'), JSON.stringify(agentsJson));
  fs.writeFileSync(path.join(home, 'preferencias.json'), JSON.stringify({ idioma: 'en' }));

  const { server, relojEditorial } = require('../server');
  const srv = await new Promise(resolve => {
    const s = server.listen(PORT, '127.0.0.1', () => resolve(s));
  });

  const base = `http://127.0.0.1:${PORT}`;
  const api = async (endpoint, opts = {}) => {
    const res = await fetch(base + endpoint, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    return res.json();
  };

  console.log('Creando oficina Faro Curioso...');
  const o = await api('/api/oficinas', {
    method: 'POST',
    body: JSON.stringify({ nombre: 'Faro Curioso', equipo: ['grok', 'claude', 'gemini'] }),
  });
  const office = o.id;

  // Regla editorial completa
  await api(`/api/oficinas/${office}/editorial`, {
    method: 'PUT',
    body: JSON.stringify({
      activa: true,
      zona: 'America/Mexico_City',
      horas: ['09:00', '17:00'],
      modo: 'relevo',
      destino: 'borrador',
      redes: ['x', 'instagram', 'tiktok'],
      nichos: ['space', 'science', 'technology'],
      propuestasPorTanda: 3,
      equipo: [
        { id: 'grok', rol: 'Writer and designer' },
        { id: 'claude', rol: 'Verifier' },
        { id: 'gemini', rol: 'Researcher' },
      ],
      marca: {
        nombre: 'Faro Curioso',
        tono: 'Clear, curious and engaging science facts',
        paleta: ['#0B1D3A', '#3FD0FF', '#FFB400', '#39E58C'],
        tipografias: ['Inter', 'Space Grotesk'],
        handles: { x: '@farocurioso_x', instagram: '@farocurioso_ig' },
        proporcion: '4:5',
        referencias: [],
      },
      temas: [
        { id: 'space', nombre: 'Deep Space & Astronomy', escritores: ['grok', 'gemini'] },
        { id: 'biology', nombre: 'Biology & Brain', escritores: ['claude'] },
      ],
      rutinas: [
        { tipo: 'radar', activa: true, cadaMin: 60, cantidad: 3, equipo: ['grok', 'gemini'], topeDiario: 24 },
        { tipo: 'desempeno', activa: true, horas: ['08:00'], topeDiario: 10 },
        { tipo: 'mas-como-este', activa: true, tras: 'desempeno' },
        { tipo: 'aprender', activa: true, horas: ['07:30'], topeDiario: 10 },
        { tipo: 'redaccion', activa: true, horas: ['09:00', '17:00'], equipo: ['grok', 'claude'], topeDiario: 20 },
      ],
    }),
  });

  // Gusto y notas
  await api(`/api/oficinas/${office}/editorial/gusto`, {
    method: 'PUT',
    body: JSON.stringify({
      notas: 'Always cite primary DOI sources. Never use the word «revolutionary». Keep hooks under 100 characters.',
    }),
  });

  // Sembrar propuestas de demostración
  const propDir = path.join(home, 'oficinas', office, 'editorial', 'propuestas');
  fs.mkdirSync(propDir, { recursive: true });

  const p1 = {
    id: '2026-10-26-1',
    hook: 'Did you know supermassive black holes sing in B flat?',
    tema: 'Deep Space & Astronomy',
    pilar: 'space',
    autor: 'grok',
    porQue: 'Astrophysical acoustics resonates strongly with science enthusiasts.',
    copy: {
      x: 'Supermassive black holes emit acoustic waves 57 octaves below middle C. NASA Chandra X-ray observatory detected these sound waves in the Perseus galaxy cluster.\n\n#SpaceFacts #Astronomy',
      instagram: 'Sound travels in space when there is gas. In the Perseus cluster, a black hole ripples through the intergalactic medium producing a note no human ear can hear.\n\n#Astrophysics #NASA',
    },
    hashtags: ['#SpaceFacts', '#Astronomy', '#NASA'],
    hora: new Date(Date.now() + 3600e3).toISOString(),
    estado: 'pendiente',
    lineaOrigen: 'From winner «Black holes that sing» (12,000 interactions on tiktok) → similar trending topic «Sound of Saturn»',
    verificacion: {
      semaforo: 'verde',
      verificador: 'claude',
      fuentes: [
        { url: 'https://chandra.harvard.edu/press/03_releases/press_090903.html', tipo: 'primaria', titulo: 'NASA Chandra Perseus Sound Waves Study', leida: true },
      ],
      nota: 'Primary NASA observatory publication verified and checked.',
    },
    version: 1,
  };

  const p2 = {
    id: '2026-10-26-2',
    hook: 'NASA Artemis III is officially heading to the lunar South Pole',
    tema: 'Deep Space & Astronomy',
    pilar: 'space',
    autor: 'gemini',
    porQue: 'Recent announcement on lunar water ice exploration.',
    copy: {
      x: 'Artemis III aims to land humans near the lunar South Pole to explore permanently shadowed craters containing water ice.\n\n#Artemis #NASA',
    },
    hashtags: ['#Artemis', '#MoonLanding'],
    hora: new Date(Date.now() + 7200e3).toISOString(),
    estado: 'pendiente',
    lineaOrigen: 'Assignment from owner to gemini for tomorrow 09:00',
    verificacion: {
      semaforo: 'amarillo',
      verificador: 'claude',
      fuentes: [
        { url: 'https://spaceflightnow.com/artemis-update', tipo: 'secundaria', titulo: 'Spaceflight Now Artemis Review', leida: true },
      ],
      nota: 'Secondary press reporting only: official mission date subject to review.',
    },
    version: 1,
  };

  const p3 = {
    id: '2026-10-26-3',
    hook: 'Scientists claim time can flow backwards inside quantum mirrors',
    tema: 'Quantum Physics',
    autor: 'grok',
    porQue: 'Sensational claim from pre-print forum.',
    copy: {
      x: 'Did researchers reverse entropy? Quantum coherence experiment shows microscopic time symmetry.',
    },
    hashtags: ['#Quantum'],
    hora: new Date(Date.now() + 14400e3).toISOString(),
    estado: 'pendiente',
    verificacion: {
      semaforo: 'rojo',
      verificador: 'claude',
      fuentes: [],
      nota: 'Unverified pre-print claim contradicted by thermodynamic standard models.',
      contradicha: true,
    },
    version: 1,
  };

  const p4 = {
    id: '2026-10-25-1',
    hook: 'The deepest living octopus was filmed at 7,000 meters underwater',
    tema: 'Biology & Brain',
    pilar: 'biology',
    autor: 'claude',
    porQue: 'Discovery in the Java Trench.',
    copy: {
      x: 'The Dumbo octopus thrives at 7,000 meters in complete darkness. Here is how its biology withstands 700 atmospheres of pressure.',
    },
    hora: new Date(Date.now() - 86400e3).toISOString(),
    estado: 'aprobada',
    lineaOrigen: 'Trend radar (nature)',
    publicado: true,
    metricas: { interacciones: 18450 },
    viralhunt: {
      id: 991,
      donde: 'agendado',
      remoto: { status: 'published', permalinks: ['https://x.com/farocurioso/status/991'] },
    },
    verificacion: {
      semaforo: 'verde',
      verificador: 'claude',
      fuentes: [{ url: 'https://marinebiology.org/dumbo', tipo: 'primaria', titulo: 'Marine Biology Report' }],
    },
    version: 2,
  };

  for (const p of [p1, p2, p3, p4]) {
    const d = path.join(propDir, p.id);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'propuesta.json'), JSON.stringify(p, null, 2));
  }

  // Desempeño
  const desDir = path.join(home, 'oficinas', office, 'editorial', 'desempeno');
  fs.mkdirSync(desDir, { recursive: true });
  fs.writeFileSync(
    path.join(desDir, '2026-10-26.json'),
    JSON.stringify({
      ready: true,
      media: 8200,
      ganadores: [
        { id: '991', tema: 'Biology & Brain', hook: p4.hook, interacciones: 18450, porQue: ['2.2× the average'] },
      ],
    })
  );

  // Rutinas con última ejecución y turnos
  const rutFile = path.join(home, 'oficinas', office, 'editorial', 'rutinas.json');
  fs.writeFileSync(
    rutFile,
    JSON.stringify({
      radar: {
        ultima: {
          inicio: new Date(Date.now() - 3600e3).toISOString(),
          fin: new Date(Date.now() - 3500e3).toISOString(),
          informe: { ok: true, semillas: 3, cayeron: [] },
        },
        turnosHoy: { dia: '2026-10-26', turnos: 4 },
      },
      desempeno: {
        ultima: {
          inicio: new Date(Date.now() - 7200e3).toISOString(),
          fin: new Date(Date.now() - 7180e3).toISOString(),
          informe: { ok: true, ganadores: 1 },
        },
        turnosHoy: { dia: '2026-10-26', turnos: 1 },
      },
    }, null, 2)
  );

  const imgDir = path.join(__dirname, '..', 'docs', 'img');
  fs.mkdirSync(imgDir, { recursive: true });

  const shotEn1440 = path.join(imgDir, 'editorial-en-1440.png');
  const shotEn390 = path.join(imgDir, 'editorial-en-390.png');
  const shotEs1440 = path.join(imgDir, 'editorial-es-1440.png');
  const shotEs390 = path.join(imgDir, 'editorial-es-390.png');

  console.log('Capturando English 1440x1000...');
  await runProbe([
    `http://127.0.0.1:${PORT}/editorial?oficina=${office}`,
    '--size=1440,1000',
    '--wait=3500',
    `--shot=${shotEn1440}`,
    '--eval=document.getElementById("edDashboard") != null',
  ]);

  console.log('Capturando English 390x1000 (mobile)...');
  await runProbe([
    `http://127.0.0.1:${PORT}/editorial?oficina=${office}`,
    '--size=390,1000',
    '--wait=3500',
    `--shot=${shotEn390}`,
    '--eval=document.getElementById("edDashboard") != null',
  ]);

  console.log('Cambiando preferencia a español...');
  await api('/api/preferencias', {
    method: 'PUT',
    body: JSON.stringify({ idioma: 'es' }),
  });

  console.log('Capturando Español 1440x1000...');
  await runProbe([
    `http://127.0.0.1:${PORT}/editorial?oficina=${office}`,
    '--size=1440,1000',
    '--wait=3500',
    `--shot=${shotEs1440}`,
    '--eval=I18N.setLang("es")',
    '--eval=document.getElementById("edDashboard") != null',
  ]);

  console.log('Capturando Español 390x1000 (mobile)...');
  await runProbe([
    `http://127.0.0.1:${PORT}/editorial?oficina=${office}`,
    '--size=390,1000',
    '--wait=3500',
    `--shot=${shotEs390}`,
    '--eval=I18N.setLang("es")',
    '--eval=document.getElementById("edDashboard") != null',
  ]);

  srv.close();
  srv.closeAllConnections?.();
  fs.rmSync(home, { recursive: true, force: true });
  console.log('Capturas generadas con éxito:');
  console.log('- editorial-en-1440.png:', fs.existsSync(shotEn1440) ? `${fs.statSync(shotEn1440).size} bytes` : 'NO');
  console.log('- editorial-en-390.png:', fs.existsSync(shotEn390) ? `${fs.statSync(shotEn390).size} bytes` : 'NO');
  console.log('- editorial-es-1440.png:', fs.existsSync(shotEs1440) ? `${fs.statSync(shotEs1440).size} bytes` : 'NO');
  console.log('- editorial-es-390.png:', fs.existsSync(shotEs390) ? `${fs.statSync(shotEs390).size} bytes` : 'NO');
}

main().catch(err => {
  console.error('Error generando capturas:', err);
  process.exit(1);
});
