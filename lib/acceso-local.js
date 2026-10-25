// Cookie de panel para cuando la API local deja de ser «solo este usuario».
// Apagada por defecto: server.js la exige solo con OFFICEMATRIX_COOKIE=1.
// La frontera (S1F) no se activa con esto; curl sin cookie deja de leer /api y /raw.
'use strict';
const crypto = require('node:crypto');

function crear(secret = crypto.randomBytes(32).toString('hex')) {
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('COOKIE_INVALIDA');
  return { name: 'om_panel', secret };
}
function cabecera(panel) {
  return `${panel.name}=${panel.secret}; HttpOnly; SameSite=Strict; Path=/`;
}
function acepta(panel, req) {
  if (!panel) return true;
  const raw = String(req?.headers?.cookie || '');
  return raw.split(';').some(part => part.trim() === `${panel.name}=${panel.secret}`);
}
module.exports = { crear, cabecera, acepta };
