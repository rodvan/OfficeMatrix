// Sonda de la interfaz: abre la página en Chrome/Edge headless, recoge errores de consola y excepciones,
// evalúa expresiones en la página y, opcionalmente, guarda una captura. Sin dependencias (WebSocket nativo de Node 22+).
//   node tests/helpers/ui-probe.js <url> [--wait=6000] [--eval="expr"]... [--shot=archivo.png] [--size=1680,1000]
//     [--frames=N,ms]   con --shot, una serie de N capturas cada ms (archivo-1.png … archivo-N.png): sirve de «GIF»
//     [--clip=selector] [--scale=0.5]   recorta las capturas a un elemento y las reduce (scripts/grabar-escena.js)
// Ejemplo: node tests/helpers/ui-probe.js "http://localhost:4400/#m=ID&tab=debate" --eval="currentId" --shot=%TEMP%\ui.png
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith('--'));
const opt = (k, d) => (args.find(a => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const evals = args.filter(a => a.startsWith('--eval=')).map(a => a.slice(7));
const wait = Number(opt('wait', 6000));
const [w, h] = opt('size', '1680,1000').split(',').map(Number);
const shot = opt('shot', '');

const browsers = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const exe = browsers.find(b => fs.existsSync(b));
if (!url || !exe) { console.error(!url ? 'Falta la URL' : 'No encontré Chrome ni Edge (define CHROME_PATH)'); process.exit(2); }

const port = 9300 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'om-probe-'));
const browser = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, `--window-size=${w},${h}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); } catch {}
  }
  if (!target) throw new Error('El navegador no respondió');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    const timer=setTimeout(()=>rej(new Error('DevTools no abrió el WebSocket en 10 s')),10000);
    ws.onopen=()=>{clearTimeout(timer);res();};
    ws.onerror=()=>{clearTimeout(timer);rej(new Error('No se pudo conectar a DevTools'));};
    ws.onclose=e=>{clearTimeout(timer);rej(new Error(`DevTools cerró antes de conectar (${e.code})`));};
  });
  let id = 0;
  const pending = new Map();
  const problems = [];
  ws.onmessage = m => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { const p=pending.get(msg.id);clearTimeout(p.timer);p.resolve(msg);pending.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      problems.push(`EXCEPCIÓN: ${d.exception?.description || d.text} (línea ${d.lineNumber + 1})`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      problems.push(`console.${msg.params.type}: ${msg.params.args.map(a => a.value ?? a.description).join(' ')}`);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') problems.push(`LOG: ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
  };
  ws.onclose=e=>{
    for(const p of pending.values()) {clearTimeout(p.timer);p.reject(new Error(`DevTools cerró durante la sonda (${e.code})`));}
    pending.clear();
  };
  const send = (method, params = {}) => new Promise((resolve,reject) => {
    const i=++id;
    const timer=setTimeout(()=>{pending.delete(i);reject(new Error(`DevTools no respondió a ${method} en 30 s`));},30000);
    pending.set(i,{resolve,reject,timer});
    ws.send(JSON.stringify({id:i,method,params}));
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  // Fijar el viewport real: Chrome limita el ancho de ventana headless a unos 500 px.
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(wait);
  for (const expr of evals) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    const v = r.result?.exceptionDetails ? `ERROR ${r.result.exceptionDetails.exception?.description}` : JSON.stringify(r.result?.result?.value);
    console.log(`> ${expr}\n  ${v}`);
  }
  const [nFrames, every] = opt('frames', '1,0').split(',').map(Number);
  // --clip=<selector css> recorta cada captura a ese elemento; --scale=0.5 la reduce (para grabar un GIF ligero).
  let clip;
  if (opt('clip', '')) {
    const r = await send('Runtime.evaluate', { returnByValue: true,
      expression: `(() => { const b = document.querySelector(${JSON.stringify(opt('clip', ''))})?.getBoundingClientRect(); return b && { x: b.x, y: b.y, width: b.width, height: b.height }; })()` });
    const box = r.result?.result?.value;
    if (!box || !box.width) throw new Error(`--clip: no hay ningún elemento visible para ${opt('clip', '')}`);
    clip = { ...box, scale: Number(opt('scale', 1)) };
  }
  for (let k = 1; shot && k <= nFrames; k++) {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    const file = nFrames > 1 ? shot.replace(/(\.png)?$/i, `-${k}.png`) : shot;
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    console.log(`captura: ${file}`);
    if (k < nFrames) await sleep(every);
  }
  console.log(problems.length ? problems.join('\n') : 'Sin errores de consola ni excepciones.');
  ws.close();
  browser.kill();
  process.exit(problems.some(p => p.startsWith('EXCEPCIÓN')) ? 1 : 0);
})().catch(err => { console.error(err.message); browser.kill(); process.exit(2); });
