// Un bot de Discord por oficina (docs/DISCORD.md). Cada oficina guarda su bot en <carpeta de la oficina>/discord.secreto.json
// (fuera de git) y ese bot SOLO habla con su oficina: el chat, las propuestas y los avisos que recibe son de ella.
// El bot de la Nave (el edificio) coordina: da el estado de todas y pasa una pregunta a la oficina que nombres, solo si esa
// oficina lo permite («Compartir con la Nave»).
// Quién puede hablarle: los ids de Discord de «usuarios autorizados». Con la lista vacía el bot no obedece a nadie y
// contesta a quien lo mencione con su id, para que el dueño lo copie en ⚙.
const fs = require('fs');
const path = require('path');
const discord = require('./discord');

const FILE = 'discord.secreto.json';
const MAX_CARDS = 5;              // propuestas nuevas anunciadas por actualización, como mucho
const MAX_IMAGE = 8 * 1024 * 1024;
const SETUP_EVERY_MS = 60 * 60 * 1000;
const LIGHT = { verde: '🟢', amarillo: '🟡', rojo: '🔴' };

const ids = v => [...new Set((Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/)).map(x => String(x).trim()).filter(discord.isSnowflake))].slice(0, 50);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

function normalizar(raw = {}, prev = {}) {
  const token = typeof raw.token === 'string' && raw.token.trim() ? raw.token.trim() : prev.token || null;
  if (token && !discord.isToken(token)) throw Object.assign(new Error('token'), { status: 400, codigo: 'token_invalido' });
  const avisos = { misiones: true, fallos: true, propuestas: true, ...(prev.avisos || {}), ...(raw.avisos && typeof raw.avisos === 'object' ? raw.avisos : {}) };
  for (const k of Object.keys(avisos)) if (!['misiones', 'fallos', 'propuestas'].includes(k) || typeof avisos[k] !== 'boolean') delete avisos[k];
  const canalAvisos = raw.canalAvisos !== undefined ? (discord.isSnowflake(raw.canalAvisos) ? String(raw.canalAvisos) : null) : prev.canalAvisos || null;
  return {
    token,
    activo: bool(raw.activo, prev.activo ?? true),
    canales: raw.canales !== undefined ? ids(raw.canales) : prev.canales || [],
    canalAvisos,
    usuarios: raw.usuarios !== undefined ? ids(raw.usuarios) : prev.usuarios || [],
    avisos,
    permitirNave: bool(raw.permitirNave, prev.permitirNave ?? true),
  };
}

