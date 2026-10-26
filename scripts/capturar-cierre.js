// Capturas de la tarjeta de cierre en inglés (el idioma por defecto) a 1440 y 390 px, para el README.
// Usa la demo con agentes falsos (tests/helpers/demo-server.js) y ui-probe: no gasta suscripciones.
//   node scripts/capturar-cierre.js   → docs/img/cierre-1440.png y docs/img/cierre-390.png
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 4425;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log(`Iniciando demo-server en puerto ${PORT}...`);
  const demoEnv = { ...process.env, FAKE_DELAY_MS: '200', OFFICEMATRIX_LANG: 'en' };
  const demo = spawn('node', ['tests/helpers/demo-server.js', String(PORT), '60'], {
    env: demoEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  demo.stdout.on('data', d => process.stdout.write('[demo] ' + d));
  demo.stderr.on('data', d => process.stderr.write('[demo-err] ' + d));

  let chatId = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/chats`);
      if (res.ok) {
        const chats = await res.json();
        if (chats.length) {
          chatId = chats[0].id;
          break;
        }
      }
    } catch {}
  }

  if (!chatId) {
    demo.kill();
    throw new Error('No se pudo obtener el ID del chat demo');
  }

  console.log(`Esperando a que termine el ciclo de la misión ${chatId}...`);
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/chats/${chatId}`);
      if (res.ok) {
        const detail = await res.json();
        if (!detail.running) {
          console.log('Misión terminada, generando/verificando cierre...');
          await fetch(`http://127.0.0.1:${PORT}/api/chats/${chatId}/cierre`, { method: 'POST' });
          break;
        }
      }
    } catch {}
  }

  // Verificar que el cierre responde
  const cierreRes = await (await fetch(`http://127.0.0.1:${PORT}/api/chats/${chatId}/cierre`)).json();
  console.log('Cierre obtenido:', cierreRes.semaforo, cierreRes.veredicto?.frase);

  const evDir = path.join(__dirname, '..', 'docs', 'img');
  fs.mkdirSync(evDir, { recursive: true });

  const shot1440 = path.join(evDir, 'cierre-1440.png');
  const shot390 = path.join(evDir, 'cierre-390.png');

  console.log('Capturando a 1440x1000...');
  execFileSync('node', [
    'tests/helpers/ui-probe.js',
    `http://127.0.0.1:${PORT}/#m=${chatId}&tab=reports`,
    '--size=1440,1000',
    '--wait=4000',
    `--shot=${shot1440}`,
    '--eval=document.querySelector(".cierre-card") != null',
    '--eval=document.documentElement.lang',
    // Un perfil limpio abre «Getting started»: se cierra para que se vea la tarjeta.
    '--eval=(() => { const d = document.getElementById("setupDialog"); if (d && d.open) d.close(); localStorage.setItem("om-setup-seen-v1", "1"); document.querySelector(".cierre-card").scrollIntoView(); return true; })()',
  ], { stdio: 'inherit' });

  console.log('Capturando a 390x1000 (móvil)...');
  execFileSync('node', [
    'tests/helpers/ui-probe.js',
    `http://127.0.0.1:${PORT}/#m=${chatId}&tab=reports`,
    '--size=390,1000',
    '--wait=4000',
    `--shot=${shot390}`,
    '--eval=document.querySelector(".cierre-card") != null',
    '--eval=document.documentElement.lang',
    // Un perfil limpio abre «Getting started»: se cierra para que se vea la tarjeta.
    '--eval=(() => { const d = document.getElementById("setupDialog"); if (d && d.open) d.close(); localStorage.setItem("om-setup-seen-v1", "1"); document.querySelector(".cierre-card").scrollIntoView(); return true; })()',
  ], { stdio: 'inherit' });

  demo.kill();
  console.log('Demo cerrada limpiamente.');
  console.log('Capturas generadas en docs/img/:');
  console.log('- cierre-1440.png:', fs.existsSync(shot1440) ? `${fs.statSync(shot1440).size} bytes` : 'NO');
  console.log('- cierre-390.png:', fs.existsSync(shot390) ? `${fs.statSync(shot390).size} bytes` : 'NO');
}

main().catch(err => {
  console.error('Error en capturar-cierre:', err);
  process.exit(1);
});
