// Gráficas del centro de mando, en SVG a mano (sin librerías). Cada función devuelve HTML; el tooltip
// lo pone app.js leyendo data-tip de cualquier marca. Reglas: color = identidad del agente (paleta validada
// en agents.json), texto siempre en tinta neutra, rejilla fina y recesiva, leyenda + etiqueta directa.
(function () {
  const isBrowser = typeof window !== 'undefined';
  const shortHome = isBrowser ? (p => globalThis.I18N.shortHome(p)) : require('../public/i18n').shortHome;
  const i18nServer = !isBrowser ? (function () { try { return require('../lib/i18n'); } catch { return null; } })() : null;
  const t = (key, vars = {}) => {
    if (isBrowser && typeof window.t === 'function') return window.t(key, vars);
    if (typeof globalThis.t === 'function') return globalThis.t(key, vars);
    if (i18nServer && typeof i18nServer.t === 'function') return i18nServer.t(key, vars);
    return key;
  };
  const getLang = () => {
    if (isBrowser && window.I18N?.lang) return window.I18N.lang;
    if (typeof globalThis.I18N?.lang === 'string') return globalThis.I18N.lang;
    if (i18nServer && typeof i18nServer.getLang === 'function') return i18nServer.getLang();
    return 'en';
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hhmm = t => new Date(t).toLocaleTimeString(getLang() === 'es' ? 'es-MX' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dur = s => (s >= 3600 ? `${Math.floor(s / 3600)}h${String(Math.floor(s / 60) % 60).padStart(2, '0')}` : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`);
  const phaseName = m => {
    const key = `ui.phase.${m.phase}`;
    const name = t(key);
    return name === key ? m.phase : name;
  };
  // Mismo criterio que app.js: el código interno (APROBADO) no es la etiqueta.
  const verdictLabel = v => {
    if (!v) return '';
    const key = `handoff.verdict.${v}`;
    const s = t(key);
    return s === key ? String(v).replace(/_/g, ' ') : s;
  };
  const stepOf = m => (m.phase ? `${phaseName(m)}${m.round ? ` · ${t('ch.step.round', { n: m.round })}` : ''}` : t('ch.step.round', { n: m.round }));

  const legend = list => `<div class="ch-legend">${list.map(a => `<span><i style="background:${esc(a.color)}"></i>${esc(a.name)}</span>`).join('')}</div>`;
  const card = (title, sub, body) => `<section class="ch-card"><header><h3>${esc(title)}</h3>${sub ? `<span>${esc(sub)}</span>` : ''}</header>${body}</section>`;

  // 1) Notas por turno: una línea por agente sobre la secuencia de turnos, con la nota mínima como referencia.
  function scoreLine(turns, agents, minScore, width) {
    const pts = turns.filter(m => typeof m.score === 'number' && m.verdict !== 'ERROR');
    if (!pts.length) return card(t('ch.score.title'), '', `<p class="ch-empty">${t('ch.score.empty')}</p>`);
    const W = Math.max(240, width), H = 230, L = 34, R = 92, T = 14, B = 26;
    const lo = Math.max(0, Math.min(6, Math.floor(Math.min(...pts.map(m => m.score)) - 1)));
    const n = turns.length;
    const x = i => L + (n === 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
    const y = s => T + (1 - (s - lo) / (10 - lo)) * (H - T - B);
    const idx = new Map(turns.map((m, i) => [m, i]));
    let svg = '';
    for (let s = lo; s <= 10; s += (10 - lo > 6 ? 2 : 1)) {
      svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(s)}" y2="${y(s)}"/><text class="tick" x="${L - 8}" y="${y(s) + 4}" text-anchor="end">${s}</text>`;
    }
    if (minScore >= lo) svg += `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(minScore)}" y2="${y(minScore)}"/><text class="tick ref-t" x="${L + 6}" y="${y(minScore) - 5}">${t('ch.score.minRef', { score: minScore })}</text>`;
    const used = agents.filter(a => pts.some(m => m.agentId === a.id));
    const ends = [];
    for (const a of used) {
      const mine = pts.filter(m => m.agentId === a.id);
      const path = mine.map((m, i) => `${i ? 'L' : 'M'}${x(idx.get(m)).toFixed(1)},${y(m.score).toFixed(1)}`).join('');
      svg += `<path d="${path}" fill="none" stroke="${esc(a.color)}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      for (const m of mine) {
        const tip = t('ch.score.tip', { name: a.name, step: stepOf(m), score: m.score, verdict: verdictLabel(m.verdict), time: hhmm(m.ts), dur: dur(m.seconds || 0) });
        svg += `<g class="mk" data-tip="${esc(tip)}"><circle cx="${x(idx.get(m))}" cy="${y(m.score)}" r="11" fill="transparent"/>` +
          `<circle cx="${x(idx.get(m))}" cy="${y(m.score)}" r="4" fill="${esc(a.color)}" stroke="var(--panel)" stroke-width="2"/></g>`;
      }
      const last = mine[mine.length - 1];
      ends.push({ a, x: x(idx.get(last)), y: y(last.score), score: last.score });
    }
    const placed = [];
    for (const e of ends.sort((p, q) => q.x - p.x)) {
      const label = `${e.a.name} ${e.score}`;
      const x0 = Math.min(e.x + 9, W - R + 6), x1 = x0 + label.length * 6.2;
      if (placed.some(b => Math.abs(b.y - e.y) < 12 && x0 < b.x1 && b.x0 < x1)) continue;
      placed.push({ x0, x1, y: e.y });
      svg += `<text class="end" x="${x0}" y="${e.y + 4}">${esc(label)}</text>`;
    }
    svg += `<text class="tick" x="${L}" y="${H - 6}">${t('ch.score.turn', { n: 1 })}</text><text class="tick" x="${W - R}" y="${H - 6}" text-anchor="end">${t('ch.score.turn', { n })}</text>`;
    return card(t('ch.score.title'), t('ch.score.sub'),
      legend(used) + `<svg class="ch" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${t('ch.score.title')}">${svg}</svg>`);
  }

  // 2) Línea de tiempo (Gantt): quién trabajó cuándo. En los modos paralelos se ven las barras solaparse.
  function timeline(turns, live, agents, width, now) {
    const bars = turns.map(m => ({ m, a: agents.find(x => x.id === m.agentId), start: new Date(m.ts).getTime() - (m.seconds || 0) * 1000, end: new Date(m.ts).getTime() }));
    for (const l of live) bars.push({ live: true, l, a: agents.find(x => x.id === l.agentId), start: l.started, end: now });
    const rows = agents.filter(a => bars.some(b => b.a?.id === a.id));
    if (!rows.length) return card(t('ch.time.title'), '', `<p class="ch-empty">${t('ch.time.empty')}</p>`);
    const W = Math.max(320, width), rowH = 26, L = 76, R = 14, T = 8, B = 24;
    const H = T + rows.length * rowH + B;
    const t0 = Math.min(...bars.map(b => b.start)), t1 = Math.max(...bars.map(b => b.end), t0 + 60000);
    const x = t => L + ((t - t0) / (t1 - t0)) * (W - L - R);
    let svg = '';
    const fmt = t1 - t0 < 10 * 60000 ? t => new Date(t).toLocaleTimeString(getLang() === 'es' ? 'es-MX' : 'en-US', { hour12: false }) : hhmm;
    const ticks = Math.max(1, Math.min(5, Math.floor((W - L - R) / (t1 - t0 < 10 * 60000 ? 70 : 50))));
    for (let i = 0; i <= ticks; i++) {
      const t = t0 + ((t1 - t0) * i) / ticks;
      svg += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${T}" y2="${H - B}"/><text class="tick" x="${x(t)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === ticks ? 'end' : 'middle'}">${fmt(t)}</text>`;
    }
    rows.forEach((a, r) => {
      const cy = T + r * rowH + rowH / 2;
      svg += `<text class="row-l" x="${L - 10}" y="${cy + 4}" text-anchor="end">${esc(a.name)}</text>`;
      for (const b of bars.filter(z => z.a?.id === a.id)) {
        const w = Math.max(3, x(b.end) - x(b.start));
        const tip = b.live
          ? `${a.name} · ${t('ch.time.working')}\n${b.l.activity || ''}\n${t('ch.time.since', { time: hhmm(b.start), dur: dur(Math.round((now - b.start) / 1000)) })}`
          : t('ch.time.tip', { name: a.name, step: stepOf(b.m), start: hhmm(b.start), end: hhmm(b.end), dur: dur(b.m.seconds || 0), verdict: verdictLabel(b.m.verdict), score: b.m.score != null ? t('ch.time.scorePart', { score: b.m.score }) : '' });
        svg += `<rect class="${b.live ? 'bar live' : b.m.verdict === 'ERROR' ? 'bar err' : 'bar'}" x="${x(b.start) + 1}" y="${cy - 7}" width="${Math.max(2, w - 2)}" height="14" rx="3" fill="${esc(a.color)}" data-tip="${esc(tip)}"/>`;
      }
    });
    return card(t('ch.time.title'), t('ch.time.sub'), `<svg class="ch" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${t('ch.time.title')}">${svg}</svg>`);
  }

  // 3) Tiempo de trabajo por agente (barras horizontales con el valor en la punta).
  function timeBars(stats, agents, width) {
    const rows = stats.filter(s => s.turns).map(s => ({ s, a: agents.find(x => x.id === s.id) || { name: s.name, color: '#7d8a9c' } }));
    if (!rows.length) return card(t('ch.bars.title'), '', `<p class="ch-empty">${t('ch.bars.empty')}</p>`);
    const W = Math.max(280, width), rowH = 28, L = 76, R = 120, T = 6;
    const H = T + rows.length * rowH + 4;
    const max = Math.max(...rows.map(r => r.s.seconds), 1);
    let svg = '';
    rows.forEach((r, i) => {
      const cy = T + i * rowH + rowH / 2;
      const w = Math.max(4, (r.s.seconds / max) * (W - L - R));
      svg += `<text class="row-l" x="${L - 10}" y="${cy + 4}" text-anchor="end">${esc(r.a.name)}</text>` +
        `<path d="M${L},${cy - 8}h${w - 4}a4,4 0 0 1 4,4v8a4,4 0 0 1 -4,4h${-(w - 4)}z" fill="${esc(r.a.color)}" data-tip="${esc(t('ch.bars.tip', { name: r.a.name, dur: dur(r.s.seconds), turns: r.s.turns, avg: dur(r.s.avgSeconds) }))}"/>` +
        `<text class="val" x="${L + w + 8}" y="${cy + 4}">${t('ch.bars.val', { dur: dur(r.s.seconds), turns: r.s.turns })}</text>`;
    });
    return card(t('ch.bars.title'), t('ch.bars.sub'), `<svg class="ch" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${t('ch.bars.title')}">${svg}</svg>`);
  }

  // 4) Quién revisó a quién (modos paralelos): fila = revisor, columna = autor del borrador, celda = última nota.
  function reviewMatrix(turns, agents, anon, width) {
    const cells = new Map();
    for (const m of turns) {
      if (m.phase === 'revision' && m.targetOwner && typeof m.score === 'number') cells.set(`${m.agentId}>${m.targetOwner}`, m.score);
      if (m.phase === 'evaluacion' && m.ratingOwners) for (const [owner, s] of Object.entries(m.ratingOwners)) cells.set(`${m.agentId}>${owner}`, s);
    }
    if (!cells.size) return '';
    const ids = agents.filter(a => [...cells.keys()].some(k => k.split('>').includes(a.id)));
    const letterOf = id => Object.keys(anon || {}).find(l => anon[l] === id);
    const size = Math.min(64, Math.max(40, (Math.min(width, 520) - 90) / ids.length));
    const L = 82, T = 34, W = L + ids.length * size + 8, H = T + ids.length * size + 8;
    let svg = '';
    ids.forEach((a, j) => { svg += `<text class="row-l" x="${L + j * size + size / 2}" y="${T - 18}" text-anchor="middle">${esc(a.name)}</text><text class="tick" x="${L + j * size + size / 2}" y="${T - 5}" text-anchor="middle">${letterOf(a.id) ? esc(t('ch.matrix.draft', { letter: letterOf(a.id) })) : ''}</text>`; });
    ids.forEach((rev, i) => {
      svg += `<text class="row-l" x="${L - 10}" y="${T + i * size + size / 2 + 4}" text-anchor="end">${esc(rev.name)}</text>`;
      ids.forEach((own, j) => {
        const v = cells.get(`${rev.id}>${own.id}`);
        const x = L + j * size + 1, y = T + i * size + 1;
        if (v == null) { svg += `<rect x="${x}" y="${y}" width="${size - 2}" height="${size - 2}" rx="3" class="cell-empty"/>`; return; }
        const k = Math.max(0, Math.min(1, (v - 5) / 5));
        svg += `<g data-tip="${esc(t('ch.matrix.tip', { rev: rev.name, own: own.name, draft: letterOf(own.id) ? ` (${t('ch.matrix.draft', { letter: letterOf(own.id) })})` : '', score: v }))}">` +
          `<rect x="${x}" y="${y}" width="${size - 2}" height="${size - 2}" rx="3" class="cell" fill-opacity="${(0.08 + k * 0.62).toFixed(2)}"/>` +
          `<text class="cell-v${k > 0.7 ? ' strong' : ''}" x="${x + (size - 2) / 2}" y="${y + (size - 2) / 2 + 4}" text-anchor="middle">${v}</text></g>`;
      });
    });
    return card(t('ch.matrix.title'), t('ch.matrix.sub'),
      `<svg class="ch" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${t('ch.matrix.title')}">${svg}</svg>`);
  }

  // 5) Convergencia por ronda. La media es la de roundMean (D46): misma fórmula, mismas exclusiones.
  const CUT = new Set(['ERROR', 'PARCIAL']);

  function oneCycle(list) {
    const ids = [...new Set(list.map(t => t.cycle).filter(c => c != null))];
    if (ids.length <= 1) return list;
    const last = Math.max(...ids);
    return list.filter(t => t.cycle === last);
  }

  function reviewOf(list, workflow) {
    const wf = workflow || (
      list.some(m => m.phase === 'aprobacion' || m.phase === 'sintesis' || m.phase === 'evaluacion') ? 'consejo'
      : list.some(m => m.phase === 'revision' || m.phase === 'borrador') ? 'delphi'
      : 'relevo');
    if (wf === 'consejo') return list.filter(m => m.phase === 'aprobacion');
    if (wf === 'delphi') return list.filter(m => m.phase === 'revision');
    return list.filter(m => !m.phase || m.phase === 'relevo');
  }

  function expectedAt(list, round, base) {
    const n = Number(base) || 0;
    if (n <= 0) return 0;
    const gone = new Set();
    for (const t of list) if (t.round < round && t.verdict === 'ERROR' && t.agentId) gone.add(t.agentId);
    return Math.max(1, n - gone.size);
  }

  function meanOf(list, round, expected) {
    const ts = list.filter(t => t.round === round);
    if (!ts.length) return null;
    const reviews = ts.filter(t => !t.self);
    const bad = (expected > 0 && ts.length < expected)
      || ts.some(t => CUT.has(t.verdict))
      || !reviews.length
      || reviews.some(t => typeof t.score !== 'number');
    if (bad) return { round, mean: null };
    return {
      round,
      mean: Math.round(reviews.reduce((s, t) => s + t.score, 0) / reviews.length * 100) / 100,
      count: reviews.length,
      scores: reviews.map(t => t.score),
    };
  }

  function convergence(turns, minScore, width, options = {}) {
    const scoped = oneCycle(turns || []);
    if (!scoped.length) return card(t('ch.conv.title'), t('ch.conv.sub'), `<p class="ch-empty">${t('ch.conv.empty')}</p>`);
    const review = reviewOf(scoped, options.workflow);
    const nums = review.map(t => t.round).filter(r => Number.isInteger(r) && r >= 1);
    if (!nums.length) {
      return card(t('ch.conv.title'), t('ch.conv.sub'), `<p class="ch-empty">${t('ch.conv.emptyCouncil')}</p>`);
    }
    const maxRound = Math.max(...nums);
    const plotted = [];
    const holes = [];
    for (let r = 1; r <= maxRound; r++) {
      const row = meanOf(review, r, expectedAt(review, r, options.expected));
      if (!row) continue;
      if (row.mean == null) holes.push(r);
      else plotted.push(row);
    }
    const stamp = `<span hidden data-round-mean="${plotted.map(r => `${r.round}:${r.mean}`).join(',')}"></span>`;
    if (!plotted.length) {
      return card(t('ch.conv.title'), t('ch.conv.subIncomplete'), stamp + `<p class="ch-empty">${t('ch.conv.emptyIncomplete')}</p>`);
    }
    for (const row of plotted) {
      const prev = plotted.find(p => p.round === row.round - 1);
      row.change = prev ? Math.round((row.mean - prev.mean) * 100) / 100 : null;
    }

    const W = Math.max(280, width), H = 190, L = 34, R = 44, T = 18, B = 28;
    const lo = Math.max(0, Math.min(6, Math.floor(Math.min(...plotted.map(r => r.mean)) - 1)));
    const x = round => L + (maxRound === 1 ? (W - L - R) / 2 : ((round - 1) / (maxRound - 1)) * (W - L - R));
    const y = s => T + (1 - (s - lo) / (10 - lo)) * (H - T - B);

    let svg = '';
    for (let s = lo; s <= 10; s += (10 - lo > 6 ? 2 : 1)) {
      svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(s)}" y2="${y(s)}"/><text class="tick" x="${L - 8}" y="${y(s) + 4}" text-anchor="end">${s}</text>`;
    }
    if (minScore >= lo) {
      svg += `<line class="ref" x1="${L}" x2="${W - R}" y1="${y(minScore)}" y2="${y(minScore)}"/><text class="tick ref-t" x="${L + 6}" y="${y(minScore) - 5}">${t('ch.score.minRef', { score: minScore })}</text>`;
    }
    let path = '';
    for (const row of plotted) {
      path += `${plotted.some(p => p.round === row.round - 1) ? 'L' : 'M'}${x(row.round).toFixed(1)},${y(row.mean).toFixed(1)}`;
    }
    svg += `<path d="${path}" fill="none" stroke="var(--text)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    for (let r = 1; r <= maxRound; r++) svg += `<text class="tick" x="${x(r)}" y="${H - 8}" text-anchor="middle">R${r}</text>`;
    for (const row of plotted) {
      const ch = row.change;
      const diffTxt = ch == null ? t('ch.conv.initial') : ch >= 0 ? `+${ch}` : `${ch}`;
      const stateTxt = ch == null ? '' : ch <= -0.5 ? t('ch.conv.regressionState') : Math.abs(ch) < 0.5 ? t('ch.conv.plateauState') : t('ch.conv.progressState');
      const tip = t('ch.conv.tip', { round: row.round, mean: row.mean, count: row.count, diff: diffTxt, state: stateTxt, scores: row.scores.join(', ') });
      svg += `<g class="mk" data-tip="${esc(tip)}"><circle cx="${x(row.round)}" cy="${y(row.mean)}" r="12" fill="transparent"/><circle cx="${x(row.round)}" cy="${y(row.mean)}" r="4.5" fill="var(--text)" stroke="var(--panel)" stroke-width="2"/></g>`;
    }
    const tail = plotted[plotted.length - 1];
    svg += `<text class="end" x="${x(tail.round)}" y="${y(tail.mean) - 9}" text-anchor="middle">${tail.mean}</text>`;

    const last = plotted[plotted.length - 1];
    const prev = plotted.find(p => p.round === last.round - 1);
    const ch = last.change;
    let sub = '', statusText = '', statusColor = '#3fd0ff';
    if (ch != null && ch <= -0.5) {
      sub = t('ch.conv.subRegression', { pts: Math.abs(ch) });
      statusText = t('ch.conv.statusRegression', { prev: prev.mean, last: last.mean, ch });
      statusColor = '#ef4444';
    } else if (ch != null && Math.abs(ch) < 0.5) {
      sub = t('ch.conv.subPlateau');
      statusText = t('ch.conv.statusPlateau', { prev: prev.mean, last: last.mean, ch: ch >= 0 ? `+${ch}` : ch });
      statusColor = '#f59e0b';
    } else if (last.mean >= minScore) {
      sub = t('ch.conv.subGoal', { mean: last.mean, minScore });
      statusText = t('ch.conv.statusGoal', { mean: last.mean, minScore });
      statusColor = '#22c55e';
    } else if (ch != null) {
      sub = t('ch.conv.subProgress', { pts: ch });
      statusText = t('ch.conv.statusProgress', { prev: prev.mean, last: last.mean, ch: `+${ch}` });
      statusColor = '#3fd0ff';
    } else {
      sub = t('ch.conv.subRound', { round: last.round, mean: last.mean });
      statusText = t('ch.conv.statusRound', { round: last.round, mean: last.mean, count: last.count });
    }
    const holeNote = holes.length
      ? `<p class="ch-empty">${t('ch.conv.holesNote', { holes: holes.map(r => `R${r}`).join(', ') })}</p>`
      : '';
    const leg = `<div class="ch-legend"><span><i style="background:${statusColor}"></i>${esc(statusText)}</span>` +
      (plotted.some(r => r.change != null) ? `<span style="margin-left:auto;color:var(--dim)">${t('ch.conv.threshold')}</span>` : '') +
      `</div>`;
    return card(t('ch.conv.title'), sub,
      stamp + leg + `<svg class="ch" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${t('ch.conv.title')}">${svg}</svg>` + holeNote);
  }

  // Vista de tabla con los mismos datos (accesible y copiable).
  function dataTable(turns, agents) {
    if (!turns.length) return '';
    const rows = turns.map((m, i) => {
      const a = agents.find(x => x.id === m.agentId);
      const start = new Date(m.ts).getTime() - (m.seconds || 0) * 1000;
      return `<tr><td>${i + 1}</td><td><i class="sw" style="background:${esc(a?.color || '#7d8a9c')}"></i>${esc(m.agentName)}</td><td>${esc(stepOf(m))}</td><td>${hhmm(start)}</td><td>${dur(m.seconds || 0)}</td><td>${m.usage?.totalTokens ? ktok(m.usage.totalTokens) : '–'}</td><td>${m.score ?? '–'}</td><td>${esc(verdictLabel(m.verdict))}</td><td>${(m.workFiles || []).length || '–'}</td></tr>`;
    }).join('');
    return `<details class="ch-table"><summary>${t('ch.table.summary', { n: turns.length })}</summary><table><tr><th>${t('ch.table.thNum')}</th><th>${t('ch.table.thAgent')}</th><th>${t('ch.table.thStep')}</th><th>${t('ch.table.thStart')}</th><th>${t('ch.table.thDuration')}</th><th>${t('ch.table.thTokens')}</th><th>${t('ch.table.thScore')}</th><th>${t('ch.table.thVerdict')}</th><th>${t('ch.table.thFiles')}</th></tr>${rows}</table></details>`;
  }

  const ktok = n => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
  const OPEN = new Set(['abierta', 'disputada']);
  const CLOSING = new Set(['resuelta', 'retirada']);

  function distinct(agents, tema = typeof document !== 'undefined' ? document.documentElement.dataset.tema : 'oscuro') {
    const seen = new Map();
    return agents.map(a => {
      const c = String(a.color || '#7d8a9c').toLowerCase(), n = seen.get(c) || 0;
      seen.set(c, n + 1);
      if (!n) return a;
      if (tema === 'claro') return { ...a, color: `color-mix(in srgb, ${c} ${Math.round(70 / (1 + (n - 1) * 0.15))}%, #000000)` };
      const pct = 50 / (1 + Math.floor((n - 1) / 2) * 0.2);
      return { ...a, color: `color-mix(in srgb, ${c} ${pct}%, ${n % 2 ? '#ffffff' : '#000000'})` };
    });
  }

  const OUTCOME_ICONS = {
    running: ['▶', 'ch.outcome.running', 'run'],
    unanime: ['✅', 'ch.outcome.unanime', 'ok'],
    consenso: ['✅', 'ch.outcome.consenso', 'ok'],
    aceptado: ['✓', 'ch.outcome.aceptado', 'ok'],
    agotado: ['⏹', 'ch.outcome.agotado', 'warn'],
    meseta: ['⏸', 'ch.outcome.meseta', 'warn'],
    retroceso: ['⚠', 'ch.outcome.retroceso', 'warn'],
    detenido: ['■', 'ch.outcome.detenido', 'warn'],
    interrupted: ['⚠', 'ch.outcome.interrupted', 'bad'],
    error: ['⚠', 'ch.outcome.error', 'bad'],
    'sin-agentes': ['⚠', 'ch.outcome.sinAgentes', 'bad'],
    nueva: ['·', 'ch.outcome.nueva', 'run'],
  };
  function outcomeOf(chat) {
    if (chat.running) return 'running';
    const last = [...(chat.messages || [])].reverse().find(m => m.kind === 'system' && m.outcome);
    if (!last) return (chat.messages || []).some(m => m.kind === 'agent') ? 'interrupted' : 'nueva';
    if (last.userAccepted) return 'aceptado';
    if (last.outcome === 'started') return 'interrupted';
    return OUTCOME_ICONS[last.outcome] ? last.outcome : 'error';
  }

  function summary(chat, agents = []) {
    const turns = (chat.messages || []).filter(m => m.kind === 'agent');
    const key = outcomeOf(chat);
    const [icon, labelKey, tone] = OUTCOME_ICONS[key] || ['·', 'ch.outcome.nueva', 'run'];
    const label = t(labelKey);
    const rounds = Math.max(0, ...turns.map(m => m.round || 0));
    const seconds = turns.reduce((s, m) => s + (m.seconds || 0), 0);
    const measured = turns.filter(m => m.usage?.totalTokens);
    const tokens = measured.reduce((s, m) => s + m.usage.totalTokens, 0);
    const debate = chat.debate || [];
    const open = debate.filter(o => OPEN.has(o.status)), closed = debate.length - open.length;
    const files = [...new Set(turns.flatMap(m => m.workFiles || []))];
    const main = chat.deliverables?.main;
    const lastSys = [...(chat.messages || [])].reverse().find(m => m.kind === 'system' && m.outcome && m.outcome !== 'started');
    const kpi = (k, v, tip) => `<div class="sm-kpi"${tip ? ` data-tip="${esc(tip)}"` : ''}><span>${esc(k)}</span><b>${v}</b></div>`;
    const maxRounds = chat.config?.maxRounds;
    const kpis = [
      kpi(t('ch.kpi.rounds'), `${rounds}${maxRounds ? `<small> / ${maxRounds}</small>` : ''}`),
      kpi(t('ch.kpi.turns'), String(turns.length)),
      kpi(t('ch.kpi.workTime'), esc(dur(seconds))),
      kpi(t('ch.kpi.tokens'), measured.length ? esc(ktok(tokens)) : '–', measured.length < turns.length ? t('ch.kpi.unmeasured', { count: turns.length - measured.length }) : ''),
      kpi(t('ch.kpi.objections'), `${open.length ? `<em>${t('ch.kpi.open', { count: open.length })}</em>` : t('ch.kpi.open', { count: 0 })}<small> · ${t('ch.kpi.closed', { count: closed })}</small>`),
      kpi(t('ch.kpi.workFiles'), String(files.length), files.slice(0, 12).join('\n')),
    ].join('');

    const done = [];
    if (lastSys && key !== 'running') done.push(esc(String(lastSys.text).replace(/^[^\p{L}\d]+/u, '')));
    if (files.length) {
      const more = files.length > 4 ? t('ch.summary.moreFiles', { count: files.length - 4 }) : '';
      done.push(t('ch.summary.filesChanged', { count: files.length, files: files.slice(0, 4).map(f => `<code>${esc(f)}</code>`).join(', '), more }));
    }
    if (main) {
      const inPath = chat.path ? t('ch.summary.inPath', { path: `<code>${esc(shortHome(chat.path))}</code>` }) : '';
      done.push(t('ch.summary.mainDeliverable', { main: `<code>${esc(main)}</code>`, path: inPath }));
    }
    if (!done.length) done.push(turns.length ? t('ch.summary.turnCount', { turns: turns.length, rounds }) : t('ch.summary.noWorkYet'));

    const todo = open.slice(0, 3).map(o => `#${o.id} ${esc(o.text)} <small>(${t('ch.summary.byAuthor', { name: esc(o.byName || o.by || 'someone') })})</small>`);
    if (open.length > 3) todo.push(t('ch.summary.moreObjections', { count: open.length - 3 }));
    const nextMap = {
      running: t('ch.summary.nextRunning'),
      agotado: t('ch.summary.nextAgotado'),
      meseta: t('ch.summary.nextMeseta'),
      retroceso: t('ch.summary.nextRetroceso'),
      detenido: t('ch.summary.nextDetenido'),
      interrupted: t('ch.summary.nextInterrupted'),
      error: t('ch.summary.nextError'),
      'sin-agentes': t('ch.summary.nextSinAgentes'),
      aceptado: open.length ? '' : t('ch.summary.acceptedAsIs'),
    };
    const next = nextMap[key];
    if (next) todo.push(next);
    if (!todo.length) todo.push(t('ch.summary.nothingPending'));
    return `<section class="ch-card sm-card sm-${tone}"><header><h3>${icon} ${esc(label)}</h3>${key === 'running' && rounds ? `<span>${t('ch.conv.subRound', { round: rounds, mean: '' })}</span>` : ''}</header>
      <div class="sm-kpis">${kpis}</div>
      <div class="sm-text"><p><b>${t('ch.summary.whatDone')}</b> ${done.join(' ')}</p><p><b>${t('ch.summary.whatPending')}</b> ${todo.join(' ')}</p></div></section>`;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v)), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  function tokenBars(turns, agents, width) {
    const list = turns.filter(m => m.usage?.totalTokens);
    if (!list.length) return card(t('ch.tok.title'), '', `<p class="ch-empty">${t('ch.tok.empty')}</p>`);
    const W = Math.max(280, width), H = 190, L = 44, R = 10, T = 12, B = 24;
    const top = niceMax(Math.max(...list.map(m => m.usage.totalTokens)));
    const n = turns.length, slot = (W - L - R) / n, bw = Math.max(3, Math.min(28, slot * 0.7));
    const y = v => T + (1 - v / top) * (H - T - B);
    let svg = '';
    for (let k = 0; k <= 4; k++) {
      const v = (top * k) / 4;
      svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${ktok(v)}</text>`;
    }
    turns.forEach((m, i) => {
      if (!m.usage?.totalTokens) return;
      const a = agents.find(x => x.id === m.agentId) || { name: m.agentName, color: '#7d8a9c' };
      const u = m.usage, x0 = L + i * slot + (slot - bw) / 2;
      const cached = u.cachedTokens ? t('ch.tok.cachedPart', { cached: ktok(u.cachedTokens) }) : '';
      const cost = u.costUsd ? `\n$${u.costUsd.toFixed(3)}` : '';
      const tip = t('ch.tok.tip', { name: a.name, turn: i + 1, step: stepOf(m), tok: ktok(u.totalTokens), input: ktok(u.inputTokens || 0), output: ktok(u.outputTokens || 0), cached, cost });
      svg += `<rect class="bar" x="${x0.toFixed(1)}" y="${y(u.totalTokens).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - B - y(u.totalTokens)).toFixed(1)}" rx="2" fill="${esc(a.color)}" data-tip="${esc(tip)}"/>`;
    });
    svg += `<text class="tick" x="${L}" y="${H - 6}">${t('ch.score.turn', { n: 1 })}</text><text class="tick" x="${W - R}" y="${H - 6}" text-anchor="end">${t('ch.score.turn', { n })}</text>`;
    const used = agents.filter(a => list.some(m => m.agentId === a.id));
    const total = list.reduce((s, m) => s + m.usage.totalTokens, 0);
    const unmeasured = list.length < turns.length ? t('ch.tok.unmeasured', { n: turns.length - list.length }) : '';
    return card(t('ch.tok.title'), t('ch.tok.sub', { total: ktok(total), unmeasured }),
      legend(used) + `<svg class="ch" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${t('ch.tok.title')}">${svg}</svg>`);
  }

  function objections(debate, width) {
    const list = oneCycle(debate || []);
    if (!list.length) return card(t('ch.obj.title'), '', `<p class="ch-empty">${t('ch.obj.empty')}</p>`);
    const closedAt = o => {
      if (OPEN.has(o.status)) return null;
      const r = [...(o.replies || [])].reverse().find(x => CLOSING.has(x.stance) && x.round);
      return r ? r.round : o.round || 1;
    };
    const rounds = Math.max(1, ...list.map(o => o.round || 1), ...list.map(o => closedAt(o) || 0));
    const rows = Array.from({ length: rounds }, (_, i) => {
      const r = i + 1;
      return {
        r, raised: list.filter(o => (o.round || 1) === r), closed: list.filter(o => closedAt(o) === r),
        open: list.filter(o => (o.round || 1) <= r && !(closedAt(o) && closedAt(o) <= r)).length,
      };
    });
    const W = Math.max(280, width), H = 170, L = 30, R = 10, T = 12, B = 24;
    const top = Math.max(2, ...rows.map(x => Math.max(x.raised.length, x.closed.length, x.open)));
    const slot = (W - L - R) / rounds, bw = Math.max(4, Math.min(22, slot * 0.28));
    const y = v => T + (1 - v / top) * (H - T - B);
    let svg = '';
    for (let v = 0; v <= top; v += Math.max(1, Math.ceil(top / 4))) svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    let line = '';
    rows.forEach((x, i) => {
      const cx = L + i * slot + slot / 2;
      const tip = `${t('ch.conv.tip', { round: x.r, mean: '', count: '', diff: '', state: '', scores: '' }).slice(0, 7) || `Ronda ${x.r}`}\n${t('ch.obj.tip', { round: x.r, raised: x.raised.length, closed: x.closed.length, open: x.open })}` +
        x.raised.slice(0, 4).map(o => `\n#${o.id} ${String(o.text).slice(0, 70)}`).join('');
      svg += `<g data-tip="${esc(tip)}"><rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent"/>` +
        `<rect class="bar" x="${(cx - bw - 1).toFixed(1)}" y="${y(x.raised.length)}" width="${bw}" height="${H - B - y(x.raised.length)}" rx="2" fill="var(--text)" fill-opacity=".8"/>` +
        `<rect class="bar" x="${(cx + 1).toFixed(1)}" y="${y(x.closed.length)}" width="${bw}" height="${H - B - y(x.closed.length)}" rx="2" fill="none" stroke="var(--text)" stroke-width="1.5"/></g>`;
      line += `${i ? 'L' : 'M'}${cx.toFixed(1)},${y(x.open).toFixed(1)}`;
      svg += `<text class="tick" x="${cx}" y="${H - 6}" text-anchor="middle">R${x.r}</text>`;
    });
    svg += `<path d="${line}" fill="none" stroke="var(--dim)" stroke-width="2" stroke-dasharray="5 3"/>`;
    const leg = `<div class="ch-legend"><span><i style="background:var(--text)"></i>${t('ch.obj.raised')}</span><span><i style="background:none;border:1.5px solid var(--text);height:8px"></i>${t('ch.obj.closed')}</span><span><i style="background:var(--dim)"></i>${t('ch.obj.openAtEnd')}</span></div>`;
    return card(t('ch.obj.title'), t('ch.obj.sub', { total: list.length, open: list.filter(o => OPEN.has(o.status)).length }),
      leg + `<svg class="ch" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${t('ch.obj.title')}">${svg}</svg>`);
  }

  const Charts = { scoreLine, timeline, timeBars, reviewMatrix, dataTable, convergence, summary, tokenBars, objections, distinct, outcomeOf };
  if (typeof window !== 'undefined') window.Charts = Charts;
  if (typeof module !== 'undefined' && module.exports) module.exports = Charts;
})();
