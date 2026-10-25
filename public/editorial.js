// Bandeja por oficina. Captura oficina y época antes de cada petición: una respuesta tardía no cruza marcas.
let editorialData = null, editorialSeq = 0, editorialEditing = null, decisionEditing = null;
const edBase = id => `/api/oficinas/${encodeURIComponent(id)}`;
// El estado se guarda en español (lib/editorial.js ESTADOS); aquí solo se traduce la etiqueta.
const ED_STATES = ['pendiente', 'en-cambios', 'aprobada', 'rechazada', 'descartada'];
const edLink = value => { try { const u = new URL(value, location.origin); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const edDate = (value, zona) => value ? new Date(value).toLocaleString((typeof I18N !== 'undefined' && I18N.lang === 'es') ? 'es-MX' : 'en-US', { timeZone: zona || 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' }) : t('ed.noTime');

async function loadEditorial() {
  const seq = ++editorialSeq, epoch = officeEpoch, office = oficina, box = $('tab-editorial');
  if (!box) return;
  if (office === 'edificio') { editorialData = null; box.innerHTML = `<p class="muted">${t('ed.chooseOffice')}</p>`; return; }
  try {
    const [data, propuestas] = await Promise.all([api(`${edBase(office)}/editorial`), api(`${edBase(office)}/editorial/propuestas`)]);
    if (seq !== editorialSeq || epoch !== officeEpoch || office !== oficina) return;
    editorialData = { ...data, propuestas, office };
    const r = data.regla;
    const destText = r.destino === 'agendar' ? t('ed.destSchedule') : t('ed.destDraft');
    const statusText = data.abierta ? t('ed.statusRunning') : r.activa ? t('ed.statusActive') : t('ed.statusPaused');
    box.innerHTML = `<header class="ed-toolbar"><div><h2>${t('ed.proposals')} <small>${t('ed.toDecide', { count: propuestas.filter(p => p.estado === 'pendiente').length })}</small></h2>
      <p>${esc(r.marca.nombre || officeNow().nombre)} · ${esc(statusText)} · ${esc(r.zona)}</p>
      <p>${t('ed.infoLine', { hours: r.horas.map(esc).join(' / '), dest: esc(destText) })}</p></div>
      <div class="ed-actions"><button class="btn ghost" data-ed-config>${t('ed.btnConfig')}</button><button class="btn" data-ed-tanda ${!data.configurada || data.abierta ? 'disabled' : ''}>${t('ed.btnNewBatch')}</button></div></header>
      ${!data.viralhunt.configurado ? `<p class="ed-notice">${t('ed.connectNotice')}</p>` : ''}
      ${propuestas.length ? `<div class="ed-grid">${propuestas.map(p => edCard(p, r, office)).join('')}</div>` : `<div class="ed-empty"><h3>${t('ed.emptyTitle')}</h3><p>${t('ed.emptyText')}</p></div>`}`;
  } catch (err) { if (seq === editorialSeq && epoch === officeEpoch) box.textContent = t('ed.loadError', { err: err.message }); }
}

function edCard(p, r, office) {
  const file = name => `${edBase(office)}/editorial/propuestas/${encodeURIComponent(p.id)}/archivo/${encodeURIComponent(name)}`;
  const source = edLink(p.fuente?.url), result = edLink(p.viralhunt?.url);
  const destino = { borrador: t('ed.destDraftCard'), revision: t('ed.destReviewCard'), agendado: t('ed.destScheduledCard') };
  return `<article class="ed-card" data-proposal="${esc(p.id)}">
    ${p.imagenes?.length ? `<img class="ed-image" src="${file(p.imagenes[0])}" alt="${esc(p.hook)}" loading="lazy">` : `<div class="ed-no-image">${t('ed.noImage')}</div>`}
    <div class="ed-card-body"><div class="ed-meta"><span class="ed-state">${esc(ED_STATES.includes(p.estado) ? t(`ed.state.${p.estado}`) : p.estado)}</span><span>v${p.version}</span></div>
    <h3>${esc(p.hook)}</h3><p class="muted">${esc(p.tema)} · ${esc(p.porQue)}</p>
    ${Object.entries(p.copy || {}).map(([red, copy]) => `<details class="ed-copy" open><summary>${esc(red)}</summary><p>${esc(copy)}</p></details>`).join('')}
    <p class="ed-tags">${(p.hashtags || []).map(tag => `#${esc(tag.replace(/^#/, ''))}`).join(' ')}</p>
    <p>↗ ${source ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">${esc(p.fuente?.nombre || t('ed.sourceLabel'))}</a>` : t('ed.noSource')}<br><small class="muted">${esc(Object.entries(p.fuente?.metricas || {}).map(([k, v]) => `${k}: ${v}`).join(' · '))}</small></p>
    <p>◷ ${esc(edDate(p.hora, r.zona))}<br><small class="muted">${esc(r.zona)} · ${(p.idiomas || []).map(esc).join(', ')}</small></p>
    ${p.motivoDescarte ? `<p class="ed-notice">${esc(p.motivoDescarte)}</p>` : ''}
    ${p.estado === 'en-cambios' ? `<p role="status">${t('ed.adjusting', { note: esc(p.cambiosPedidos?.nota || '') })}</p>` : ''}
    ${p.viralhunt ? `<p class="ed-result">✓ ${esc(destino[p.viralhunt.donde] || p.viralhunt.donde)}${result ? ` · <a href="${esc(result)}" target="_blank" rel="noopener noreferrer">${t('ed.openPost')}</a>` : ''}</p>` : ''}
    ${p.estado === 'pendiente' ? `<div class="ed-actions"><button class="btn" data-ed-action="aprobar">${t('ed.btnApprove')}</button><button class="btn ghost" data-ed-action="cambios">${t('ed.btnChanges')}</button><button class="btn ghost" data-ed-action="rechazar">${t('ed.btnReject')}</button></div>` : ''}</div></article>`;
}

// Diálogos fuera del formulario de oficina para evitar formularios anidados.
document.body.insertAdjacentHTML('beforeend', `<dialog id="editorialDialog" class="viewer tpl-dialog"><header><span data-i18n="ed.dialogTitle">⚙ EDITORIAL</span><button class="btn ghost" data-close aria-label="Cerrar" data-i18n-aria-label="ui.close">✕</button></header>
  <form id="editorialForm" class="tpl-form ed-form"><p id="edConfigHint" role="status"></p><div id="edFields" class="ed-fields"></div>
  <fieldset><legend data-i18n="ed.vhConnectionLegend">ViralHunt · office connection</legend><p id="edTokenState"></p><label><span data-i18n="ed.writerTokenLabel">Writer token</span> <input id="edToken" class="field" type="password" autocomplete="new-password" data-i18n-placeholder="ed.tokenPlaceholder" placeholder="Paste new token"></label>
  <div class="ed-actions"><button type="button" class="btn ghost" id="edTokenSave">${t('ed.btnSaveToken')}</button><button type="button" class="btn ghost" id="edTokenTest">${t('ed.btnTestToken')}</button><button type="button" class="btn ghost" id="edTokenDelete">${t('ed.btnDeleteToken')}</button></div><p id="edConnection" role="status"></p></fieldset>
  <button class="btn" type="submit" id="edSaveRuleBtn">${t('ed.btnSaveRule')}</button></form></dialog>
  <dialog id="decisionDialog" class="viewer tpl-dialog"><header><span id="edDecisionTitle"></span><button class="btn ghost" data-close aria-label="Cerrar" data-i18n-aria-label="ui.close">✕</button></header>
  <form id="edDecisionForm" class="tpl-form"><p id="edDecisionHook"></p><p id="edDecisionExplain"></p><fieldset id="edChecks"><legend data-i18n="ed.whatToChange">${t('ed.whatToChange')}</legend><label><input type="checkbox" name="aspecto" value="imagen"> ${t('ed.aspect.imagen')}</label><label><input type="checkbox" name="aspecto" value="texto"> ${t('ed.aspect.texto')}</label><label><input type="checkbox" name="aspecto" value="hook"> ${t('ed.aspect.hook')}</label><label><input type="checkbox" name="aspecto" value="tema"> ${t('ed.aspect.tema')}</label><label><input type="checkbox" name="aspecto" value="hora"> ${t('ed.aspect.hora')}</label></fieldset><label><span data-i18n="ed.noteForTeam">${t('ed.noteForTeam')}</span> <textarea class="field" rows="3" maxlength="600" id="edNote"></textarea></label><p id="edDecisionHint" role="alert"></p><button class="btn" id="edDecisionSend">${t('ed.btnConfirm')}</button></form></dialog>`);

async function openEditorialConfig() {
  const office = oficina, epoch = officeEpoch;
  await loadEditorial();
  if (office !== oficina || epoch !== officeEpoch || !editorialData || editorialData.office !== oficina) return;
  editorialEditing = { office: oficina, epoch: officeEpoch };
  const r = editorialData.regla;
  const field = (label, name, value, type = 'text') => `<label>${label}<input class="field" name="${name}" type="${type}" value="${esc(value)}" ${type === 'number' ? 'min="1" max="10"' : ''}></label>`;
  $('edFields').innerHTML = `<label><input type="checkbox" name="activa" ${r.activa ? 'checked' : ''}> ${t('ed.activateBatches')}</label>
    ${field(t('ed.fieldBrand'), 'marca', r.marca.nombre)}${field(t('ed.fieldTone'), 'tono', r.marca.tono)}${field(t('ed.fieldLanguages'), 'idiomas', r.idiomas.join(', '))}${field(t('ed.fieldNiches'), 'nichos', r.nichos.join(', '))}
    ${field(t('ed.fieldSources'), 'fuentes', r.fuentes.join(', '))}${field(t('ed.fieldNetworks'), 'redes', r.redes.join(', '))}
    ${field(t('ed.fieldProposals'), 'cantidad', r.propuestasPorTanda, 'number')}${field(t('ed.fieldTimezone'), 'zona', r.zona)}${field(t('ed.fieldMorning'), 'manana', r.horas[0], 'time')}${field(t('ed.fieldAfternoon'), 'tarde', r.horas[1] || '17:00', 'time')}
    <label>${t('ed.fieldMode')} <select class="field" name="modo"><option value="consejo">${t('ed.modeCouncil')}</option><option value="relevo">${t('ed.modeRelay')}</option></select></label>
    <label>${t('ed.fieldOnApprove')} <select class="field" name="destino"><option value="borrador">${t('ed.optDraft')}</option><option value="agendar">${t('ed.optSchedule')}</option></select></label>
    ${field(t('ed.fieldVhProject'), 'proyecto', r.viralhunt.proyecto)}${field(t('ed.fieldVhProjectId'), 'proyectoId', r.viralhunt.proyectoId || '')}${field(t('ed.fieldVhAccounts'), 'cuentas', r.viralhunt.cuentas.join(', '))}
    <label class="ed-wide">${t('ed.fieldTeam')}<textarea class="field" rows="4" name="equipo">${esc(r.equipo.map(e => `${e.id} | ${e.rol}`).join('\n'))}</textarea></label>
    ${field(t('ed.fieldDoNotPublish'), 'noPublicar', r.reglas.noPublicar.join(', '))}<label><input name="fuente" type="checkbox" ${r.reglas.fuenteObligatoria ? 'checked' : ''}> ${t('ed.fieldSourceMandatory')}</label><p>${t('ed.ruleNote')}</p>`;
  $('editorialForm').elements.modo.value = r.modo;
  $('editorialForm').elements.destino.value = r.destino;
  $('edToken').value = ''; $('edConfigHint').textContent = ''; $('edConnection').textContent = '';
  $('edTokenState').textContent = editorialData.viralhunt.configurado ? t('ed.tokenStateConfigured') : t('ed.tokenStateEmpty');
  $('editorialDialog').showModal();
}
const edStillEditing = ctx => ctx && ctx.office === oficina && ctx.epoch === officeEpoch && ctx === editorialEditing;
document.getElementById('officeEditorialBtn').onclick = () => { $('officeDialog').close(); openEditorialConfig(); };
document.getElementById('editorialDialog').addEventListener('close', () => { $('edToken').value = ''; editorialEditing = null; });
document.getElementById('editorialForm').addEventListener('submit', async e => {
  e.preventDefault(); const ctx = editorialEditing; if (!edStillEditing(ctx)) return;
  const f = e.target.elements, split = v => v.split(',').map(x => x.trim()).filter(Boolean);
  const body = { activa: f.activa.checked, marca: { nombre: f.marca.value, tono: f.tono.value }, idiomas: split(f.idiomas.value), nichos: split(f.nichos.value), fuentes: split(f.fuentes.value), redes: split(f.redes.value), propuestasPorTanda: Number(f.cantidad.value), zona: f.zona.value, horas: [f.manana.value, f.tarde.value], modo: f.modo.value, destino: f.destino.value,
    equipo: f.equipo.value.split('\n').filter(x => x.trim()).map(x => { const [id, ...rol] = x.split('|'); return { id: id.trim(), rol: rol.join('|').trim() }; }),
    viralhunt: { proyecto: f.proyecto.value, proyectoId: f.proyectoId.value, cuentas: split(f.cuentas.value).map(Number) }, reglas: { noPublicar: split(f.noPublicar.value), fuenteObligatoria: f.fuente.checked } };
  await withBusy(e.submitter, async () => { try { await api(`${edBase(ctx.office)}/editorial`, { method: 'PUT', body: JSON.stringify(body) }); if (edStillEditing(ctx)) { $('editorialDialog').close(); await loadEditorial(); } } catch (err) { if (edStillEditing(ctx)) $('edConfigHint').textContent = err.message; } });
});
for (const [id, method, suffix] of [['edTokenSave', 'PUT', ''], ['edTokenTest', 'POST', '/probar'], ['edTokenDelete', 'DELETE', '']]) {
  document.getElementById(id).onclick = e => withBusy(e.target, async () => {
    const ctx = editorialEditing; if (!edStillEditing(ctx)) return;
    const body = method === 'PUT' ? JSON.stringify({ token: $('edToken').value.trim() }) : '{}';
    $('edToken').value = '';
    try {
      const result = await api(`${edBase(ctx.office)}/viralhunt${suffix}`, { method, ...(method === 'DELETE' ? {} : { body }) });
      if (!edStillEditing(ctx)) return;
      $('edConnection').textContent = suffix ? `${result.error ? t('ed.connPartial', { err: result.error }) : t('ed.connOk')} · ${t('ed.planLine', { plan: result.plan })} · ${t('ed.projectsLine', { projects: (result.proyectos || []).map(x => `${x.name} (${x.id})`).join(', ') })} · ${t('ed.accountsLine', { accounts: (result.cuentas || []).map(x => `${x.name} (${x.account_id})`).join(', ') })}` : t('ed.connUpdated');
      await loadEditorial();
      if (edStillEditing(ctx)) $('edTokenState').textContent = editorialData.viralhunt.configurado ? t('ed.tokenStateConfigured') : t('ed.tokenStateEmpty');
    } catch (err) { if (edStillEditing(ctx)) $('edConnection').textContent = err.message; }
  });
}
document.getElementById('tab-editorial').addEventListener('click', async e => {
  if (e.target.closest('[data-ed-config]')) return openEditorialConfig();
  const tanda = e.target.closest('[data-ed-tanda]');
  if (tanda) return withBusy(tanda, async () => { const office = oficina, epoch = officeEpoch; try { await api(`${edBase(office)}/editorial/tanda`, { method: 'POST', body: '{}' }); if (epoch === officeEpoch) { toast(t('ed.toastBatchStarted')); loadEditorial(); } } catch (err) { if (epoch === officeEpoch) toast(err.message, true); } });
  const button = e.target.closest('[data-ed-action]'); if (!button) return;
  const p = editorialData?.propuestas.find(p => p.id === button.closest('[data-proposal]').dataset.proposal); if (!p) return;
  decisionEditing = { office: oficina, epoch: officeEpoch, pid: p.id, action: button.dataset.edAction };
  const action = decisionEditing.action;
  $('edDecisionTitle').textContent = { aprobar: t('ed.titleApprove'), cambios: t('ed.titleChanges'), rechazar: t('ed.titleReject') }[action];
  $('edDecisionHook').textContent = p.hook;
  $('edDecisionExplain').textContent = action === 'aprobar' ? (editorialData.regla.destino === 'agendar' ? t('ed.explainApproveSchedule') : t('ed.explainApproveDraft')) : action === 'cambios' ? t('ed.explainChanges') : t('ed.explainReject');
  $('edChecks').hidden = action !== 'cambios'; $('edNote').value = ''; $('edNote').required = action === 'rechazar';
  $('edChecks').querySelectorAll('input').forEach(i => { i.checked = false; }); $('edDecisionHint').textContent = '';
  $('decisionDialog').showModal();
});
document.getElementById('edDecisionForm').addEventListener('submit', async e => {
  e.preventDefault(); const ctx = decisionEditing; if (!ctx || ctx.office !== oficina || ctx.epoch !== officeEpoch) return;
  const nota = $('edNote').value.trim(), casillas = [...$('edChecks').querySelectorAll('input:checked')].map(i => i.value);
  if (ctx.action === 'cambios' && !nota && !casillas.length) { $('edDecisionHint').textContent = t('ed.hintChanges'); return; }
  await withBusy(e.submitter, async () => {
    try { await api(`${edBase(ctx.office)}/editorial/propuestas/${encodeURIComponent(ctx.pid)}/${ctx.action}`, { method: 'POST', body: JSON.stringify({ nota, casillas }) }); if (ctx === decisionEditing && ctx.epoch === officeEpoch) { $('decisionDialog').close(); await loadEditorial(); } }
    catch (err) { if (ctx === decisionEditing && ctx.epoch === officeEpoch) $('edDecisionHint').textContent = err.message; }
  });
});
document.getElementById('decisionDialog').addEventListener('close', () => { decisionEditing = null; });
