// Acceso desde internet por un túnel de Cloudflare con Cloudflare Access delante (p. ej. office.tudominio.com → lan.js).
// Segundo candado: aunque alguien quite por error la aplicación de Access en Cloudflare, lan.js exige en cada petición que
// llega por el túnel la firma de Access (cabecera Cf-Access-Jwt-Assertion o cookie CF_Authorization), verificada con las
// llaves públicas del equipo de Zero Trust. Sin configuración, todo lo que llega por el túnel se rechaza (falla cerrado).
// Configuración (fuera de git): acceso-remoto.json en la carpeta de datos, { "teamDomain": "x.cloudflareaccess.com",
// "aud": "<Application Audience tag>" }, o las variables OFFICEMATRIX_CF_TEAM y OFFICEMATRIX_CF_AUD.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CERTS_TTL_MS = 60 * 60 * 1000;

function loadConfig(dataDir, env = process.env) {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(dataDir, 'acceso-remoto.json'), 'utf8')); } catch { /* sin archivo */ }
  const teamDomain = String(env.OFFICEMATRIX_CF_TEAM || file.teamDomain || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const aud = String(env.OFFICEMATRIX_CF_AUD || file.aud || '').trim();
  return teamDomain && aud ? { teamDomain, aud } : null;
}

// Llega por el túnel si cloudflared lo reenvía (sale de esta misma máquina) o trae las cabeceras de Cloudflare.
// Desde el celular en casa la petición viene de una IP de la red y sin esas cabeceras.
function viaTunnel(req) {
  const ip = String(req.socket?.remoteAddress || '');
  const loopback = ip === '::1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.');
  return loopback || Boolean(req.headers['cf-ray'] || req.headers['cf-connecting-ip'] || req.headers['cf-access-jwt-assertion']);
}

function tokenOf(req) {
  const h = req.headers['cf-access-jwt-assertion'];
  if (h) return String(h);
  const c = (req.headers.cookie || '').split(';').map(s => s.trim().split('=')).find(([k]) => k === 'CF_Authorization');
  return c ? c.slice(1).join('=') : '';
}

const b64 = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function createVerifier(config, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  let certs = null, fetchedAt = 0, pending = null;
  const certsUrl = `https://${config.teamDomain}/cdn-cgi/access/certs`;

  async function keys(force = false) {
    if (!force && certs && now() - fetchedAt < CERTS_TTL_MS) return certs;
    if (!pending) {
      pending = (async () => {
        const r = await fetchImpl(certsUrl);
        if (!r.ok) throw new Error(`certs ${r.status}`);
        const body = await r.json();
        certs = new Map((body.keys || []).map(k => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })]));
        fetchedAt = now();
        return certs;
      })().finally(() => { pending = null; });
    }
    return pending;
  }

  // Devuelve { ok: true, email } o { ok: false, reason }.
  async function verify(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return { ok: false, reason: 'no Cloudflare Access signature' };
    let header, payload;
    try { header = JSON.parse(b64(parts[0])); payload = JSON.parse(b64(parts[1])); } catch { return { ok: false, reason: 'unreadable signature' }; }
    if (header.alg !== 'RS256') return { ok: false, reason: 'algorithm not allowed' };
    let set;
    try {
      set = await keys();
      if (!set.has(header.kid)) set = await keys(true);
    } catch (e) { return { ok: false, reason: `could not read the Access keys (${e.message})` }; }
    const key = set.get(header.kid);
    if (!key) return { ok: false, reason: 'unknown key' };
    const valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, b64(parts[2]));
    if (!valid) return { ok: false, reason: 'invalid signature' };
    const t = Math.floor(now() / 1000);
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(config.aud)) return { ok: false, reason: 'signature belongs to another application' };
    if (payload.iss !== `https://${config.teamDomain}`) return { ok: false, reason: 'different issuer' };
    if (typeof payload.exp !== 'number' || payload.exp < t - 30) return { ok: false, reason: 'Access session expired' };
    if (typeof payload.nbf === 'number' && payload.nbf > t + 30) return { ok: false, reason: 'signature not valid yet' };
    return { ok: true, email: payload.email || '' };
  }

  return { verify };
}

module.exports = { loadConfig, viaTunnel, tokenOf, createVerifier };
