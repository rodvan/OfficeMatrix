// Informe de cierre. Los textos viven en public/i18n/<idioma>.json («cierre.*»); cierre-textos.js les da forma.
// La tarjeta habla el idioma del informe (el del pedido); sin informe, el de la interfaz.
let cierreView = null, cierreSequence = 0;

async function loadCierre() {
  const id = currentId, epoch = officeEpoch, seq = ++cierreSequence;
  cierreView = null;
  if (!id || current?.running) { renderReports(); return; }
  let data;
  try { data = await api(`/api/chats/${encodeURIComponent(id)}/cierre`); }
  catch (err) { data = { missing: true, error: err.message }; }
  // El informe puede ir en otro idioma que la interfaz: su diccionario se carga antes de pintarlo.
  if (data && !data.missing && typeof I18N !== 'undefined' && I18N.load) await I18N.load(idiomaTarjeta(data));
  if (seq !== cierreSequence || id !== currentId || epoch !== officeEpoch) return;
  cierreView = { id, epoch, data };
  renderReports();
}

function escapeHtml(s) {
  if (typeof esc === 'function') return esc(s);
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function idiomaTarjeta(c) {
  if (c && (c.idioma === 'en' || c.idioma === 'es')) return c.idioma;
  const lang = ((typeof I18N !== 'undefined' && I18N.lang) || (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang) || '').toLowerCase();
  return lang.startsWith('es') ? 'es' : 'en';
}

function packDe(c) {
  if (typeof CIERRE_TEXTOS === 'undefined') return null;
  return CIERRE_TEXTOS[idiomaTarjeta(c)] || CIERRE_TEXTOS.en;
}

function quienRedacto(c, u) {
  if (c.autor === 'plantilla+relator') {
    const nombre = c.relato?.autor;
    return nombre ? u.reescritoPor(nombre) : u.reescrito;
  }
  return c.relatoFallo || u.automatico;
}

function miniChartSvg(porRonda = [], minScore = 9, u, idioma) {
  if (!porRonda.length) return '';
  const punto = s => idioma === 'en' ? String(s) : String(s).replace('.', ',');
  const maxR = Math.max(...porRonda.map(r => r.ronda), 1);
  const w = 460, h = 90, padL = 36, padR = 24, padT = 16, padB = 22;
  const pw = w - padL - padR, ph = h - padT - padB;
  const xOf = r => maxR <= 1 ? padL + pw / 2 : padL + ((r - 1) / (maxR - 1)) * pw;
  const yOf = s => padT + ((10 - Math.max(0, Math.min(10, s))) / 10) * ph;

  const metaY = yOf(minScore);
  let svg = `<svg class="cierre-chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`;
  svg += `<line x1="${padL}" y1="${metaY}" x2="${w - padR}" y2="${metaY}" stroke="var(--dim, #667)" stroke-dasharray="3,3" stroke-width="1"/>`;
  svg += `<text x="${padL - 4}" y="${metaY + 3}" fill="var(--dim, #889)" font-size="9" text-anchor="end">${minScore}</text>`;

  const pts = [];
  porRonda.forEach(r => {
    const s = r.media ?? r.mediaParcial;
    if (s != null) pts.push({ x: xOf(r.ronda), y: yOf(s), score: s, ronda: r.ronda });
  });
  if (pts.length > 1) {
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    svg += `<path d="${d}" fill="none" stroke="var(--amber, #f59e0b)" stroke-width="2.5" stroke-linecap="round"/>`;
  }
  pts.forEach(p => {
    svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="var(--amber, #f59e0b)"/>`;
    svg += `<text x="${p.x.toFixed(1)}" y="${(p.y - 6).toFixed(1)}" fill="var(--text, #e2e8f0)" font-size="10" font-weight="bold" text-anchor="middle">${punto(p.score)}</text>`;
    svg += `<text x="${p.x.toFixed(1)}" y="${h - 4}" fill="var(--dim, #889)" font-size="9" text-anchor="middle">${u.ronda(p.ronda)}</text>`;
  });
  svg += '</svg>';
  return `<div class="cierre-chart-wrap"><div class="cierre-chart-header"><span>${u.chartTitulo(minScore)}</span><span class="cierre-chart-legend"><i style="background:var(--amber, #f59e0b)"></i> ${u.notaMedia}</span></div>${svg}</div>`;
}

function cierreHtml() {
  if (!current || current.running || cierreView?.id !== currentId || cierreView.epoch !== officeEpoch) return '';
  const c = cierreView.data;
  const esc = escapeHtml;
  const t = packDe(c.missing ? null : c);
  if (!t) return '';
  const u = t.ui;
  if (c.missing) {
    return `<section class="cierre-card"><header><h2>${esc(u.titulo)}</h2><p>${esc(u.missing)}</p></header><button class="btn primary" data-cierre-generate>${esc(u.generar)}</button></section>`;
  }
  const n = c.numeros || {}, e = c.ejecutado || {};
  const list = xs => xs?.length ? `<ul>${xs.map(x => `<li>${esc(typeof x === 'string' ? x : x.texto)}</li>`).join('')}</ul>` : `<p class="muted">${esc(u.nada)}</p>`;
  const evidence = xs => (xs || []).map(p => `<a href="#" class="cierre-chip" data-preview="${esc(p)}">📄 ${esc(p)}</a>`).join(' ');
  const section = (title, body, cls = '') => `<section class="cierre-sec ${cls}"><h3>${title}</h3>${body}</section>`;

  const semaforoClass = c.semaforo || 'gris';
  const luzNombre = u.luz[semaforoClass] || semaforoClass;
  const causaCorta = u.causa[c.causa] || luzNombre;
  const idioma = idiomaTarjeta(c);
  const punto = s => idioma === 'en' ? String(s) : String(s).replace('.', ',');

  const promoverIdx = (c.opciones || []).findIndex(o => o.id === 'promover');
  // «▶ Continuar hasta terminar» (o «Reanudar») va arriba, junto al veredicto: es lo primero que se busca si no terminó.
  const seguirIdx = (c.opciones || []).findIndex(o => o.disponible !== false && (o.id === 'reanudar' || (o.id === 'seguir' && o.etiqueta === t.continuar)));
  const seguirArriba = seguirIdx >= 0 ? `
    <div class="cierre-top-actions" data-cierre-zone>
      <button class="btn primary" data-cierre-action="${seguirIdx}">${esc(c.opciones[seguirIdx].etiqueta)}</button>
      <span class="cierre-action-desc"><span>${esc(c.opciones[seguirIdx].explica)}</span> <small class="cierre-action-cost">${esc(c.opciones[seguirIdx].coste)}</small></span>
      <div data-cierre-editor></div>
    </div>` : '';
  const bannerAplicado = (!c.aplicado && promoverIdx >= 0) ? `
    <div class="cierre-deploy-banner">
      <div class="cierre-deploy-info">
        <span class="cierre-tag warning">${esc(u.todaviaNo)}</span>
        <span>${esc(u.banner)}</span>
      </div>
      <button class="btn small primary" data-cierre-action="${promoverIdx}">${esc(u.verComo)}</button>
    </div>` : '';

  let modoHtml = '';
  if (c.modoDetalle) {
    if (c.modoDetalle.modo === 'editorial') {
      const temas = c.modoDetalle.temas?.length ? ` ${esc(u.temas(c.modoDetalle.temas.join(', ')))}` : '';
      const desc = c.modoDetalle.descartadas ? ` ${esc(u.descartadas(c.modoDetalle.descartadas))}` : '';
      modoHtml = `<div class="cierre-modo-card"><span class="cierre-modo-badge">${esc(u.editorial)}</span> <b>${esc(u.tandaEtiqueta)}</b> <b>${esc(c.modoDetalle.creadas ?? 0)}</b> ${esc(u.propuestas)}${desc}.${temas}</div>`;
    } else if (c.modoDetalle.borrador) {
      const modoClave = c.mision?.modo || c.modoDetalle?.modo;
      const modoNombre = u.modos[modoClave] || modoClave || u.modos.equipo;
      modoHtml = `<div class="cierre-modo-card"><span class="cierre-modo-badge">${esc(modoNombre)}</span> <b>${esc(u.textoElegido)}</b> ${esc(u.esLaLetra)} ${esc(c.modoDetalle.borrador)}, ${esc(u.enFinal)} ${esc(c.modoDetalle.autor || u.elEquipo)}.</div>`;
    }
  }

  const briefIcon = { hecho: '✔', parcial: '◐', falta: '✖', 'sin-confirmar': '○' };
  const briefClass = { hecho: 'status-hecho', parcial: 'status-parcial', falta: 'status-falta', 'sin-confirmar': 'status-sin' };
  const puntosBrief = c.brief?.puntos || [];
  const briefOpen = puntosBrief.length <= 8 ? 'open' : '';

  const bloqueosEntorno = c.noLogrado?.bloqueosEntorno || [];
  const objecionesProducto = c.noLogrado?.objeciones || [];
  const caidasAgentes = c.noLogrado?.caidas || [];
  const briefFalta = c.noLogrado?.brief || [];

  let noLogradoHtml = '';
  if (!objecionesProducto.length && !bloqueosEntorno.length && !caidasAgentes.length && !briefFalta.length) {
    noLogradoHtml = `<p class="muted">${esc(u.nadaPendiente)}</p>`;
  } else {
    noLogradoHtml = '<ul class="cierre-list-issues">' +
      objecionesProducto.map(o => `<li class="cierre-item-obj"><span class="cierre-tag-obj">#${esc(o.id)}</span> <b>${esc(o.texto)}</b> <small>(${esc(o.de)} · ${esc(u.estadoObj[o.estado] || o.estado)})</small></li>`).join('') +
      bloqueosEntorno.map(b => `<li class="cierre-item-env"><span class="cierre-tag-env">${esc(u.limiteEquipo)}</span> <b>${esc(b.texto)}</b> <small>(${esc(b.de)}: ${esc(u.limiteDetalle)})</small></li>`).join('') +
      caidasAgentes.map(x => `<li class="cierre-item-fail"><b>${esc(x.agente)}</b>: ${esc((x.kind && t.motivos[x.kind]) || String(x.motivo || '').toLowerCase())}. <small>${x.siguio ? esc(u.siguio) : esc(u.salio)}</small></li>`).join('') +
      briefFalta.map(p => `<li class="cierre-item-brief"><span class="status-falta">✖</span> ${esc(u.delPedido)} ${esc(p.texto)}</li>`).join('') +
      '</ul>';
  }

  const rawUrlHelper = typeof rawUrl === 'function' ? rawUrl : (id, p) => `/raw/${encodeURIComponent(id)}/${encodeURIComponent(p).replace(/%2F/g, '/')}`;
  const pruebasTxt = n.pruebasDefinidas?.antes == null && n.pruebasDefinidas?.despues == null
    ? u.pruebasNo
    : u.pruebasEscritas(n.pruebasDefinidas?.antes ?? '?', n.pruebasDefinidas?.despues ?? '?');
  const archivosVal = n.fuente === 'git' ? u.nuevosCambiados(n.nuevos ?? 0, n.modificados ?? 0) : u.tocados(n.tocados ?? (n.archivos || []).length);
  const archivosSub = n.fuente === 'git' ? u.borradosLinea(n.borrados ?? 0, n.sacados || 0) : u.sinHistorial;
  const lineasVal = n.fuente === 'git' ? u.lineas(n.lineasMas ?? 0, n.lineasMenos ?? 0) : u.noContar;
  const consumo = n.costeUsd != null ? u.dinero(n.costeUsd) : u.costeNo;
  const tokens = n.tokens != null ? u.consumo(n.tokens) : u.consumoNo;

  return `<article class="cierre-card" data-semaforo="${esc(semaforoClass)}">
    <header class="cierre-header">
      <div class="cierre-status-row">
        <span class="cierre-semaforo ${esc(semaforoClass)}">● ${esc(luzNombre)} · ${esc(causaCorta)}</span>
        <span class="cierre-author-tag">${esc(quienRedacto(c, u))}</span>
      </div>
      <h2 class="cierre-title">${esc(c.relato?.frase || c.veredicto?.frase || u.titulo)}</h2>
      ${c.resumenServidor ? `<p class="cierre-sub">${esc(c.resumenServidor)}</p>` : ''}
    </header>

    ${seguirArriba}
    ${bannerAplicado}
    ${modoHtml}

    <div class="cierre-kpi-grid">
      <div class="cierre-kpi-card">
        <div class="cierre-kpi-label">${esc(u.kpiArchivos)}</div>
        <div class="cierre-kpi-val">${esc(archivosVal)}</div>
        <div class="cierre-kpi-sub">${esc(archivosSub)}</div>
      </div>
      <div class="cierre-kpi-card">
        <div class="cierre-kpi-label">${esc(u.kpiLineas)}</div>
        <div class="cierre-kpi-val">${esc(lineasVal)}</div>
        <div class="cierre-kpi-sub">${esc(pruebasTxt)}</div>
      </div>
      <div class="cierre-kpi-card">
        <div class="cierre-kpi-label">${esc(u.kpiTiempo)}</div>
        <div class="cierre-kpi-val">${esc(u.minTurnos(n.minutos ?? 0, n.turnos ?? 0))}</div>
        <div class="cierre-kpi-sub">${esc(consumo)} · ${esc(tokens)}</div>
      </div>
      <div class="cierre-kpi-card">
        <div class="cierre-kpi-label">${esc(u.kpiDonde)}</div>
        <div class="cierre-kpi-val">${esc(c.aplicado ? u.enLaApp : u.soloMision)}</div>
        <div class="cierre-kpi-sub">${esc(c.aplicado ? u.yaAplicada : u.faltaPasarla)}</div>
      </div>
    </div>

    ${miniChartSvg(n.porRonda || [], c.mision?.minScore || 9, u, idioma)}
    ${(n.agentes || []).length ? `<p class="cierre-who">${esc(u.ultimaNota)} ${(n.agentes || []).map(a => `${esc(a.nombre)} ${a.ultimo?.nota == null ? esc(u.sinNota) : `${esc(punto(a.ultimo.nota))}/10`}`).join(' · ')}</p>` : ''}

    ${section(esc(u.queSeLogro), (c.logros || []).map(x => `<div class="cierre-logro-row"><p class="cierre-logro-text">${esc(x.texto)}</p><div class="cierre-evidence-row">${evidence(x.evidencia)}</div></div>`).join('') || `<p class="muted">${esc(u.nadieDejo)}</p>`)}

    <details class="cierre-details" ${briefOpen}>
      <summary class="cierre-summary"><b>${esc(u.pedidoTitulo)}</b> <span class="cierre-summary-hint">${esc(u.pedidoHint)}</span></summary>
      <div class="cierre-brief-list">
        ${puntosBrief.map(x => `
          <div class="cierre-brief-row">
            <span class="cierre-brief-icon ${briefClass[x.estado] || 'status-sin'}">${briefIcon[x.estado] || '○'}</span>
            <div class="cierre-brief-content">
              <span>${esc(x.texto)}</span>
              ${x.evidencia?.length ? `<div class="cierre-evidence-row">${evidence(x.evidencia)}</div>` : ''}
            </div>
          </div>`).join('') || `<p class="muted">${esc(u.sinPuntos)}</p>`}
      </div>
    </details>

    ${section(esc(u.queNo), noLogradoHtml)}

    <div class="cierre-columns">
      ${section(esc(u.otraRonda), list(c.pendientes?.otraRonda), 'cierre-col')}
      ${section(esc(u.tu), list(c.pendientes?.tu), 'cierre-col')}
    </div>

    ${section(esc(u.riesgos), list(c.riesgos))}

    ${section(esc(u.ejecutado),
      list((e.pruebas || []).map(x => ({ texto: u.pruebasDe(x.de, x.pasan, x.total) }))) +
      `<p class="cierre-ports">${esc(u.paginas)} <b>${esc((e.puertos || []).length ? (e.puertos || []).map(p => u.puerto(p)).join(', ') : u.ninguna)}</b></p>` +
      ((e.capturas || []).length ? `<div class="cierre-gallery">${e.capturas.map(p => `
        <a href="${esc(rawUrlHelper(currentId, p))}" target="_blank" rel="noopener" class="cierre-thumb">
          <img loading="lazy" src="${esc(rawUrlHelper(currentId, p))}" alt="${esc(p)}">
          <span class="cierre-thumb-caption">${esc(p)}</span>
        </a>`).join('')}</div>` : '')
    )}

    <details class="cierre-details">
      <summary class="cierre-summary"><b>${esc(u.notasTitulo)}</b></summary>
      <div class="cierre-agents-list">
        ${(n.agentes || []).map(a => `
          <div class="cierre-agent-row">
            <div class="cierre-agent-header"><b>${esc(a.nombre)}</b> <small>(${esc(a.minutos ?? 0)} min · ${a.tokens != null ? esc(u.consumo(a.tokens)) : esc(u.consumoNo)} · ${a.aprueba ? esc(u.aprueba) : esc(a.ultimo?.veredicto ? t.veredictoPalabra(a.ultimo.veredicto) : u.sinVeredicto)})</small></div>
            <div class="cierre-agent-scores">${Object.entries(a.notas || {}).map(([r, v]) => `<span class="cierre-score-chip">${esc(u.rondaNota(r, punto(v)))}</span>`).join(' ')}</div>
          </div>`).join('')}
      </div>
    </details>

    <section class="cierre-sec cierre-actions-sec" data-cierre-zone>
      <h3>${esc(u.opciones)}</h3>
      <div class="cierre-actions">
        ${(c.opciones || []).map((o, i) => `
          <div class="cierre-action-item ${o.id === 'continuar' || o.id === 'seguir' ? 'cierre-action-highlight' : ''}">
            <button class="btn ${o.id === 'continuar' || o.id === 'seguir' ? 'primary' : ''}" data-cierre-action="${i}" ${o.disponible === false ? 'disabled' : ''}>${esc(o.etiqueta)}</button>
            <div class="cierre-action-desc">
              <span>${esc(o.explica)}</span>
              <small class="cierre-action-cost">${esc(o.coste)}</small>
            </div>
          </div>`).join('')}
      </div>
      <div data-cierre-editor></div>
    </section>

    <details class="cierre-details">
      <summary class="cierre-summary"><b>${esc(u.archivosTitulo((n.archivos || []).length))}</b></summary>
      <div class="cierre-files-list">
        ${(n.archivos || []).map(f => `
          <div class="cierre-file-row">
            <span class="cierre-file-state ${esc(f.estado)}">${esc(u.archivo[f.estado] || f.estado)}</span>
            <span class="cierre-file-path">${evidence([f.ruta])}</span>
            <span class="cierre-file-lines">+${esc(f.mas ?? '?')} / −${esc(f.menos ?? '?')}</span>
          </div>`).join('')}
      </div>
    </details>
  </article>`;
}

document.addEventListener('click', async ev => {
  const btn = ev.target.closest('[data-cierre-action], [data-cierre-generate], [data-cierre-send]');
  if (!btn || cierreView?.id !== currentId || cierreView.epoch !== officeEpoch) return;
  const id = currentId, epoch = officeEpoch, snapshot = cierreView;
  const send = async (o, cuerpo) => withBusy(btn, async () => {
    try {
      await api(o.ruta, { method: o.metodo, ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}) });
      if (id !== currentId || epoch !== officeEpoch) return;
      await openChat(id, { keepLog: true });
      await loadChats();
    } catch (err) {
      toast(err.message, true);
    }
  });
  if (btn.hasAttribute('data-cierre-generate')) return send({ ruta: `/api/chats/${encodeURIComponent(id)}/cierre`, metodo: 'POST' });
  const i = Number(btn.dataset.cierreAction ?? btn.dataset.cierreSend), o = snapshot.data.opciones[i];
  if (!o || o.disponible === false) return;
  const u = packDe(snapshot.data)?.ui;
  if (o.guia) {
    (btn.closest('[data-cierre-zone]') || btn.closest('.cierre-card')).querySelector('[data-cierre-editor]').innerHTML = `
      <div class="cierre-guia-box">
        <h3>${escapeHtml(u.guiaTitulo)}</h3>
        <ol>${o.guia.pasos.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ol>
        ${o.guia.comandos.length ? `<p class="muted">${escapeHtml(u.guiaComandos)}</p>
        <pre class="cierre-code-block">${escapeHtml(o.guia.comandos.join('\n'))}</pre>` : ''}
      </div>`;
    return;
  }
  if (o.metodo === 'GET') { window.location.assign(o.ruta); return; }
  if (o.editable) {
    const editor = (btn.closest('[data-cierre-zone]') || btn.closest('.cierre-card')).querySelector('[data-cierre-editor]');
    if (!btn.hasAttribute('data-cierre-send')) {
      editor.innerHTML = `
        <div class="cierre-editor-box">
          <label class="cierre-editor-label">${escapeHtml(u.editorLabel)}
            <textarea class="field" data-cierre-text rows="5">${escapeHtml(o.cuerpo?.[o.editable] || '')}</textarea>
          </label>
          <button class="btn primary" data-cierre-send="${i}">${escapeHtml(u.enviar)}</button>
        </div>`;
      return;
    }
    const text = editor.querySelector('[data-cierre-text]').value.trim();
    if (!text) { toast(u.escribeAntes, true); return; }
    return send(o, { ...o.cuerpo, [o.editable]: text });
  }
  return send(o, o.cuerpo);
});
