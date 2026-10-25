#!/usr/bin/env node
// scripts/medir.js: Lee los .office/chat.json y extrae tokens, % de caché, turnos cortados y notas por misión.
// Fuente: propuesta de mejora de OfficeMatrix, borrador B (23-oct-2026), citada en ingenieria.md.
// Uso:
//   node scripts/medir.js <carpeta-proyectos> [salida.json]

const fs = require('fs');
const path = require('path');

let root = process.argv[2] || (fs.existsSync('proyectos') ? 'proyectos' : (fs.existsSync(path.join(process.env.OFFICEMATRIX_HOME || '', 'proyectos')) ? path.join(process.env.OFFICEMATRIX_HOME, 'proyectos') : '.'));
const outJson = process.argv[3];

if (!fs.existsSync(root)) {
  console.error(`Carpeta no encontrada: ${root}`);
  process.exit(1);
}

function parseMission(dir) {
  const chatFile = path.join(dir, '.office', 'chat.json');
  if (!fs.existsSync(chatFile)) return null;
  let chat;
  try { chat = JSON.parse(fs.readFileSync(chatFile, 'utf8')); } catch { return null; }

  const msgs = chat.messages || [];
  const agentMsgs = msgs.filter(m => m.kind === 'agent');
  if (!agentMsgs.length) return null;

  const mode = chat.config?.workflow || chat.config?.mode || 'relevo';
  const turns = agentMsgs.length;
  const seconds = agentMsgs.reduce((acc, m) => acc + (m.seconds || 0), 0);
  const minutes = Math.round((seconds / 60) * 10) / 10;

  let totalTokens = 0, inputTokens = 0, outputTokens = 0, cachedTokens = 0;
  let measuredTurns = 0;
  let cutTurns = 0;
  const reviewerScores = [];
  const selfScores = [];

  for (const m of agentMsgs) {
    if (m.verdict === 'PARCIAL' || m.verdict === 'ERROR' || m.failure) cutTurns++;
    const u = m.usage;
    if (u?.totalTokens) {
      measuredTurns++;
      totalTokens += u.totalTokens;
      inputTokens += u.inputTokens || 0;
      outputTokens += u.outputTokens || 0;
      cachedTokens += u.cachedTokens || 0;
    }
    if (typeof m.score === 'number') {
      if (m.phase === 'borrador' || m.phase === 'sintesis' || m.selfScore) {
        selfScores.push(m.score);
      } else {
        reviewerScores.push(m.score);
      }
    }
  }

  const bestReviewerScore = reviewerScores.length ? Math.max(...reviewerScores) : null;
  const bestSelfScore = selfScores.length ? Math.max(...selfScores) : null;
  const pctCache = totalTokens > 0 ? ((cachedTokens / totalTokens) * 100).toFixed(1) : '–';
  const pctOutput = totalTokens > 0 ? ((outputTokens / totalTokens) * 100).toFixed(1) : '–';

  return {
    id: chat.id,
    title: chat.title || path.basename(dir),
    mode,
    turns,
    minutes,
    totalTokens,
    tokensFormatted: totalTokens > 0 ? `${(totalTokens / 1e6).toFixed(1)} M` : 'no counter',
    pctCache,
    pctOutput,
    cutTurns,
    bestReviewerScore,
    bestSelfScore,
    minScore: chat.config?.minScore || 9,
  };
}

const entries = fs.readdirSync(root, { withFileTypes: true });
const missions = [];
for (const ent of entries) {
  if (ent.isDirectory()) {
    const data = parseMission(path.join(root, ent.name));
    if (data) missions.push(data);
  }
}

if (!missions.length) {
  console.log(`No missions with .office/chat.json found in ${root}`);
  process.exit(0);
}

console.log('| Mission | Mode | Turns | AI min | Tokens | % cache | % output | Cut turns | Best reviewer score / min |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const m of missions) {
  const rev = m.bestReviewerScore != null ? m.bestReviewerScore : 'no reviewer';
  const self = m.bestSelfScore != null ? ` (autonota ${m.bestSelfScore})` : '';
  console.log(`| ${m.title.slice(0, 32)} | ${m.mode} | ${m.turns} | ${m.minutes} | ${m.tokensFormatted} | ${m.pctCache} | ${m.pctOutput} | ${m.cutTurns} | ${rev}${self} / ${m.minScore} |`);
}

if (outJson) {
  fs.writeFileSync(outJson, JSON.stringify(missions, null, 2), 'utf8');
  console.log(`\nDatos guardados en ${outJson}`);
}
