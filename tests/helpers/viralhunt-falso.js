// ViralHunt simulado para las pruebas y la demo de la Editorial continua. Nunca se llama al ViralHunt real.
// Escucha en el primer puerto libre de 4410-4499 (4400 es el de la demo de la app; 4321-4323 nunca).
// Responde como la API v1 de la skill (§0, §2, §3, §4, §5, §6) lo justo para la editorial y apunta cada petición.
//   const vh = await crearViralHuntFalso({ token, mustDraft: 'role' });  vh.url → para OFFICEMATRIX_VIRALHUNT_URL
//   node tests/helpers/viralhunt-falso.js <token>   (suelto, para la demo)
const http = require('http');

function crearViralHuntFalso({ token, mustDraft = '', reviewStageReady = true } = {}) {
  const pedidos = [];
  const cfg = { mustDraft, reviewStageReady }; // se cambia en caliente desde la prueba (vh.cfg.mustDraft = 'role')
  let nextId = 1000;
  const ok = (res, data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: true, data })); };
  const fail = (res, status, code, message) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: false, error: { code, message } })); };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://127.0.0.1');
      const ep = url.pathname.replace(/^.*\//, '');
      const action = url.searchParams.get('action');
      let json = null;
      if (/json/.test(req.headers['content-type'] || '')) { try { json = JSON.parse(raw.toString('utf8')); } catch { json = null; } }
      const p = { method: req.method, ep, action, query: Object.fromEntries(url.searchParams), headers: req.headers, json, bytes: raw.length, multipart: /multipart\/form-data/.test(req.headers['content-type'] || '') };
      pedidos.push(p);
      if (req.headers.authorization !== `Bearer ${token}`) return fail(res, 401, 'invalid_key', 'Token missing or revoked');
      if (ep === 'account.php') return ok(res, { plan: { key: 'creator', can_publish: true }, permissions: { group: 'writer' }, daily_queries: null, credits: { balance: 50 } });
      if (ep === 'trending.php') {
        const src = url.searchParams.get('source');
        return ok(res, { posts: [1, 2, 3].map(i => ({
          title: `Post viral ${i} de ${src} sobre ${url.searchParams.get('keyword') || 'todo'}`, post_url: `https://example.com/${src}/${i}`,
          author_name: `@cuenta${i}`, metrics: { likes: 1000 * i, comments: 50 * i, shares: 20 * i, views: 90000 * i, saves: null, engagement: 1070 * i },
          growth_24h: { from: 100, to: 100 + 900 * i, delta: 900 * i, percent: 900 * i, hours: 9, samples: 3, full_window: false }, created_at: '2026-10-24T08:00:00Z',
        })) });
      }
      if (ep === 'best-time.php') return ok(res, { confidence: 'high', best_slots: [{ weekday: 'Sat', hour: 10, posts: 800, avg_engagement: 1200, hit_rate_pct: 14 }], today: { best_hours: [10, 18] }, sample: { posts: 12400, window: '365d' } });
      if (ep === 'schedule.php' && action === 'targets') {
        return ok(res, { project: { id: 1, name: 'Faro Curioso', timezone: 'America/Mexico_City' }, projects: [{ id: 1, name: 'Faro Curioso', lang: 'es', networks: ['instagram', 'x'], account_count: 2 }],
          accounts: [{ account_id: 12, network: 'instagram', name: '@faro_curioso', text_limit: 2200 }, { account_id: 15, network: 'x', name: '@faro_curioso_x', text_limit: 280 }],
          needs_reconnect: [], must_draft: cfg.mustDraft, review_stage_ready: cfg.reviewStageReady });
      }
      if (ep === 'schedule.php' && action === 'upload') {
        if (!p.multipart || !raw.length) return fail(res, 400, 'upload_not_parsed', 'No file');
        return ok(res, { url: `https://cdn.example.com/subida-${nextId}.png` });
      }
      if (ep === 'schedule.php' && action === 'create') {
        const b = json || {};
        if (!b.body && !(b.media || []).length) return fail(res, 422, 'validation_error', 'body or media required');
        const id = nextId++;
        const stage = b.draft ? 'draft' : cfg.mustDraft ? 'review' : 'scheduled';
        return ok(res, { id, status: stage === 'scheduled' ? 'scheduled' : stage, stage, scheduled_at: b.scheduled_at || null, targets: [], results: {}, warnings: [],
          review_url: `https://viralhunt.io/tool/schedule/?post=${id}`, url: `/schedule/?post=${id}`, card_id: 77 });
      }
      return fail(res, 404, 'not_found', `Endpoint simulado desconocido: ${ep} ${action || ''}`);
    });
  });

  const listen = port => new Promise((resolve, reject) => {
    server.once('error', err => (err.code === 'EADDRINUSE' && port < 4499 ? resolve(listen(port + 1)) : reject(err)));
    server.listen(port, '127.0.0.1', () => resolve(port));
  });
  return listen(4410).then(port => ({
    url: `http://127.0.0.1:${port}/tool/api/v1/`, port, pedidos, server, cfg,
    close: () => new Promise(r => { server.close(() => r()); server.closeAllConnections?.(); }),
  }));
}

if (require.main === module) {
  const token = process.argv[2];
  if (!token) { console.error('Uso: node tests/helpers/viralhunt-falso.js <token>'); process.exit(1); }
  crearViralHuntFalso({ token, mustDraft: process.env.VH_MUST_DRAFT || '' }).then(vh => console.log(`ViralHunt simulado en ${vh.url}`));
}

module.exports = { crearViralHuntFalso };
