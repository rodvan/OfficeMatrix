// Demo aislada: node tests/helpers/editorial-demo.js [segundos=900]. App 4400, ViralHunt falso 4410–4499.
const fs = require('fs');
const path = require('path');
const { crearViralHuntFalso } = require('./viralhunt-falso');
async function main() {
  const root = path.resolve('.demo-editorial');
  fs.mkdirSync(root, { recursive: true });
  const home = fs.mkdtempSync(path.join(root, 'sesion-'));
  // Token de usar y tirar, solo para el simulador (un literal con forma de token lo denunciaría el escáner).
  const token = `vhk_${require('crypto').randomBytes(12).toString('hex')}`;
  const vh = await crearViralHuntFalso({ token });
  process.env.OFFICEMATRIX_HOME = home;
  process.env.OFFICEMATRIX_CONFIG = path.join(home, 'agents.json');
  process.env.OFFICEMATRIX_VIRALHUNT_URL = vh.url;
  process.env.EDITORIAL_DEMO = '1';
  process.env.EDITORIAL_IMAGEN = path.resolve('tests/fixtures/editorial/imagen-{n}.png');
  fs.writeFileSync(process.env.OFFICEMATRIX_CONFIG, JSON.stringify({ agents: ['claude', 'grok'].map((id, i) => ({ id, name: id, role: i ? 'Investigación e imagen' : 'Hooks y verificación', color: i ? '#e0a84f' : '#b48cff', cmd: 'node', stream: 'text', args: [path.join(__dirname, 'agente-editorial.js'), id, '{prompt}', 'delay=600'] })), maxRounds: 2, autoMaxRounds: 2, minScore: 9, turnTimeoutMinutes: 1 }));
  const { server, running } = require('../../server');
  await new Promise(resolve => server.listen(4400, '127.0.0.1', resolve));
  const call = async (url, method = 'GET', body) => {
    const res = await fetch(`http://127.0.0.1:4400${url}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json(); if (!res.ok) throw new Error(JSON.stringify(data)); return data;
  };
  const office = await call('/api/oficinas', 'POST', { nombre: 'Faro Curioso · Demo', equipo: ['claude', 'grok'], color: '#e0a84f' });
  const base = `/api/oficinas/${office.id}`;
  await call(`${base}/viralhunt`, 'PUT', { token });
  await call(`${base}/editorial`, 'PUT', { marca: { nombre: 'Faro Curioso', tono: 'Cercano, claro y curioso' }, modo: 'relevo', equipo: [{ id: 'grok', rol: 'Investigación e imagen' }, { id: 'claude', rol: 'Hooks y verificación' }], propuestasPorTanda: 3, nichos: ['neurociencia'], destino: 'borrador', viralhunt: { proyecto: 'Faro Curioso', proyectoId: 1, cuentas: [12, 15] } });
  const tanda = await call(`${base}/editorial/tanda`, 'POST', {});
  const start = Date.now();
  while (running.has(tanda.id) && Date.now() - start < 30000) await new Promise(r => setTimeout(r, 100));
  const propuestas = await call(`${base}/editorial/propuestas`);
  if (propuestas.length !== 3 || propuestas.some(p => p.estado !== 'pendiente')) throw new Error('La demo no cosechó tres propuestas pendientes');
  fs.writeFileSync(path.join(root, 'demo.json'), JSON.stringify({ home, office: office.id, url: `http://127.0.0.1:4400/#s=${office.id}&tab=editorial`, propuestas: propuestas.map(p => p.id) }, null, 2));
  console.log(`LISTA http://127.0.0.1:4400/#s=${office.id}&tab=editorial (API simulada: ${vh.port})`);
  const close = async () => { server.close(); server.closeAllConnections?.(); await vh.close(); process.exit(0); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
  setTimeout(close, (Number(process.argv[2]) || 900) * 1000).unref();
}
main().catch(err => { console.error(err); process.exit(1); });