function createDiscord({ oficinas, EDIFICIO = 'edificio', t = k => k, deps = {}, transport = {} }) {
  const bots = new Map(); // oficina -> { cfg, gw, rest, me, anunciadas:Set, avisoSetup:Map, estado }
  let factories = { gateway: discord.createGateway, rest: discord.createRest, ...transport };

  const fileOf = office => path.join(oficinas.dirs(office).root, FILE);
  function leer(office) {
    try { return normalizar(JSON.parse(fs.readFileSync(fileOf(office), 'utf8'))); } catch { return null; }
  }
  function escribir(office, cfg) {
    const dest = fileOf(office);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest + '.tmp', JSON.stringify(cfg, null, 2));
    fs.renameSync(dest + '.tmp', dest);
  }
  const nombreDe = office => oficinas.read(office)?.nombre || office;

  // Lo que ve el panel: nunca el token.
  function vista(office) {
    const cfg = leer(office);
    const b = bots.get(office);
    const appId = cfg?.token ? discord.appIdOf(cfg.token) : null;
    return {
      configurado: !!cfg?.token,
      activo: cfg?.activo ?? false,
      canales: cfg?.canales || [], canalAvisos: cfg?.canalAvisos || null, usuarios: cfg?.usuarios || [],
      avisos: cfg?.avisos || { misiones: true, fallos: true, propuestas: true },
      permitirNave: cfg?.permitirNave ?? true,
      estado: b?.gw?.state?.estado || 'desconectado', error: b?.gw?.state?.error || null,
      bot: b?.gw?.state?.usuario || null,
      invitacion: discord.inviteUrl(b?.me?.id || appId),
      nave: office === EDIFICIO,
    };
  }
  const secretos = office => { const c = leer(office); return c?.token ? [c.token] : []; };

  async function enviar(b, canal, texto, extra = {}, files) {
    const partes = discord.split(texto);
    let last = null;
    for (let i = 0; i < partes.length; i++) {
      const ultima = i === partes.length - 1;
      last = await b.rest.send(canal, { content: partes[i], ...(ultima ? extra : {}), ...(i === 0 && extra.message_reference ? { message_reference: extra.message_reference } : {}) }, ultima ? files : undefined);
    }
    return last;
  }

  // Las imágenes que manda el usuario (hasta 4, 10 MB cada una) se bajan del CDN de Discord y viajan al chat.
  async function bajarImagenes(b, attachments) {
    const out = [];
    for (const a of (attachments || []).filter(x => /^image\/(png|jpe?g|webp|gif)$/i.test(x.content_type || '') && x.size <= 10 * 1024 * 1024).slice(0, 4)) {
      try { out.push({ name: path.basename(String(a.filename || 'imagen.png')), type: a.content_type, data: await b.rest.descargar(a.url) }); } catch { /* una que no baja no corta el mensaje */ }
    }
    return out;
  }

  // ---------- Mensajes que llegan ----------
  async function alMensaje(office, b, d) {
    if (!d?.author || d.author.bot || d.webhook_id || d.author.id === b.me?.id) return;
    const dm = !d.guild_id;
    const yo = b.me?.id;
    // Al escribir @Nave, Discord también ofrece el rol del bot (se crea al invitarlo): mencionar ese rol cuenta igual.
    const rol = (d.mention_roles || []).some(r => b.roles.has(r));
    const menciona = dm || rol || (Array.isArray(d.mentions) && d.mentions.some(u => u.id === yo)) || new RegExp(`<@!?${yo}>`).test(d.content || '');
    if (!menciona) return;
    if (!dm && b.cfg.canales.length && !b.cfg.canales.includes(d.channel_id)) return;
    const ref = { message_reference: { message_id: d.id, fail_if_not_exists: false } };
    if (!b.cfg.usuarios.length) {
      // Modo de configuración: nadie está autorizado todavía. Se le dice su id (una vez por hora y persona).
      const last = b.avisoSetup.get(d.author.id) || 0;
      if (Date.now() - last < SETUP_EVERY_MS) return;
      b.avisoSetup.set(d.author.id, Date.now());
      return enviar(b, d.channel_id, t('discord.setup', { id: d.author.id, office: nombreDe(office) }), ref).catch(() => {});
    }
    if (!b.cfg.usuarios.includes(d.author.id)) return;
    // Mencionando el rol del bot (no al bot), el Gateway entrega el mensaje sin texto ni adjuntos: se lee por REST.
    if (!dm && !String(d.content || '').trim() && b.rest.mensaje) {
      try { const full = await b.rest.mensaje(d.channel_id, d.id); d = { ...d, content: full?.content || '', attachments: full?.attachments || [] }; } catch { /* sigue con lo que llegó */ }
    }
    const adjuntos = await bajarImagenes(b, d.attachments);
    const texto = String(d.content || '').replace(new RegExp(`<@!?${yo}>`, 'g'), '').replace(/<@&\d+>/g, m => (b.roles.has(m.slice(3, -1)) ? '' : m)).trim();
    if ((!texto && !adjuntos.length) || /^(ayuda|help|\?)$/i.test(texto)) return enviar(b, d.channel_id, t(office === EDIFICIO ? 'discord.helpShip' : 'discord.help', { office: nombreDe(office) }), ref);
    if (/^(propuestas|proposals)$/i.test(texto)) return anunciarPendientes(office, b, d.channel_id, { todas: true });

    let destino = office, pregunta = texto, prefijo = '';
    if (office === EDIFICIO) {
      if (/^(estado|status)$/i.test(texto)) return enviar(b, d.channel_id, deps.resumenNave ? deps.resumenNave() : t('discord.noStatus'), ref);
      const hit = oficinaNombrada(texto);
      if (hit) {
        const cfgOtra = leer(hit.id);
        if (cfgOtra && cfgOtra.permitirNave === false) return enviar(b, d.channel_id, t('discord.shipBlocked', { office: hit.nombre }), ref);
        destino = hit.id; pregunta = hit.resto; prefijo = `🏢 **${hit.nombre}**\n`;
      }
    }
    const typing = setInterval(() => b.rest.typing(d.channel_id), 8000);
    typing.unref?.();
    b.rest.typing(d.channel_id);
    try {
      const producidos = await deps.chat(destino, pregunta || t('discord.lookImage'), { autor: `Discord · ${d.author.global_name || d.author.username}`, adjuntos });
      const respuestas = (producidos || []).filter(m => m.autor?.tipo !== 'owner');
      if (!respuestas.length) return enviar(b, d.channel_id, t('discord.noReply'), ref);
      for (const m of respuestas) {
        const quien = m.autor?.nombre || '?';
        const cuerpo = m.fallo ? `⚠️ ${m.fallo.label || ''}${m.fallo.detail ? ` · ${m.fallo.detail}` : ''}` : m.texto;
        const files = (m.imagenes || []).map(i => ({ name: i.name, data: i.data, type: i.type }));
        await enviar(b, d.channel_id, `${prefijo}**${quien}**${m.autor?.puesto ? ` · ${m.autor.puesto}` : ''}\n${cuerpo}`, ref, files.length ? files : undefined);
      }
    } catch (err) {
      await enviar(b, d.channel_id, err.status === 409 ? t('discord.busy') : `⚠️ ${String(err.message).slice(0, 300)}`, ref).catch(() => {});
    } finally { clearInterval(typing); }
  }

  // «viralhunt: …», «ViralHunt, …» o «en viralhunt …»: la oficina nombrada al principio del texto.
  function oficinaNombrada(texto) {
    const lista = oficinas.list().filter(o => o.id !== EDIFICIO);
    const limpio = texto.replace(/^(en|in|a|to)\s+/i, '');
    for (const o of lista.sort((a, b) => b.nombre.length - a.nombre.length)) {
      for (const n of [o.nombre, o.id]) {
        const re = new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:,\\-–]?\\s+`, 'i');
        if (re.test(limpio)) return { id: o.id, nombre: o.nombre, resto: limpio.replace(re, '').trim() || limpio };
      }
    }
    return null;
  }

  // ---------- Propuestas: tarjeta con imagen y botones ----------
  function tarjeta(office, p) {
    const sem = p.verificacion?.semaforo || 'amarillo';
    const red = Object.keys(p.copy || {})[0];
    const fuentes = (p.verificacion?.fuentes || []).slice(0, 2).map(f => f.url).filter(Boolean);
    const lineas = [
      `📰 **${t('discord.card.title')}** · ${nombreDe(office)}`,
      `**${p.tema || ''}**`,
      p.hook ? `> ${p.hook}` : '',
      red ? `${red}: ${String(p.copy[red]).slice(0, 700)}` : '',
      `${LIGHT[sem] || '🟡'} ${t(`discord.light.${sem}`)}${fuentes.length ? ` · ${fuentes.join(' · ')}` : ''}`,
      p.lineaOrigen ? `↳ ${p.lineaOrigen}` : '',
      p.hora ? `🕘 ${p.hora}` : '',
    ].filter(Boolean);
    const botones = [
      { type: 2, style: 3, label: sem === 'rojo' ? t('discord.btn.blocked') : t('discord.btn.approve'), custom_id: `om:ap:${p.id}`, disabled: sem === 'rojo' },
      { type: 2, style: 4, label: t('discord.btn.reject'), custom_id: `om:re:${p.id}` },
    ];
    let files;
    const img = p.imagenes?.[0] && deps.archivo ? deps.archivo(office, p.id, p.imagenes[0]) : null;
    try { if (img && fs.statSync(img).size <= MAX_IMAGE) files = [{ name: path.basename(img), data: fs.readFileSync(img), type: /\.png$/i.test(img) ? 'image/png' : /\.webp$/i.test(img) ? 'image/webp' : 'image/jpeg' }]; } catch { files = undefined; }
    return { texto: lineas.join('\n'), extra: { components: [{ type: 1, components: botones }] }, files };
  }

  async function anunciarPendientes(office, b, canal, { todas = false } = {}) {
    if (!canal || !deps.propuestas) return;
    const pendientes = (deps.propuestas(office) || []).filter(p => p.estado === 'pendiente');
    const nuevas = todas ? pendientes : pendientes.filter(p => !b.anunciadas.has(p.id));
    if (todas && !nuevas.length) return enviar(b, canal, t('discord.noPending'));
    for (const p of nuevas.slice(0, MAX_CARDS)) {
      b.anunciadas.add(p.id);
      const c = tarjeta(office, p);
      await enviar(b, canal, c.texto, c.extra, c.files).catch(() => {});
    }
    for (const p of nuevas.slice(MAX_CARDS)) b.anunciadas.add(p.id);
  }

  async function alBoton(office, b, d) {
    if (d.type !== 3) return;
    const user = d.member?.user || d.user;
    const m = /^om:(ap|ay|re):(.+)$/.exec(d.data?.custom_id || '');
    if (!m) return;
    if (!user || !b.cfg.usuarios.includes(user.id)) return b.rest.interaction(d.id, d.token, 4, { content: t('discord.notAllowed'), flags: 64 }).catch(() => {});
    const [, accion, pid] = m;
    await b.rest.interaction(d.id, d.token, 6).catch(() => {}); // «recibido»: ViralHunt puede tardar más de 3 s
    const quien = user.global_name || user.username;
    const original = d.message?.content || '';
    try {
      if (accion === 're') {
        await deps.rechazar(office, pid, { nota: t('discord.rejectedNote', { who: quien }) });
        await b.rest.edit(d.channel_id, d.message.id, { content: `${original}\n\n❌ ${t('discord.rejectedBy', { who: quien })}`, components: [] });
      } else {
        const p = await deps.aprobar(office, pid, { nota: t('discord.approvedNote', { who: quien }), ...(accion === 'ay' ? { confirmarAmarillo: true } : {}) });
        const donde = p?.viralhunt?.donde ? ` → ViralHunt (${p.viralhunt.donde})` : '';
        await b.rest.edit(d.channel_id, d.message.id, { content: `${original}\n\n✅ ${t('discord.approvedBy', { who: quien })}${donde}`, components: [] });
      }
    } catch (err) {
      if (err.codigo === 'confirmar_amarillo') {
        await b.rest.edit(d.channel_id, d.message.id, { content: original, components: [{ type: 1, components: [
          { type: 2, style: 1, label: t('discord.btn.confirmYellow'), custom_id: `om:ay:${pid}` },
          { type: 2, style: 4, label: t('discord.btn.reject'), custom_id: `om:re:${pid}` },
        ] }] }).catch(() => {});
        return enviar(b, d.channel_id, t('discord.yellowAsk'), { message_reference: { message_id: d.message.id, fail_if_not_exists: false } }).catch(() => {});
      }
      await enviar(b, d.channel_id, `⚠️ ${String(err.message).slice(0, 300)}`, { message_reference: { message_id: d.message.id, fail_if_not_exists: false } }).catch(() => {});
    }
  }

  // ---------- Avisos (eventos del servidor) ----------
  function alEvento(ev) {
    if (!ev || !ev.type) return;
    const tareas = [];
    const nave = bots.get(EDIFICIO);
    if (ev.type === 'cycle-ended' || ev.type === 'agent-failed') {
      const office = ev.oficina || (deps.officeOfChat ? deps.officeOfChat(ev.chatId) : null);
      if (!office) return;
      const tipo = ev.type === 'cycle-ended' ? 'misiones' : 'fallos';
      const texto = ev.type === 'cycle-ended'
        ? t('discord.alert.ended', { title: ev.title || ev.chatId, outcome: ev.outcome || '?', summary: String(ev.summary || ev.cierre?.titular || '').slice(0, 400) })
        : t('discord.alert.failed', { title: ev.title || ev.chatId, name: ev.agentName || ev.agentId, why: ev.failure?.label || '?', left: (ev.remaining || []).join(', ') || '–' });
      const b = bots.get(office);
      if (b?.cfg.canalAvisos && b.cfg.avisos[tipo] !== false) tareas.push(enviar(b, b.cfg.canalAvisos, texto));
      // A la Nave solo llega el titular, y solo de oficinas que comparten con ella.
      if (office !== EDIFICIO && nave?.cfg.canalAvisos && nave.cfg.avisos[tipo] !== false && (leer(office)?.permitirNave ?? true)) {
        tareas.push(enviar(nave, nave.cfg.canalAvisos, `🏢 **${nombreDe(office)}** · ${texto.split('\n')[0]}`));
      }
    } else if (ev.type === 'editorial-updated' && ev.oficina) {
      const b = bots.get(ev.oficina);
      if (b?.cfg.canalAvisos && b.cfg.avisos.propuestas !== false) tareas.push(anunciarPendientes(ev.oficina, b, b.cfg.canalAvisos));
    }
    for (const p of tareas) p.catch(() => {});
  }

  // ---------- Ciclo de vida ----------
  function detener(office) {
    const b = bots.get(office);
    if (b) { try { b.gw.stop(); } catch { /* ya parado */ } bots.delete(office); }
  }
  function arrancar(office) {
    detener(office);
    const cfg = leer(office);
    if (!cfg?.token || !cfg.activo) return null;
    const b = { cfg, me: null, roles: new Set(), anunciadas: new Set(), avisoSetup: new Map() };
    // Lo que ya está pendiente al arrancar no se anuncia de nuevo (se pide con «propuestas»).
    try { for (const p of (deps.propuestas ? deps.propuestas(office) : []) || []) b.anunciadas.add(p.id); } catch { /* sin editorial */ }
    b.rest = factories.rest(cfg.token);
    b.gw = factories.gateway(cfg.token, {
      onDispatch: (tipo, d) => {
        if (tipo === 'READY') b.me = d.user;
        // El rol propio del bot en cada servidor (tags.bot_id): llega con GUILD_CREATE y con GUILD_ROLE_CREATE.
        else if (tipo === 'GUILD_CREATE') { for (const r of d.roles || []) if (r.tags?.bot_id && r.tags.bot_id === b.me?.id) b.roles.add(r.id); }
        else if (tipo === 'GUILD_ROLE_CREATE') { if (d.role?.tags?.bot_id && d.role.tags.bot_id === b.me?.id) b.roles.add(d.role.id); }
        else if (tipo === 'MESSAGE_CREATE') alMensaje(office, b, d).catch(() => {});
        else if (tipo === 'INTERACTION_CREATE') alBoton(office, b, d).catch(() => {});
      },
      onState: () => deps.onState?.(office),
    });
    bots.set(office, b);
    b.gw.start();
    return b;
  }
  function arrancarTodas() {
    for (const o of oficinas.list()) { try { arrancar(o.id); } catch { /* una oficina mal configurada no frena a las demás */ } }
  }
  function guardar(office, raw) {
    const cfg = normalizar(raw || {}, leer(office) || {});
    escribir(office, cfg);
    arrancar(office);
    return vista(office);
  }
  function borrar(office) {
    detener(office);
    try { fs.rmSync(fileOf(office), { force: true }); } catch { /* ya no estaba */ }
    return vista(office);
  }
  async function probar(office) {
    const b = bots.get(office);
    if (!b) throw Object.assign(new Error(t('discord.err.notRunning')), { status: 409 });
    const canal = b.cfg.canalAvisos || b.cfg.canales[0];
    if (!canal) throw Object.assign(new Error(t('discord.err.noChannel')), { status: 409 });
    await enviar(b, canal, t('discord.test', { office: nombreDe(office) }));
    return { ok: true };
  }

  return {
    vista, guardar, borrar, probar, arrancar, arrancarTodas, detener, alEvento, secretos, leer,
    detenerTodas: () => { for (const id of [...bots.keys()]) detener(id); },
    usarTransporte: tr => { factories = { ...factories, ...tr }; },
    _bots: bots, _oficinaNombrada: oficinaNombrada,
  };
}

module.exports = { createDiscord, normalizar, FILE };
