// Bandeja por oficina y dashboard editorial v2 (docs/BRIEF-EDITORIAL-V2.md, docs/EDITORIAL-V2.md).
// Funciona tanto integrado en la app (tab-editorial) como en la página propia (/editorial).
let editorialData = null, editorialSeq = 0, editorialEditing = null, decisionEditing = null, yellowConfirmProposal = null;
let currentEdTab = 'inbox', currentEdOffice = null;
// En la página propia (/editorial) no se carga app.js: sin su api() se usa esta, igual a la de app.js.
const edApi = (url, options = {}) => (typeof api === 'function' ? api(url, options) : fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options })
  .then(async res => { const data = await res.json().catch(() => ({})); if (!res.ok) throw new Error(data.error || res.statusText); return data; }));
const edBase = id => `/api/oficinas/${encodeURIComponent(id)}`;
const ED_STATES = ['pendiente', 'en-cambios', 'aprobada', 'rechazada', 'descartada'];
const edLink = value => { try { const u = new URL(value, location.origin); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const edDate = (value, zona) => value ? new Date(value).toLocaleString((typeof I18N !== 'undefined' && I18N.lang === 'es') ? 'es-MX' : 'en-US', { timeZone: zona || 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' }) : (typeof t === 'function' ? t('ed.noTime') : '–');
const safeEsc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const getEsc = () => (typeof esc === 'function' ? esc : (typeof globalThis.esc === 'function' ? globalThis.esc : safeEsc));

function edToast(msg) {
  const el = typeof $ === 'function' ? $('edToast') : (typeof document !== 'undefined' ? document.getElementById('edToast') : null);
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.hidden = true; }, 3200);
}

// Renderizado de tarjeta de propuesta (compatible con v1 y v2)
function edCard(p, r, office) {
  const e = getEsc();
  const file = name => `${edBase(office)}/editorial/propuestas/${encodeURIComponent(p.id)}/archivo/${encodeURIComponent(name)}`;
  const source = edLink(p.fuente?.url), result = edLink(p.viralhunt?.url);
  const destino = { borrador: t('ed.destDraftCard'), revision: t('ed.destReviewCard'), agendado: t('ed.destScheduledCard') };
  const semaforo = p.verificacion?.semaforo || 'amarillo';
  const lightClass = semaforo === 'verde' ? 'ed-light-verde' : semaforo === 'rojo' ? 'ed-light-rojo' : 'ed-light-amarillo';
  const lightLabel = semaforo === 'verde' ? t('ed.light.green') : semaforo === 'rojo' ? t('ed.light.red') : t('ed.light.yellow');
  const verifierText = p.verificacion?.verificador ? t('ed.light.verifier', { name: p.verificacion.verificador }) : t('ed.light.noVerifier');
  const fuentes = (p.verificacion?.fuentes || []).filter(f => f && f.url && f.url !== p.fuente?.url);

  return `<article class="ed-card" data-proposal="${e(p.id)}">
    ${p.imagenes?.length ? `<img class="ed-image" src="${file(p.imagenes[0])}" alt="${e(p.hook)}" loading="lazy">` : `<div class="ed-no-image">${t('ed.noImage')}</div>`}
    <div class="ed-card-body">
      <div class="ed-meta">
        <span class="ed-state">${e(ED_STATES.includes(p.estado) ? t(`ed.state.${p.estado}`) : p.estado)}</span>
        <span class="ed-light-badge ${lightClass}" title="${e(lightLabel)}">● ${e(lightLabel)}</span>
        <span>v${p.version || 1}</span>
      </div>
      <h3>${e(p.hook)}</h3>
      <p class="muted">${e(p.tema || '–')} · ${e(p.porQue || '')}</p>
      ${p.lineaOrigen ? `<div class="ed-chain-box">${e(p.lineaOrigen)}${p.autor ? `<small>${e(p.autor)}</small>` : ''}</div>` : p.autor ? `<p class="ed-verifier-line">${e(p.autor)}</p>` : ''}
      ${Object.entries(p.copy || {}).map(([red, copy]) => `<details class="ed-copy" open><summary>${e(red)}</summary><p>${e(copy)}</p></details>`).join('')}
      <p class="ed-tags">${(p.hashtags || []).map(tag => `#${e(tag.replace(/^#/, ''))}`).join(' ')}</p>
      <div class="ed-verifier-line"><small>${e(verifierText)}</small>${p.verificacion?.nota ? `<br><small class="muted">${e(p.verificacion.nota)}</small>` : ''}</div>
      ${source || fuentes.length ? `<div class="ed-sources-compact">
        ${source ? `<div class="ed-source-item"><a href="${e(source)}" target="_blank" rel="noopener noreferrer">↗ ${e(p.fuente?.nombre || t('ed.sourceLabel'))}</a><span class="ed-source-kind">${e(Object.entries(p.fuente?.metricas || {}).map(([k, v]) => `${k}:${v}`).join(' ') || t('ed.light.secondary'))}</span></div>` : ''}
        ${fuentes.map(f => { const u = edLink(f.url); return u ? `<div class="ed-source-item"><a href="${e(u)}" target="_blank" rel="noopener noreferrer">↗ ${e(f.titulo || f.url)}</a><span class="ed-source-kind">${e(f.tipo === 'primaria' ? t('ed.light.primary') : t('ed.light.secondary'))}</span></div>` : ''; }).join('')}
      </div>` : `<p>↗ ${t('ed.noSource')}</p>`}
      <p>◷ ${e(edDate(p.hora, r?.zona))}<br><small class="muted">${e(r?.zona || 'UTC')} · ${(p.idiomas || []).map(e).join(', ')}</small>
        ${p.estado === 'pendiente' ? ` · <button type="button" class="btn small ghost" data-ed-change-hour="${e(p.id)}" style="padding:1px 6px;font-size:11px;">${t('ed.cal.changeHour')}</button>` : ''}
      </p>
      ${p.motivoDescarte ? `<p class="ed-notice">${e(p.motivoDescarte)}</p>` : ''}
      ${p.estado === 'en-cambios' ? `<p role="status">${t('ed.adjusting', { note: e(p.cambiosPedidos?.nota || '') })}</p>` : ''}
      ${p.viralhunt ? `<p class="ed-result">✓ ${e(destino[p.viralhunt.donde] || p.viralhunt.donde)}${result ? ` · <a href="${e(result)}" target="_blank" rel="noopener noreferrer">${t('ed.openPost')}</a>` : ''}</p>` : ''}
      ${p.estado === 'pendiente' ? `<div class="ed-actions">
        <button class="btn" data-ed-action="aprobar" data-semaforo="${e(semaforo)}">${t('ed.btnApprove')}</button>
        <button class="btn ghost" data-ed-action="cambios">${t('ed.btnChanges')}</button>
        <button class="btn ghost" data-ed-action="rechazar">${t('ed.btnReject')}</button>
      </div>` : ''}
    </div>
  </article>`;
}

// Carga de la bandeja en el tab-editorial de la app principal
async function loadEditorial() {
  const seq = ++editorialSeq;
  const epoch = typeof officeEpoch !== 'undefined' ? officeEpoch : 0;
  const office = typeof oficina !== 'undefined' ? oficina : currentEdOffice;
  const box = typeof $ === 'function' ? $('tab-editorial') : (typeof document !== 'undefined' ? document.getElementById('tab-editorial') : null);
  if (!box) return;
  if (!office || office === 'edificio') {
    editorialData = null;
    box.innerHTML = `<p class="muted">${t('ed.chooseOffice')}</p>`;
    return;
  }
  const e = getEsc();
  try {
    const [data, propuestas] = await Promise.all([
      edApi(`${edBase(office)}/editorial`),
      edApi(`${edBase(office)}/editorial/propuestas`)
    ]);
    if (seq !== editorialSeq || (typeof officeEpoch !== 'undefined' && epoch !== officeEpoch) || (typeof oficina !== 'undefined' && office !== oficina)) return;
    editorialData = { ...data, propuestas, office };
    const r = data.regla;
    const destText = r.destino === 'agendar' ? t('ed.destSchedule') : t('ed.destDraft');
    const statusText = data.abierta ? t('ed.statusRunning') : r.activa ? t('ed.statusActive') : t('ed.statusPaused');
    box.innerHTML = `<header class="ed-toolbar"><div><h2>${t('ed.proposals')} <small>${t('ed.toDecide', { count: propuestas.filter(p => p.estado === 'pendiente').length })}</small></h2>
      <p>${e(r.marca?.nombre || (typeof officeNow === 'function' ? officeNow().nombre : office))} · ${e(statusText)} · ${e(r.zona)}</p>
      <p>${t('ed.infoLine', { hours: (r.horas || []).map(e).join(' / '), dest: e(destText) })}</p></div>
      <div class="ed-actions">
        <a href="/editorial?oficina=${encodeURIComponent(office)}" class="btn ghost" style="text-decoration:none">${t('ed.btnOpenFull')}</a>
        <button class="btn ghost" data-ed-config>${t('ed.btnConfig')}</button>
        <button class="btn" data-ed-tanda ${!data.configurada || data.abierta ? 'disabled' : ''}>${t('ed.btnNewBatch')}</button>
      </div></header>
      ${!data.viralhunt?.configurado ? `<p class="ed-notice">${t('ed.connectNotice')}</p>` : ''}
      ${propuestas.length ? `<div class="ed-grid">${propuestas.map(p => edCard(p, r, office)).join('')}</div>` : `<div class="ed-empty"><h3>${t('ed.emptyTitle')}</h3><p>${t('ed.emptyText')}</p></div>`}`;
  } catch (err) {
    if (seq === editorialSeq && (typeof officeEpoch === 'undefined' || epoch === officeEpoch)) {
      box.textContent = t('ed.loadError', { err: err.message });
    }
  }
}

// Configuración general de la regla
async function openEditorialConfig() {
  const office = typeof oficina !== 'undefined' ? oficina : currentEdOffice;
  const epoch = typeof officeEpoch !== 'undefined' ? officeEpoch : 0;
  await loadEditorial();
  if ((typeof oficina !== 'undefined' && office !== oficina) || (typeof officeEpoch !== 'undefined' && epoch !== officeEpoch) || !editorialData || editorialData.office !== office) return;
  editorialEditing = { office, epoch };
  const r = editorialData.regla;
  const e = getEsc();
  const field = (label, name, value, type = 'text') => `<label>${label}<input class="field" name="${name}" type="${type}" value="${e(value)}" ${type === 'number' ? 'min="1" max="10"' : ''}></label>`;
  const fields = typeof $ === 'function' ? $('edFields') : (typeof document !== 'undefined' ? document.getElementById('edFields') : null);
  if (fields) {
    fields.innerHTML = `<label><input type="checkbox" name="activa" ${r.activa ? 'checked' : ''}> ${t('ed.activateBatches')}</label>
      ${field(t('ed.fieldBrand'), 'marca', r.marca?.nombre || '')}${field(t('ed.fieldTone'), 'tono', r.marca?.tono || '')}${field(t('ed.fieldLanguages'), 'idiomas', (r.idiomas || []).join(', '))}${field(t('ed.fieldNiches'), 'nichos', (r.nichos || []).join(', '))}
      ${field(t('ed.fieldSources'), 'fuentes', (r.fuentes || []).join(', '))}${field(t('ed.fieldNetworks'), 'redes', (r.redes || []).join(', '))}
      ${field(t('ed.fieldProposals'), 'cantidad', r.propuestasPorTanda || 3, 'number')}${field(t('ed.fieldTimezone'), 'zona', r.zona || 'UTC')}${field(t('ed.fieldMorning'), 'manana', r.horas?.[0] || '09:00', 'time')}${field(t('ed.fieldAfternoon'), 'tarde', r.horas?.[1] || '17:00', 'time')}
      <label>${t('ed.fieldMode')} <select class="field" name="modo"><option value="consejo">${t('ed.modeCouncil')}</option><option value="relevo">${t('ed.modeRelay')}</option></select></label>
      <label>${t('ed.fieldOnApprove')} <select class="field" name="destino"><option value="borrador">${t('ed.optDraft')}</option><option value="agendar">${t('ed.optSchedule')}</option></select></label>
      ${field(t('ed.fieldVhProject'), 'proyecto', r.viralhunt?.proyecto || '')}${field(t('ed.fieldVhProjectId'), 'proyectoId', r.viralhunt?.proyectoId || '')}${field(t('ed.fieldVhAccounts'), 'cuentas', (r.viralhunt?.cuentas || []).join(', '))}
      <label class="ed-wide">${t('ed.fieldTeam')}<textarea class="field" rows="4" name="equipo">${e((r.equipo || []).map(eq => `${eq.id} | ${eq.rol}`).join('\n'))}</textarea></label>
      ${field(t('ed.fieldDoNotPublish'), 'noPublicar', (r.reglas?.noPublicar || []).join(', '))}<label><input name="fuente" type="checkbox" ${r.reglas?.fuenteObligatoria ? 'checked' : ''}> ${t('ed.fieldSourceMandatory')}</label><p>${t('ed.ruleNote')}</p>`;
  }
  const form = typeof $ === 'function' ? $('editorialForm') : (typeof document !== 'undefined' ? document.getElementById('editorialForm') : null);
  if (form?.elements?.modo) form.elements.modo.value = r.modo || 'consejo';
  if (form?.elements?.destino) form.elements.destino.value = r.destino || 'borrador';
  const edTok = typeof $ === 'function' ? $('edToken') : (typeof document !== 'undefined' ? document.getElementById('edToken') : null);
  if (edTok) edTok.value = '';
  const edHint = typeof $ === 'function' ? $('edConfigHint') : (typeof document !== 'undefined' ? document.getElementById('edConfigHint') : null);
  if (edHint) edHint.textContent = '';
  const edTokState = typeof $ === 'function' ? $('edTokenState') : (typeof document !== 'undefined' ? document.getElementById('edTokenState') : null);
  if (edTokState) edTokState.textContent = editorialData.viralhunt?.configurado ? t('ed.tokenStateConfigured') : t('ed.tokenStateEmpty');
  const dlg = typeof $ === 'function' ? $('editorialDialog') : (typeof document !== 'undefined' ? document.getElementById('editorialDialog') : null);
  if (dlg?.showModal) dlg.showModal();
}

const edStillEditing = ctx => ctx && ctx.office === (typeof oficina !== 'undefined' ? oficina : currentEdOffice) && ctx === editorialEditing;

// Diálogos clásicos inyectados para el funcionamiento en index.html
if (typeof document !== 'undefined' && document.body && typeof document.body.insertAdjacentHTML === 'function') {
  document.body.insertAdjacentHTML('beforeend', `<dialog id="editorialDialog" class="viewer tpl-dialog"><header><span data-i18n="ed.dialogTitle">⚙ EDITORIAL</span><button class="btn ghost" data-close aria-label="Cerrar" data-i18n-aria-label="ui.close">✕</button></header>
  <form id="editorialForm" class="tpl-form ed-form"><p id="edConfigHint" role="status"></p><div id="edFields" class="ed-fields"></div>
  <fieldset><legend data-i18n="ed.vhConnectionLegend">ViralHunt · office connection</legend><p id="edTokenState"></p><label><span data-i18n="ed.writerTokenLabel">Writer token</span> <input id="edToken" class="field" type="password" autocomplete="new-password" data-i18n-placeholder="ed.tokenPlaceholder" placeholder="Paste new token"></label>
  <div class="ed-actions"><button type="button" class="btn ghost" id="edTokenSave">${t('ed.btnSaveToken')}</button><button type="button" class="btn ghost" id="edTokenTest">${t('ed.btnTestToken')}</button><button type="button" class="btn ghost" id="edTokenDelete">${t('ed.btnDeleteToken')}</button></div><p id="edConnection" role="status"></p></fieldset>
  <button class="btn" type="submit" id="edSaveRuleBtn">${t('ed.btnSaveRule')}</button></form></dialog>
  <dialog id="decisionDialog" class="viewer tpl-dialog"><header><span id="edDecisionTitle"></span><button class="btn ghost" data-close aria-label="Cerrar" data-i18n-aria-label="ui.close">✕</button></header>
  <form id="edDecisionForm" class="tpl-form"><p id="edDecisionHook"></p><p id="edDecisionExplain"></p><fieldset id="edChecks"><legend data-i18n="ed.whatToChange">${t('ed.whatToChange')}</legend><label><input type="checkbox" name="aspecto" value="imagen"> ${t('ed.aspect.imagen')}</label><label><input type="checkbox" name="aspecto" value="texto"> ${t('ed.aspect.texto')}</label><label><input type="checkbox" name="aspecto" value="hook"> ${t('ed.aspect.hook')}</label><label><input type="checkbox" name="aspecto" value="tema"> ${t('ed.aspect.tema')}</label><label><input type="checkbox" name="aspecto" value="hora"> ${t('ed.aspect.hora')}</label></fieldset><label><span data-i18n="ed.noteForTeam">${t('ed.noteForTeam')}</span> <textarea class="field" rows="3" maxlength="600" id="edNote"></textarea></label><p id="edDecisionHint" role="alert"></p><button class="btn" id="edDecisionSend">${t('ed.btnConfirm')}</button></form></dialog>`);
}

// Listeners clásicos en elementos específicos
if (typeof document !== 'undefined') {
  const offEdBtn = document.getElementById('officeEditorialBtn');
  if (offEdBtn) {
    offEdBtn.onclick = () => {
      const offDlg = typeof $ === 'function' ? $('officeDialog') : document.getElementById('officeDialog');
      if (offDlg?.close) offDlg.close();
      openEditorialConfig();
    };
  }

  const edDlg = document.getElementById('editorialDialog');
  if (edDlg?.addEventListener) {
    edDlg.addEventListener('close', () => {
      const edTok = typeof $ === 'function' ? $('edToken') : document.getElementById('edToken');
      if (edTok) edTok.value = '';
      editorialEditing = null;
    });
  }

  const edFrm = document.getElementById('editorialForm');
  if (edFrm?.addEventListener) {
    edFrm.addEventListener('submit', async e => {
      e.preventDefault();
      const ctx = editorialEditing;
      if (!edStillEditing(ctx)) return;
      const f = e.target.elements, split = v => (v || '').split(',').map(x => x.trim()).filter(Boolean);
      const body = {
        activa: f.activa?.checked,
        marca: { nombre: f.marca?.value || '', tono: f.tono?.value || '' },
        idiomas: split(f.idiomas?.value),
        nichos: split(f.nichos?.value),
        fuentes: split(f.fuentes?.value),
        redes: split(f.redes?.value),
        propuestasPorTanda: Number(f.cantidad?.value || 3),
        zona: f.zona?.value || 'UTC',
        horas: [f.manana?.value || '09:00', f.tarde?.value || '17:00'],
        modo: f.modo?.value || 'consejo',
        destino: f.destino?.value || 'borrador',
        equipo: (f.equipo?.value || '').split('\n').filter(x => x.trim()).map(x => { const [id, ...rol] = x.split('|'); return { id: id.trim(), rol: rol.join('|').trim() }; }),
        viralhunt: { proyecto: f.proyecto?.value || '', proyectoId: f.proyectoId?.value || '', cuentas: split(f.cuentas?.value).map(Number) },
        reglas: { noPublicar: split(f.noPublicar?.value), fuenteObligatoria: f.fuente?.checked }
      };
      const run = async () => {
        try {
          await edApi(`${edBase(ctx.office)}/editorial`, { method: 'PUT', body: JSON.stringify(body) });
          if (edStillEditing(ctx)) {
            const dlg = typeof $ === 'function' ? $('editorialDialog') : document.getElementById('editorialDialog');
            if (dlg?.close) dlg.close();
            if (typeof document !== 'undefined' && document.getElementById('edDashboard')) await loadFullDashboard(currentEdOffice);
            else await loadEditorial();
          }
        } catch (err) {
          if (edStillEditing(ctx)) {
            const hint = typeof $ === 'function' ? $('edConfigHint') : document.getElementById('edConfigHint');
            if (hint) hint.textContent = err.message;
          }
        }
      };
      if (typeof withBusy === 'function' && e.submitter) await withBusy(e.submitter, run);
      else await run();
    });
  }

  for (const [id, method, suffix] of [['edTokenSave', 'PUT', ''], ['edTokenTest', 'POST', '/probar'], ['edTokenDelete', 'DELETE', '']]) {
    const el = document.getElementById(id);
    if (el) {
      el.onclick = e => {
        const run = async () => {
          const ctx = editorialEditing;
          if (!edStillEditing(ctx)) return;
          const tokInput = typeof $ === 'function' ? $('edToken') : document.getElementById('edToken');
          const body = method === 'PUT' ? JSON.stringify({ token: tokInput?.value.trim() }) : '{}';
          if (tokInput) tokInput.value = '';
          try {
            const result = await edApi(`${edBase(ctx.office)}/viralhunt${suffix}`, { method, ...(method === 'DELETE' ? {} : { body }) });
            if (!edStillEditing(ctx)) return;
            const conn = typeof $ === 'function' ? $('edConnection') : document.getElementById('edConnection');
            if (conn) {
              conn.textContent = suffix
                ? `${result.error ? t('ed.connPartial', { err: result.error }) : t('ed.connOk')} · ${t('ed.planLine', { plan: result.plan })} · ${t('ed.projectsLine', { projects: (result.proyectos || []).map(x => `${x.name} (${x.id})`).join(', ') })} · ${t('ed.accountsLine', { accounts: (result.cuentas || []).map(x => `${x.name} (${x.account_id})`).join(', ') })}`
                : t('ed.connUpdated');
            }
            await loadEditorial();
            if (edStillEditing(ctx)) {
              const st = typeof $ === 'function' ? $('edTokenState') : document.getElementById('edTokenState');
              if (st) st.textContent = editorialData?.viralhunt?.configurado ? t('ed.tokenStateConfigured') : t('ed.tokenStateEmpty');
            }
          } catch (err) {
            if (edStillEditing(ctx)) {
              const conn = typeof $ === 'function' ? $('edConnection') : document.getElementById('edConnection');
              if (conn) conn.textContent = err.message;
            }
          }
        };
        if (typeof withBusy === 'function' && e.target) withBusy(e.target, run);
        else run();
      };
    }
  }

  // Listener para tab-editorial
  const tabEd = document.getElementById('tab-editorial');
  if (tabEd?.addEventListener) {
    tabEd.addEventListener('click', async e => {
      if (e.target.closest('[data-ed-config]')) return openEditorialConfig();
      const tanda = e.target.closest('[data-ed-tanda]');
      if (tanda) {
        const run = async () => {
          const office = typeof oficina !== 'undefined' ? oficina : currentEdOffice;
          const epoch = typeof officeEpoch !== 'undefined' ? officeEpoch : 0;
          try {
            await edApi(`${edBase(office)}/editorial/tanda`, { method: 'POST', body: '{}' });
            if (typeof officeEpoch === 'undefined' || epoch === officeEpoch) {
              if (typeof toast === 'function') toast(t('ed.toastBatchStarted'));
              else edToast(t('ed.toastBatchStarted'));
              loadEditorial();
            }
          } catch (err) {
            if (typeof officeEpoch === 'undefined' || epoch === officeEpoch) {
              if (typeof toast === 'function') toast(err.message, true);
              else edToast(err.message);
            }
          }
        };
        if (typeof withBusy === 'function') return withBusy(tanda, run);
        return run();
      }
      const button = e.target.closest('[data-ed-action]');
      if (!button) return;
      const pid = button.closest('[data-proposal]')?.dataset.proposal;
      const p = editorialData?.propuestas?.find(x => x.id === pid);
      if (!p) return;
      decisionEditing = { office: typeof oficina !== 'undefined' ? oficina : currentEdOffice, epoch: typeof officeEpoch !== 'undefined' ? officeEpoch : 0, pid: p.id, action: button.dataset.edAction };
      const action = decisionEditing.action;
      const dTitle = typeof $ === 'function' ? $('edDecisionTitle') : document.getElementById('edDecisionTitle');
      if (dTitle) dTitle.textContent = { aprobar: t('ed.titleApprove'), cambios: t('ed.titleChanges'), rechazar: t('ed.titleReject') }[action] || action;
      const dHook = typeof $ === 'function' ? $('edDecisionHook') : document.getElementById('edDecisionHook');
      if (dHook) dHook.textContent = p.hook;
      const dExp = typeof $ === 'function' ? $('edDecisionExplain') : document.getElementById('edDecisionExplain');
      if (dExp) dExp.textContent = action === 'aprobar' ? (editorialData.regla?.destino === 'agendar' ? t('ed.explainApproveSchedule') : t('ed.explainApproveDraft')) : action === 'cambios' ? t('ed.explainChanges') : t('ed.explainReject');
      const checks = typeof $ === 'function' ? $('edChecks') : document.getElementById('edChecks');
      if (checks) {
        checks.hidden = action !== 'cambios';
        if (typeof checks.querySelectorAll === 'function') checks.querySelectorAll('input').forEach(i => { i.checked = false; });
      }
      const note = typeof $ === 'function' ? $('edNote') : document.getElementById('edNote');
      if (note) { note.value = ''; note.required = action === 'rechazar'; }
      const hint = typeof $ === 'function' ? $('edDecisionHint') : document.getElementById('edDecisionHint');
      if (hint) hint.textContent = '';
      const dlg = typeof $ === 'function' ? $('decisionDialog') : document.getElementById('decisionDialog');
      if (dlg?.showModal) dlg.showModal();
    });
  }

  // Listener para edDecisionForm
  const decForm = document.getElementById('edDecisionForm');
  if (decForm?.addEventListener) {
    decForm.addEventListener('submit', async e => {
      e.preventDefault();
      const ctx = decisionEditing;
      const curOffice = typeof oficina !== 'undefined' ? oficina : currentEdOffice;
      const curEpoch = typeof officeEpoch !== 'undefined' ? officeEpoch : 0;
      if (!ctx || ctx.office !== curOffice || (typeof officeEpoch !== 'undefined' && ctx.epoch !== curEpoch)) return;
      const noteEl = typeof $ === 'function' ? $('edNote') : document.getElementById('edNote');
      const nota = noteEl?.value.trim() || '';
      const checks = typeof $ === 'function' ? $('edChecks') : document.getElementById('edChecks');
      const casillas = (checks && typeof checks.querySelectorAll === 'function') ? [...checks.querySelectorAll('input:checked')].map(i => i.value) : [];
      if (ctx.action === 'cambios' && !nota && !casillas.length) {
        const hint = typeof $ === 'function' ? $('edDecisionHint') : document.getElementById('edDecisionHint');
        if (hint) hint.textContent = t('ed.hintChanges');
        return;
      }
      const run = async () => {
        try {
          await edApi(`${edBase(ctx.office)}/editorial/propuestas/${encodeURIComponent(ctx.pid)}/${ctx.action}`, { method: 'POST', body: JSON.stringify({ nota, casillas, confirmarAmarillo: true }) });
          if (ctx === decisionEditing && (typeof officeEpoch === 'undefined' || ctx.epoch === curEpoch)) {
            const dlg = typeof $ === 'function' ? $('decisionDialog') : document.getElementById('decisionDialog');
            if (dlg?.close) dlg.close();
            if (typeof document !== 'undefined' && document.getElementById('edDashboard')) await loadFullDashboard(currentEdOffice);
            else await loadEditorial();
          }
        } catch (err) {
          if (ctx === decisionEditing && (typeof officeEpoch === 'undefined' || ctx.epoch === curEpoch)) {
            const hint = typeof $ === 'function' ? $('edDecisionHint') : document.getElementById('edDecisionHint');
            if (hint) hint.textContent = err.message;
          }
        }
      };
      if (typeof withBusy === 'function' && e.submitter) await withBusy(e.submitter, run);
      else await run();
    });
  }

  const decDlg = document.getElementById('decisionDialog');
  if (decDlg?.addEventListener) {
    decDlg.addEventListener('close', () => { decisionEditing = null; });
  }
}

// ============================================================================
// DASHBOARD COMPLETO (/editorial.html)
// ============================================================================

let fullDashboardData = null;

async function loadFullDashboard(officeId) {
  const dash = typeof $ === 'function' ? $('edDashboard') : (typeof document !== 'undefined' ? document.getElementById('edDashboard') : null);
  if (!dash) return;
  if (!officeId || officeId === 'edificio') {
    dash.innerHTML = `<div class="empty"><p class="muted">${t('ed.chooseOffice')}</p></div>`;
    return;
  }
  currentEdOffice = officeId;
  try {
    const [resumen, propuestas, escritores, gusto, galeria, desempeno, radar] = await Promise.all([
      edApi(`${edBase(officeId)}/editorial`),
      edApi(`${edBase(officeId)}/editorial/propuestas`),
      edApi(`${edBase(officeId)}/editorial/escritores`),
      edApi(`${edBase(officeId)}/editorial/gusto`),
      edApi(`${edBase(officeId)}/editorial/galeria`),
      edApi(`${edBase(officeId)}/editorial/desempeno`),
      edApi(`${edBase(officeId)}/editorial/radar`),
    ]);
    fullDashboardData = { resumen, propuestas, escritores, gusto, galeria, desempeno, radar, officeId };
    renderInbox();
    renderCalendar();
    renderTopicsAndWriters();
    renderRoutines();
    renderTaste();
    renderGallery();
    renderBrand();
    renderViralHunt();
  } catch (err) {
    edToast(err.message);
  }
}

function renderInbox() {
  if (!fullDashboardData) return;
  const { propuestas, resumen, officeId } = fullDashboardData;
  const r = resumen.regla;
  const grid = document.getElementById('edInboxGrid');
  if (!grid) return;
  const e = getEsc();

  const search = (document.getElementById('edInboxSearch')?.value || '').toLowerCase().trim();
  const fTopic = document.getElementById('edFilterTopic')?.value || '';
  const fNet = document.getElementById('edFilterNetwork')?.value || '';
  const fWriter = document.getElementById('edFilterWriter')?.value || '';
  const fStatus = document.getElementById('edFilterStatus')?.value || '';

  const selTopic = document.getElementById('edFilterTopic');
  if (selTopic && selTopic.children.length <= 1) {
    const topics = Array.from(new Set(propuestas.map(p => p.pilar || p.tema).filter(Boolean)));
    selTopic.innerHTML = `<option value="">${t('ed.filter.allTopics')}</option>` + topics.map(tp => `<option value="${e(tp)}">${e(tp)}</option>`).join('');
  }
  const selNet = document.getElementById('edFilterNetwork');
  if (selNet && selNet.children.length <= 1) {
    const redes = Array.from(new Set(propuestas.flatMap(p => Object.keys(p.copy || {}))));
    selNet.innerHTML = `<option value="">${t('ed.filter.allNetworks')}</option>` + redes.map(n => `<option value="${e(n)}">${e(n)}</option>`).join('');
  }
  const selWriter = document.getElementById('edFilterWriter');
  if (selWriter && selWriter.children.length <= 1) {
    const writers = (r.equipo || []).map(eq => eq.id);
    selWriter.innerHTML = `<option value="">${t('ed.filter.allWriters')}</option>` + writers.map(w => `<option value="${e(w)}">${e(w)}</option>`).join('');
  }

  const filtered = propuestas.filter(p => {
    if (search && !p.hook.toLowerCase().includes(search) && !(p.tema || '').toLowerCase().includes(search)) return false;
    if (fTopic && p.pilar !== fTopic && p.tema !== fTopic) return false;
    if (fNet && !Object.keys(p.copy || {}).includes(fNet)) return false;
    if (fWriter && p.autor !== fWriter) return false;
    if (fStatus && p.estado !== fStatus) return false;
    return true;
  });

  const notice = document.getElementById('edInboxNotice');
  if (notice) {
    notice.innerHTML = !resumen.viralhunt?.configurado ? `<p class="ed-notice">${t('ed.connectNotice')}</p>` : '';
  }

  if (!filtered.length) {
    grid.innerHTML = `<div class="ed-empty" style="grid-column:1/-1"><h3>${t('ed.emptyTitle')}</h3><p>${t('ed.emptyText')}</p></div>`;
  } else {
    grid.innerHTML = filtered.map(p => edCard(p, r, officeId)).join('');
  }
}

function renderCalendar() {
  if (!fullDashboardData) return;
  const { propuestas, resumen } = fullDashboardData;
  const container = document.getElementById('edCalendarTimeline');
  if (!container) return;
  const e = getEsc();
  const tokenBadge = document.getElementById('edCalTokenBadge');
  if (tokenBadge) {
    const isPublisher = resumen.viralhunt?.plan === 'publisher' || resumen.viralhunt?.permisos?.publisher;
    tokenBadge.innerHTML = `<span class="ed-writer-pill">${e(isPublisher ? t('ed.cal.tokenExplPublisher') : t('ed.cal.tokenExplWriter'))}</span>`;
  }

  const grouped = {};
  for (const p of propuestas.filter(p => p.estado !== 'descartada')) {
    const dStr = p.hora ? p.hora.slice(0, 10) : 'Sin fecha';
    if (!grouped[dStr]) grouped[dStr] = [];
    grouped[dStr].push(p);
  }

  const days = Object.keys(grouped).sort();
  if (!days.length) {
    container.innerHTML = `<p class="muted">${t('ed.cal.noItems')}</p>`;
    return;
  }

  container.innerHTML = days.map(day => `
    <div class="ed-cal-day">
      <div class="ed-cal-day-head"><span>📅 ${e(day)}</span><span>${grouped[day].length} items</span></div>
      ${grouped[day].sort((a, b) => (a.hora || '').localeCompare(b.hora || '')).map(p => `
        <div class="ed-cal-slot">
          <div class="ed-cal-hour">${e(p.hora ? new Date(p.hora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–')}</div>
          <div class="ed-cal-item" data-proposal="${e(p.id)}">
            <div>
              <h4>${e(p.hook)}</h4>
              <p>${e(p.tema || '–')} · ${e(p.autor || '–')} · <span class="ed-state">${e(t(`ed.state.${p.estado}`))}</span></p>
            </div>
            ${p.estado === 'pendiente' ? `<button type="button" class="btn small ghost" data-ed-change-hour="${e(p.id)}">${t('ed.cal.changeHour')}</button>` : `<span class="muted" style="font-size:11px;">🔒</span>`}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function renderTopicsAndWriters() {
  if (!fullDashboardData) return;
  const { resumen, escritores } = fullDashboardData;
  const r = resumen.regla;
  const e = getEsc();
  const pillarsList = document.getElementById('edPillarsList');
  if (pillarsList) {
    const temas = r.temas || [];
    pillarsList.innerHTML = temas.length ? temas.map(tm => `
      <div class="ed-pillar-card">
        <h4>${e(tm.nombre || tm.id)}</h4>
        <div class="ed-pillar-writers">
          ${(tm.escritores || []).length ? (tm.escritores || []).map(w => `<span class="ed-writer-pill">✍ ${e(w)}</span>`).join('') : `<span class="muted">${t('ed.topics.noWriters')}</span>`}
        </div>
      </div>
    `).join('') : `<p class="muted">${t('ed.topics.noWriters')}</p>`;
  }

  const writersGrid = document.getElementById('edWritersGrid');
  if (writersGrid) {
    writersGrid.innerHTML = (escritores || []).map(w => `
      <div class="ed-writer-card">
        <div class="ed-writer-head">
          <h4>${e(w.id)}</h4>
          <span class="ed-writer-role">${e(w.rol || '')}</span>
        </div>
        <p class="muted">${t('ed.writers.counts', { approved: w.aprobadas || 0, pending: w.pendientes || 0, total: w.propuestas || 0 })}</p>
        <p class="muted">${t('ed.writers.encargosCount', { count: (w.encargos || []).length })}</p>
        <div class="ed-rate-bar"><div class="ed-rate-fill" style="width:${w.tasaAprobacion != null ? w.tasaAprobacion : 0}%"></div></div>
        <small>${w.tasaAprobacion != null ? t('ed.writers.rate', { rate: w.tasaAprobacion }) : t('ed.writers.noRate')}</small>
        ${(w.motivosRechazo || []).length ? `<p class="muted" style="margin-top:8px;font-size:11px;">${t('ed.writers.rejectionReasons', { reasons: w.motivosRechazo.map(m => m.motivo).join(', ') })}</p>` : ''}
      </div>
    `).join('');
  }
}

function renderRoutines(overrideData) {
  const data = overrideData || fullDashboardData || (typeof globalThis !== 'undefined' && globalThis.fullDashboardData);
  if (!data) return;
  const { resumen } = data;
  const grid = document.getElementById('edRoutinesGrid');
  if (!grid) return;
  const e = getEsc();
  const rutinas = resumen.rutinas || [];

  grid.innerHTML = rutinas.map(rut => {
    const isWarn = !!rut.avisoTope;
    const freqDesc = rut.tras ? t('ed.routines.optAfter') + `: ${rut.tras}` : rut.horas?.length ? t('ed.routines.optHours') + `: ${(rut.horas || []).join(', ')}` : t('ed.routines.optMinutes') + `: ${rut.cadaMin || 60}m`;
    const nextDesc = rut.proxima?.at ? edDate(rut.proxima.at, resumen.regla.zona) : rut.proxima?.tras ? t('ed.routines.optAfter') + ` ${rut.proxima.tras}` : '–';
    const lastDesc = rut.ultima?.inicio ? edDate(rut.ultima.inicio, resumen.regla.zona) : '–';
    // turnosHoy llega como número (lib/rutinas.js vistaRutina); el informe de la última ejecución, en una línea.
    const usados = Number(rut.turnosHoy) || 0;
    const inf = rut.ultima?.informe;
    const outcome = !inf ? '' : !inf.ok ? t('ed.routines.outcomeFail', { reason: inf.motivo || '?' }) : [
      t('ed.routines.outcomeOk'),
      inf.ready === false ? t('ed.routines.outcomeNoStats') : '',
      inf.ganadores ? t('ed.routines.outcomeWinners', { n: inf.ganadores }) : '',
      inf.semillas ? t('ed.routines.outcomeSeeds', { n: inf.semillas }) : '',
      inf.ediciones ? t('ed.routines.outcomeEdits', { n: inf.ediciones }) : '',
    ].filter(Boolean).join(' · ');

    return `
      <div class="ed-routine-card" data-routine="${e(rut.tipo)}">
        <div class="ed-routine-head">
          <h3 class="ed-routine-title">${e(t(`ed.routine.${rut.tipo}`) || rut.tipo)}</h3>
          <span class="ed-routine-badge ${e(rut.estado)}">${e(t(`ed.routines.status.${rut.estado}`) || rut.estado)}</span>
        </div>
        <div class="ed-routine-info">
          <div>◷ ${e(freqDesc)}</div>
          ${rut.ventana ? `<div>🪟 ${e(rut.ventana.desde)} - ${e(rut.ventana.hasta)} (${e(resumen.regla.zona)})</div>` : ''}
          <div>👥 ${e((rut.equipo || []).join(', ') || (rut.agentes === false ? t('ed.routines.serverTeam') : '–'))}</div>
          <div>⏭ ${t('ed.routines.nextRun', { at: e(nextDesc) })}</div>
          <div>⏮ ${t('ed.routines.lastRun', { at: e(lastDesc) })}</div>
          ${outcome ? `<div${inf.ok ? '' : ' style="color:var(--err)"'}>${e(t('ed.routines.lastOutcome', { outcome }))}</div>` : ''}
          ${inf?.cayeron?.length ? `<div style="color:var(--err)">${e(t('ed.routines.down', { list: inf.cayeron.join(', ') }))}</div>` : ''}
        </div>
        <div class="ed-routine-cap ${isWarn ? 'warn' : ''}">
          ${t('ed.routines.capUsage', { used: usados, cap: rut.topeDiario || '∞' })}
          ${isWarn ? ` — <b>${t('ed.routines.capWarning', { used: usados, cap: rut.topeDiario })}</b>` : ''}
        </div>
        <div class="ed-actions" style="margin-top:auto">
          ${rut.estado === 'pausada'
            ? `<button type="button" class="btn small primary" data-ed-routine-action="reanudar">${t('ed.routines.btnResume')}</button>`
            : `<button type="button" class="btn small ghost" data-ed-routine-action="pausar">${t('ed.routines.btnPause')}</button>`}
          <button type="button" class="btn small ghost" data-ed-routine-action="ejecutar" ${rut.estado === 'ejecutando' ? 'disabled' : ''}>${t('ed.routines.btnRunNow')}</button>
          <button type="button" class="btn small ghost" data-ed-routine-action="editar">${t('ed.routines.btnEdit')}</button>
        </div>
      </div>
    `;
  }).join('');
}

function renderTaste() {
  if (!fullDashboardData) return;
  const { gusto } = fullDashboardData;
  const notesField = document.getElementById('edTasteNotes');
  if (notesField && typeof document !== 'undefined' && document.activeElement !== notesField) {
    notesField.value = gusto?.notas || '';
  }
  const contentBox = document.getElementById('edTasteContent');
  if (contentBox) {
    contentBox.textContent = gusto?.contenido || 'Sin contenido de gusto todavía.';
  }
}

function renderGallery() {
  if (!fullDashboardData) return;
  const { galeria, resumen, officeId } = fullDashboardData;
  const grid = document.getElementById('edGalleryGrid');
  if (!grid) return;
  const e = getEsc();

  const fStatus = document.getElementById('edGalFilterStatus')?.value || '';
  const fNet = document.getElementById('edGalFilterNetwork')?.value || '';
  const fTopic = document.getElementById('edGalFilterTopic')?.value || '';
  const fWriter = document.getElementById('edGalFilterWriter')?.value || '';
  const fRoutine = document.getElementById('edGalFilterRoutine')?.value || '';

  const selNet = document.getElementById('edGalFilterNetwork');
  if (selNet && selNet.children.length <= 1) {
    const redes = Array.from(new Set(galeria.flatMap(p => Object.keys(p.copy || {}))));
    selNet.innerHTML = `<option value="">${t('ed.filter.allNetworks')}</option>` + redes.map(n => `<option value="${e(n)}">${e(n)}</option>`).join('');
  }
  const selTopic = document.getElementById('edGalFilterTopic');
  if (selTopic && selTopic.children.length <= 1) {
    const topics = Array.from(new Set(galeria.map(p => p.pilar || p.tema).filter(Boolean)));
    selTopic.innerHTML = `<option value="">${t('ed.filter.allTopics')}</option>` + topics.map(tp => `<option value="${e(tp)}">${e(tp)}</option>`).join('');
  }
  const selWriter = document.getElementById('edGalFilterWriter');
  if (selWriter && selWriter.children.length <= 1) {
    const writers = (resumen.regla.equipo || []).map(eq => eq.id);
    selWriter.innerHTML = `<option value="">${t('ed.filter.allWriters')}</option>` + writers.map(w => `<option value="${e(w)}">${e(w)}</option>`).join('');
  }

  const filtered = galeria.filter(p => {
    if (fStatus) {
      if (fStatus === 'publicada' && !p.publicado) return false;
      if (fStatus === 'cambios' && !p.cambiosPedidos) return false;
      if (fStatus !== 'publicada' && fStatus !== 'cambios' && p.estado !== fStatus) return false;
    }
    if (fNet && !Object.keys(p.copy || {}).includes(fNet)) return false;
    if (fTopic && p.pilar !== fTopic && p.tema !== fTopic) return false;
    if (fWriter && p.autor !== fWriter) return false;
    if (fRoutine && p.cadena?.tipo !== fRoutine && p.origen?.rutina !== fRoutine) return false;
    return true;
  });

  const file = (pid, name) => `${edBase(officeId)}/editorial/propuestas/${encodeURIComponent(pid)}/archivo/${encodeURIComponent(name)}`;

  grid.innerHTML = filtered.length ? filtered.map(p => `
    <article class="ed-card ed-gal-card" data-proposal="${e(p.id)}">
      <input type="checkbox" class="ed-gal-select" data-gal-id="${e(p.id)}">
      ${p.imagenes?.length ? `<img class="ed-image" src="${file(p.id, p.imagenes[0])}" alt="${e(p.hook)}" loading="lazy">` : `<div class="ed-no-image">${t('ed.noImage')}</div>`}
      <div class="ed-card-body">
        <div class="ed-meta">
          <span class="ed-state">${e(t(`ed.state.${p.estado}`))}</span>
          ${p.publicado ? `<span class="ed-light-badge ed-light-verde">✓ ${t('ed.gallery.publishedBadge')}</span>` : ''}
        </div>
        <h3>${e(p.hook)}</h3>
        <p class="muted">${e(p.tema || '–')} · ${e(p.autor || '–')}</p>
        ${p.lineaOrigen ? `<div class="ed-chain-box">${e(p.lineaOrigen)}</div>` : ''}
        ${p.metricas ? `<div class="ed-gal-metrics">📊 ${t('ed.gallery.metricsLabel', { n: p.metricas.interacciones ?? p.metricas.engagement ?? 0 })}</div>` : ''}
        ${p.viralhunt?.remoto?.permalinks?.length ? `<p><a href="${e(p.viralhunt.remoto.permalinks[0])}" target="_blank" rel="noopener noreferrer">↗ Post publicado</a></p>` : ''}
        <div class="ed-actions" style="margin-top:12px">
          <button type="button" class="btn small primary" data-ed-gal-reuse="${e(p.id)}">${t('ed.gallery.btnReuse')}</button>
        </div>
      </div>
    </article>
  `).join('') : `<p class="muted" style="grid-column:1/-1">${t('ed.emptyText')}</p>`;
}

function renderBrand() {
  if (!fullDashboardData) return;
  const { resumen, officeId } = fullDashboardData;
  const m = resumen.regla?.marca || {};
  const e = getEsc();
  const details = document.getElementById('edBrandDetails');
  if (details) {
    details.innerHTML = `
      <h3>${e(m.nombre || 'Marca')}</h3>
      <p><b>${t('ed.fieldTone')}:</b> ${e(m.tono || '–')}</p>
      <p><b>${t('ed.brand.ratioTitle')}:</b> <span class="ed-writer-pill">${e(m.proporcion || '1:1')}</span></p>
      <p><b>${t('ed.brand.typographyTitle')}:</b> ${e((m.tipografias || []).join(', ') || '–')}</p>
      <p><b>${t('ed.brand.handlesTitle')}:</b> ${e(Object.entries(m.handles || {}).map(([r, h]) => `${r}: ${h}`).join(' · ') || '–')}</p>
      <h4 style="margin:14px 0 6px;">${t('ed.brand.paletteTitle')}</h4>
      <div class="ed-palette-row">
        ${(m.paleta || []).map(hex => `
          <div class="ed-swatch-box">
            <span class="ed-swatch" style="background:${e(hex)}"></span>
            <code>${e(hex)}</code>
          </div>
        `).join('')}
      </div>
    `;
  }

  const refsGrid = document.getElementById('edBrandRefsGrid');
  if (refsGrid) {
    const refs = m.referencias || [];
    refsGrid.innerHTML = refs.length ? refs.map(ref => `
      <div class="ed-ref-card">
        <img class="ed-ref-img" src="${edBase(officeId)}/editorial/marca/referencias/${encodeURIComponent(ref)}" alt="${e(ref)}" loading="lazy">
        <div class="ed-ref-foot">
          <span title="${e(ref)}">${e(ref.slice(0, 10))}…</span>
          <button type="button" class="btn small ghost" data-ed-delete-ref="${e(ref)}" style="padding:1px 6px">✕</button>
        </div>
      </div>
    `).join('') : `<p class="muted">${t('ed.topics.noWriters')}</p>`;
  }
}

function renderViralHunt() {
  if (!fullDashboardData) return;
  const { resumen } = fullDashboardData;
  const vh = resumen.viralhunt || {};
  const txt = document.getElementById('edVhStateText');
  if (txt) {
    txt.textContent = vh.configurado ? t('ed.tokenStateConfigured') : t('ed.tokenStateEmpty');
  }
  const result = document.getElementById('edVhResult');
  if (result && vh.configurado) {
    result.textContent = `${t('ed.connOk')} · ${t('ed.vh.planLabel', { plan: vh.plan || 'standard' })} · ${t('ed.vh.accountsLabel', { accounts: (vh.cuentas || []).join(', ') })}`;
  }
}

// Inicialización de la página /editorial.html
async function initEditorialDashboard() {
  if (typeof document === 'undefined') return;
  const officeSel = document.getElementById('edOfficeSel');
  if (!officeSel) return;
  const e = getEsc();

  try {
    const oficinas = await edApi('/api/oficinas');
    officeSel.innerHTML = oficinas.filter(o => o.id !== 'edificio').map(o => `<option value="${e(o.id)}">${e(o.nombre)}</option>`).join('');
    const urlParams = new URLSearchParams(location.search);
    const targetOffice = urlParams.get('oficina') || localStorage.getItem('om-office') || officeSel.options[0]?.value;
    if (targetOffice) officeSel.value = targetOffice;
    currentEdOffice = officeSel.value;
    const initialTab = urlParams.get('tab') || (location.hash ? location.hash.replace(/^#/, '') : null);
    if (initialTab && document.getElementById(`edSection-${initialTab}`)) {
      currentEdTab = initialTab;
      document.querySelectorAll('#edNav .ed-nav-btn').forEach(b => b.classList.toggle('on', b.dataset.edTab === initialTab));
      document.querySelectorAll('.ed-section').forEach(sec => {
        sec.hidden = sec.id !== `edSection-${initialTab}`;
      });
    }
    await loadFullDashboard(currentEdOffice);
  } catch (err) {
    edToast(err.message);
  }

  officeSel.addEventListener('change', async () => {
    currentEdOffice = officeSel.value;
    const u = new URL(location);
    u.searchParams.set('oficina', currentEdOffice);
    history.replaceState(null, '', u);
    await loadFullDashboard(currentEdOffice);
  });

  const nav = document.getElementById('edNav');
  if (nav) {
    nav.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-ed-tab]');
      if (!btn) return;
      currentEdTab = btn.dataset.edTab;
      nav.querySelectorAll('.ed-nav-btn').forEach(b => b.classList.toggle('on', b === btn));
      document.querySelectorAll('.ed-section').forEach(sec => {
        sec.hidden = sec.id !== `edSection-${currentEdTab}`;
      });
      try {
        const u = new URL(location);
        u.searchParams.set('tab', currentEdTab);
        history.replaceState(null, '', u);
      } catch {}
    });
  }

  const clock = document.getElementById('clock');
  if (clock) {
    const tick = () => { clock.textContent = new Date().toTimeString().slice(0, 8); };
    setInterval(tick, 1000); tick();
  }

  try {
    const events = new EventSource('/api/events');
    events.onmessage = ev => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'editorial-updated' && data.oficina === currentEdOffice) {
          loadFullDashboard(currentEdOffice);
        }
      } catch {}
    };
  } catch {}

  for (const id of ['edInboxSearch', 'edFilterTopic', 'edFilterNetwork', 'edFilterWriter', 'edFilterStatus']) {
    document.getElementById(id)?.addEventListener('input', renderInbox);
    document.getElementById(id)?.addEventListener('change', renderInbox);
  }
  for (const id of ['edGalFilterStatus', 'edGalFilterNetwork', 'edGalFilterTopic', 'edGalFilterWriter', 'edGalFilterRoutine']) {
    document.getElementById(id)?.addEventListener('change', renderGallery);
  }

  document.getElementById('edNewBatchBtn')?.addEventListener('click', async ev => {
    const run = async () => {
      try {
        await edApi(`${edBase(currentEdOffice)}/editorial/tanda`, { method: 'POST', body: '{}' });
        edToast(t('ed.toastBatchStarted'));
        await loadFullDashboard(currentEdOffice);
      } catch (err) { edToast(err.message); }
    };
    if (typeof withBusy === 'function') await withBusy(ev.target, run);
    else await run();
  });

  document.getElementById('edConfigBtn')?.addEventListener('click', openEditorialConfig);

  document.getElementById('edAddTopicBtn')?.addEventListener('click', () => {
    document.getElementById('edTopicName').value = '';
    document.getElementById('edTopicWriters').value = '';
    document.getElementById('edTopicHint').textContent = '';
    document.getElementById('edTopicDialog')?.showModal();
  });

  document.getElementById('edTopicForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const nombre = document.getElementById('edTopicName').value.trim();
    const escritores = document.getElementById('edTopicWriters').value.split(',').map(s => s.trim()).filter(Boolean);
    const temas = [...(fullDashboardData?.resumen?.regla?.temas || []), { id: nombre.toLowerCase().replace(/\s+/g, '-'), nombre, escritores }];
    const run = async () => {
      try {
        await edApi(`${edBase(currentEdOffice)}/editorial`, { method: 'PUT', body: JSON.stringify({ temas }) });
        document.getElementById('edTopicDialog')?.close();
        await loadFullDashboard(currentEdOffice);
      } catch (err) { document.getElementById('edTopicHint').textContent = err.message; }
    };
    if (typeof withBusy === 'function' && ev.submitter) await withBusy(ev.submitter, run);
    else await run();
  });

  document.getElementById('edAssignTopicBtn')?.addEventListener('click', () => {
    const selW = document.getElementById('edEncargoWriter');
    const selP = document.getElementById('edEncargoPilar');
    const equipo = fullDashboardData?.resumen?.regla?.equipo || [];
    const temas = fullDashboardData?.resumen?.regla?.temas || [];
    if (selW) selW.innerHTML = equipo.map(eq => `<option value="${e(eq.id)}">${e(eq.id)} (${e(eq.rol)})</option>`).join('');
    if (selP) selP.innerHTML = `<option value="">–</option>` + temas.map(tm => `<option value="${e(tm.id)}">${e(tm.nombre || tm.id)}</option>`).join('');
    document.getElementById('edEncargoTopic').value = '';
    document.getElementById('edEncargoDetails').value = '';
    document.getElementById('edEncargoPara').value = '';
    document.getElementById('edEncargoHint').textContent = '';
    document.getElementById('edEncargoDialog')?.showModal();
  });

  document.getElementById('edEncargoForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const escritor = document.getElementById('edEncargoWriter').value;
    const tema = document.getElementById('edEncargoTopic').value.trim();
    const detalle = document.getElementById('edEncargoDetails').value.trim();
    const paraVal = document.getElementById('edEncargoPara').value;
    const para = paraVal ? new Date(paraVal).toISOString() : null;
    const pilar = document.getElementById('edEncargoPilar').value || null;
    const run = async () => {
      try {
        await edApi(`${edBase(currentEdOffice)}/editorial/encargos`, { method: 'POST', body: JSON.stringify({ escritor, tema, detalle, para, pilar }) });
        document.getElementById('edEncargoDialog')?.close();
        edToast(t('ed.encargo.toastSuccess', { writer: escritor }));
        await loadFullDashboard(currentEdOffice);
      } catch (err) { document.getElementById('edEncargoHint').textContent = err.message; }
    };
    if (typeof withBusy === 'function' && ev.submitter) await withBusy(ev.submitter, run);
    else await run();
  });

  document.getElementById('edTasteForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const notas = document.getElementById('edTasteNotes').value.trim();
    const status = document.getElementById('edTasteStatus');
    const run = async () => {
      try {
        await edApi(`${edBase(currentEdOffice)}/editorial/gusto`, { method: 'PUT', body: JSON.stringify({ notas }) });
        if (status) status.textContent = t('ed.taste.toastSaved');
        setTimeout(() => { if (status) status.textContent = ''; }, 3000);
        await loadFullDashboard(currentEdOffice);
      } catch (err) { edToast(err.message); }
    };
    if (typeof withBusy === 'function' && ev.submitter) await withBusy(ev.submitter, run);
    else await run();
  });

  document.getElementById('edRefFileInput')?.addEventListener('change', async ev => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const status = document.getElementById('edRefUploadStatus');
    if (status) status.textContent = 'Uploading…';
    try {
      await fetch(`${edBase(currentEdOffice)}/editorial/marca/referencias/${encodeURIComponent(file.name)}`, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'image/jpeg' }
      });
      if (status) status.textContent = t('ed.brand.toastRefUploaded');
      setTimeout(() => { if (status) status.textContent = ''; }, 3000);
      await loadFullDashboard(currentEdOffice);
    } catch (err) { edToast(err.message); }
  });

  document.getElementById('edBrandRefsGrid')?.addEventListener('click', async ev => {
    const btn = ev.target.closest('[data-ed-delete-ref]');
    if (!btn) return;
    const nombre = btn.dataset.edDeleteRef;
    if (!confirm(`Delete reference ${nombre}?`)) return;
    try {
      await edApi(`${edBase(currentEdOffice)}/editorial/marca/referencias/${encodeURIComponent(nombre)}`, { method: 'DELETE' });
      edToast(t('ed.brand.toastRefDeleted'));
      await loadFullDashboard(currentEdOffice);
    } catch (err) { edToast(err.message); }
  });

  document.getElementById('edVhSaveBtn')?.addEventListener('click', async () => {
    const tok = document.getElementById('edVhTokenInput').value.trim();
    document.getElementById('edVhTokenInput').value = '';
    try {
      await edApi(`${edBase(currentEdOffice)}/viralhunt`, { method: 'PUT', body: JSON.stringify({ token: tok }) });
      edToast(t('ed.connUpdated'));
      await loadFullDashboard(currentEdOffice);
    } catch (err) { edToast(err.message); }
  });

  document.getElementById('edVhTestBtn')?.addEventListener('click', async () => {
    try {
      const res = await edApi(`${edBase(currentEdOffice)}/viralhunt/probar`, { method: 'POST', body: '{}' });
      document.getElementById('edVhResult').textContent = `${res.error ? t('ed.connPartial', { err: res.error }) : t('ed.connOk')} · ${t('ed.vh.planLabel', { plan: res.plan })} · ${t('ed.vh.accountsLabel', { accounts: (res.cuentas || []).map(x => x.name).join(', ') })}`;
    } catch (err) { edToast(err.message); }
  });

  document.getElementById('edVhDeleteBtn')?.addEventListener('click', async () => {
    if (!confirm('Disconnect ViralHunt?')) return;
    try {
      await edApi(`${edBase(currentEdOffice)}/viralhunt`, { method: 'DELETE' });
      edToast('ViralHunt disconnected.');
      await loadFullDashboard(currentEdOffice);
    } catch (err) { edToast(err.message); }
  });

  document.getElementById('edRoutinesGrid')?.addEventListener('click', async ev => {
    const btn = ev.target.closest('[data-ed-routine-action]');
    if (!btn) return;
    const card = btn.closest('[data-routine]');
    const tipo = card?.dataset.routine;
    if (!tipo) return;
    const action = btn.dataset.edRoutineAction;

    if (action === 'pausar' || action === 'reanudar' || action === 'ejecutar') {
      const run = async () => {
        try {
          await edApi(`${edBase(currentEdOffice)}/editorial/rutinas/${encodeURIComponent(tipo)}/${action}`, { method: 'POST', body: '{}' });
          edToast(action === 'ejecutar' ? t('ed.routines.toastRan', { tipo }) : `Routine ${tipo} ${action}.`);
          await loadFullDashboard(currentEdOffice);
        } catch (err) { edToast(err.message); }
      };
      if (typeof withBusy === 'function') await withBusy(btn, run);
      else await run();
    } else if (action === 'editar') {
      openRoutineEditModal(tipo);
    }
  });

  document.getElementById('edGalleryExportBtn')?.addEventListener('click', () => {
    const selected = [...document.querySelectorAll('.ed-gal-select:checked')].map(cb => cb.dataset.galId);
    const url = `${edBase(currentEdOffice)}/editorial/galeria/exportar?ids=${encodeURIComponent(selected.join(','))}`;
    window.open(url, '_blank');
  });

  document.getElementById('edGallerySelectAll')?.addEventListener('click', () => {
    document.querySelectorAll('.ed-gal-select').forEach(cb => { cb.checked = true; });
  });

  document.getElementById('edGalleryDeselectAll')?.addEventListener('click', () => {
    document.querySelectorAll('.ed-gal-select').forEach(cb => { cb.checked = false; });
  });

  document.getElementById('edGalleryGrid')?.addEventListener('click', async ev => {
    const btn = ev.target.closest('[data-ed-gal-reuse]');
    if (!btn) return;
    const pid = btn.dataset.edGalReuse;
    const run = async () => {
      try {
        await edApi(`${edBase(currentEdOffice)}/editorial/propuestas/${encodeURIComponent(pid)}/reusar`, { method: 'POST', body: '{}' });
        edToast(t('ed.gallery.toastReused', { id: pid }));
        await loadFullDashboard(currentEdOffice);
      } catch (err) { edToast(err.message); }
    };
    if (typeof withBusy === 'function') await withBusy(btn, run);
    else await run();
  });

  document.getElementById('edYellowConfirmBtn')?.addEventListener('click', async () => {
    if (!yellowConfirmProposal) return;
    const pid = yellowConfirmProposal.id;
    try {
      await edApi(`${edBase(currentEdOffice)}/editorial/propuestas/${encodeURIComponent(pid)}/aprobar`, {
        method: 'POST',
        body: JSON.stringify({ confirmarAmarillo: true })
      });
      document.getElementById('edConfirmYellowDialog')?.close();
      yellowConfirmProposal = null;
      edToast('Proposal approved.');
      await loadFullDashboard(currentEdOffice);
    } catch (err) { edToast(err.message); }
  });

  document.getElementById('edYellowCancelBtn')?.addEventListener('click', () => {
    document.getElementById('edConfirmYellowDialog')?.close();
    yellowConfirmProposal = null;
  });

  document.getElementById('edHourForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const pid = document.getElementById('edHourPid').value;
    const rawVal = document.getElementById('edHourValue').value;
    if (!rawVal) return;
    const hora = new Date(rawVal).toISOString();
    const run = async () => {
      try {
        await edApi(`${edBase(currentEdOffice)}/editorial/propuestas/${encodeURIComponent(pid)}/hora`, {
          method: 'PATCH',
          body: JSON.stringify({ hora })
        });
        document.getElementById('edHourDialog')?.close();
        edToast(t('ed.cal.hourUpdated', { hour: rawVal }));
        await loadFullDashboard(currentEdOffice);
      } catch (err) { document.getElementById('edHourHint').textContent = err.message; }
    };
    if (typeof withBusy === 'function' && ev.submitter) await withBusy(ev.submitter, run);
    else await run();
  });
}

function openRoutineEditModal(tipo) {
  const r = fullDashboardData?.resumen?.regla?.rutinas?.find(x => x.tipo === tipo);
  if (!r) return;
  const e = getEsc();
  document.getElementById('edRoutineTipo').value = tipo;
  document.getElementById('edRoutineDialogTitle').textContent = t('ed.routines.dialogTitle', { tipo });
  document.getElementById('edRoutineActiva').checked = !!r.activa;
  const modeSel = document.getElementById('edRoutineFreqMode');
  if (r.tras) modeSel.value = 'after';
  else if (r.horas?.length) modeSel.value = 'hours';
  else modeSel.value = 'interval';

  document.getElementById('edRoutineCadaMin').value = r.cadaMin || 60;
  document.getElementById('edRoutineHoras').value = (r.horas || []).join(', ');
  const trasSel = document.getElementById('edRoutineTras');
  trasSel.innerHTML = (fullDashboardData?.resumen?.regla?.rutinas || []).filter(x => x.tipo !== tipo).map(x => `<option value="${e(x.tipo)}">${e(x.tipo)}</option>`).join('');
  if (r.tras) trasSel.value = r.tras;

  const updateRows = () => {
    const val = modeSel.value;
    document.getElementById('edRoutineEveryRow').hidden = val !== 'interval';
    document.getElementById('edRoutineHoursRow').hidden = val !== 'hours';
    document.getElementById('edRoutineAfterRow').hidden = val !== 'after';
  };
  modeSel.onchange = updateRows;
  updateRows();

  document.getElementById('edRoutineVentanaDesde').value = r.ventana?.desde || '07:00';
  document.getElementById('edRoutineVentanaHasta').value = r.ventana?.hasta || '23:00';
  document.getElementById('edRoutineEquipo').value = (r.equipo || []).join(', ');
  document.getElementById('edRoutineTopeDiario').value = r.topeDiario ?? 24;
  document.getElementById('edRoutineCantidad').value = r.cantidad || 3;
  document.getElementById('edRoutineQtyRow').hidden = tipo !== 'radar';
  document.getElementById('edRoutineTeamRow').hidden = ['desempeno', 'mas-como-este', 'aprender'].includes(tipo);
  document.getElementById('edRoutineHint').textContent = '';
  document.getElementById('edRoutineDialog')?.showModal();
}

if (typeof document !== 'undefined') {
  document.getElementById('edRoutineForm')?.addEventListener('submit', async ev => {
    ev.preventDefault();
    const tipo = document.getElementById('edRoutineTipo').value;
    const mode = document.getElementById('edRoutineFreqMode').value;
    const split = v => (v || '').split(',').map(x => x.trim()).filter(Boolean);

    const updated = {
      tipo,
      activa: document.getElementById('edRoutineActiva').checked,
      cadaMin: mode === 'interval' ? Number(document.getElementById('edRoutineCadaMin').value) : null,
      horas: mode === 'hours' ? split(document.getElementById('edRoutineHoras').value) : [],
      tras: mode === 'after' ? document.getElementById('edRoutineTras').value : null,
      ventana: { desde: document.getElementById('edRoutineVentanaDesde').value, hasta: document.getElementById('edRoutineVentanaHasta').value },
      equipo: split(document.getElementById('edRoutineEquipo').value),
      topeDiario: Number(document.getElementById('edRoutineTopeDiario').value),
      cantidad: Number(document.getElementById('edRoutineCantidad').value)
    };

    const rutinas = (fullDashboardData?.resumen?.regla?.rutinas || []).map(r => r.tipo === tipo ? { ...r, ...updated } : r);
    const run = async () => {
      try {
        await edApi(`${edBase(currentEdOffice)}/editorial`, { method: 'PUT', body: JSON.stringify({ rutinas }) });
        document.getElementById('edRoutineDialog')?.close();
        edToast('Routine saved.');
        await loadFullDashboard(currentEdOffice);
      } catch (err) { document.getElementById('edRoutineHint').textContent = err.message; }
    };
    if (typeof withBusy === 'function' && ev.submitter) await withBusy(ev.submitter, run);
    else await run();
  });
}

// Global click handler para elementos dinámicos (solo en navegador real)
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('click', async ev => {
    const hourBtn = ev.target.closest('[data-ed-change-hour]');
    if (hourBtn) {
      const pid = hourBtn.dataset.edChangeHour;
      const p = (fullDashboardData?.propuestas || editorialData?.propuestas || []).find(x => x.id === pid);
      if (!p) return;
      document.getElementById('edHourPid').value = pid;
      if (p.hora) {
        const dt = new Date(p.hora);
        const iso = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('edHourValue').value = iso;
      }
      document.getElementById('edHourHint').textContent = '';
      document.getElementById('edHourDialog')?.showModal();
      return;
    }

    const button = ev.target.closest('[data-ed-action]');
    if (!button) return;
    const card = button.closest('[data-proposal]');
    const pid = card?.dataset.proposal;
    const p = (fullDashboardData?.propuestas || editorialData?.propuestas || []).find(x => x.id === pid);
    if (!p) return;

    const action = button.dataset.edAction;
    const semaforo = p.verificacion?.semaforo || button.dataset.semaforo || 'amarillo';

    if (action === 'aprobar') {
      if (semaforo === 'rojo') {
        alert(t('ed.light.redBlockedPrompt'));
        return;
      }
      if (semaforo === 'amarillo') {
        yellowConfirmProposal = p;
        const sourcesList = document.getElementById('edYellowSourcesList');
        if (sourcesList) {
          const e = getEsc();
          sourcesList.innerHTML = (p.verificacion?.fuentes || []).map(f => `<div class="ed-source-item"><a href="${e(edLink(f.url))}" target="_blank">↗ ${e(f.titulo || f.url)}</a></div>`).join('');
        }
        const yDlg = document.getElementById('edConfirmYellowDialog');
        if (yDlg?.showModal) {
          yDlg.showModal();
          return;
        }
        if (!confirm(t('ed.light.confirmPrompt'))) return;
        const off = typeof oficina !== 'undefined' ? oficina : currentEdOffice;
        try {
          await edApi(`${edBase(off)}/editorial/propuestas/${encodeURIComponent(p.id)}/aprobar`, {
            method: 'POST',
            body: JSON.stringify({ confirmarAmarillo: true })
          });
          edToast('Proposal approved.');
          if (document.getElementById('edDashboard')) await loadFullDashboard(currentEdOffice);
          else await loadEditorial();
        } catch (err) { edToast(err.message); }
        return;
      }
    }

    decisionEditing = {
      office: typeof oficina !== 'undefined' ? oficina : currentEdOffice,
      epoch: typeof officeEpoch !== 'undefined' ? officeEpoch : 0,
      pid: p.id,
      action
    };

    const titleEl = typeof $ === 'function' ? $('edDecisionTitle') : document.getElementById('edDecisionTitle');
    if (titleEl) titleEl.textContent = { aprobar: t('ed.titleApprove'), cambios: t('ed.titleChanges'), rechazar: t('ed.titleReject') }[action] || action;
    const hookEl = typeof $ === 'function' ? $('edDecisionHook') : document.getElementById('edDecisionHook');
    if (hookEl) hookEl.textContent = p.hook;
    const explainEl = typeof $ === 'function' ? $('edDecisionExplain') : document.getElementById('edDecisionExplain');
    if (explainEl) {
      const dest = editorialData?.regla?.destino || fullDashboardData?.resumen?.regla?.destino;
      explainEl.textContent = action === 'aprobar'
        ? (dest === 'agendar' ? t('ed.explainApproveSchedule') : t('ed.explainApproveDraft'))
        : action === 'cambios' ? t('ed.explainChanges') : t('ed.explainReject');
    }
    const checks = typeof $ === 'function' ? $('edChecks') : document.getElementById('edChecks');
    if (checks) {
      checks.hidden = action !== 'cambios';
      if (typeof checks.querySelectorAll === 'function') checks.querySelectorAll('input').forEach(i => { i.checked = false; });
    }
    const noteEl = typeof $ === 'function' ? $('edNote') : document.getElementById('edNote');
    if (noteEl) {
      noteEl.value = '';
      noteEl.required = action === 'rechazar';
    }
    const hintEl = typeof $ === 'function' ? $('edDecisionHint') : document.getElementById('edDecisionHint');
    if (hintEl) hintEl.textContent = '';
    const dDlg = typeof $ === 'function' ? $('decisionDialog') : document.getElementById('decisionDialog');
    if (dDlg?.showModal) dDlg.showModal();
  });
}

// Auto-arranque si estamos en /editorial.html
if (typeof document !== 'undefined' && document.getElementById('edDashboard')) {
  if (typeof I18N !== 'undefined' && I18N.ready) {
    I18N.ready.then(initEditorialDashboard);
  } else if (typeof document.addEventListener === 'function') {
    document.addEventListener('DOMContentLoaded', initEditorialDashboard);
  }
}
