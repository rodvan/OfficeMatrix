// Traduce la salida en streaming de cada CLI a eventos de actividad legibles.
// Cada CLI tiene su propio formato JSONL (verificado con --help y sondas reales, ver docs/DECISIONES.md).
// Si una línea no es JSON, o la CLI no tiene streaming, se trata como texto plano: la app nunca depende del formato.
//
// Evento: { kind, label, detail?, file?, tool? }
//   kind: read | write | cmd | search | web | plan | agent | tool | think | text | error | info | raw | say
//   say: lo que va pensando o diciendo mientras llega en trozos (solo para el globo en vivo; no va al log).
//   label: short activity for the bubble, in the server language ("editing style.css", "running tests")

const { t } = require('./i18n');
const FORMATS = ['claude', 'agy', 'codex', 'grok', 'kimi', 'text'];

const clip = (s, n) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

// Lo que dice o piensa, para el globo: sin markdown y, si es largo, lo último (lo que está pensando ahora).
function sayText(s, n = 180) {
  s = String(s ?? '').replace(/```[\s\S]*?(```|$)/g, ' ').replace(/[#*_`>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const tail = s.slice(-n);
  return '…' + tail.slice(Math.max(0, tail.indexOf(' ') + 1));
}
// Avisa del texto que va creciendo cada SAY_STEP caracteres (no en cada trozo: serían cientos de avisos).
const SAY_STEP = 60;
const growing = () => {
  let sent = 0;
  return (out, text, reset, label) => {
    if (reset) sent = 0;
    if (text.trim() && text.length - sent >= SAY_STEP) { sent = text.length; out.push({ kind: 'say', label, detail: text }); }
  };
};

function shortPath(p, cwd) {
  if (!p) return '';
  let s = String(p).replace(/\\/g, '/');
  if (cwd) {
    const base = String(cwd).replace(/\\/g, '/').replace(/\/+$/, '') + '/';
    if (s.toLowerCase().startsWith(base.toLowerCase())) s = s.slice(base.length);
  }
  const parts = s.split('/').filter(Boolean);
  return parts.length > 3 ? '…/' + parts.slice(-2).join('/') : parts.join('/');
}

// Quita el envoltorio de shell que añaden algunas CLIs (Codex: "powershell.exe" -Command '...').
function cleanCommand(cmd) {
  let s = String(cmd ?? '').trim();
  s = s.replace(/^"?[^"\s]*(powershell|pwsh|cmd|bash|sh)(\.exe)?"?\s+(-NoProfile\s+)?(-Command|-c|\/c)\s+/i, '');
  if (/^(['"]).*\1$/s.test(s)) s = s.slice(1, -1);
  return s.trim();
}

// Algunas CLIs (Codex) leen y escriben archivos con comandos de shell: los reconocemos para que la burbuja diga algo útil.
function classifyCommand(cmd, cwd) {
  const c = cleanCommand(cmd);
  const fileArg = re => {
    const m = c.match(re);
    return m ? shortPath(m[1].replace(/^['"]|['"]$/g, ''), cwd) : '';
  };
  if (/node\s+--test|npm\s+(run\s+)?test|pytest|jest|vitest|mocha|go\s+test|cargo\s+test/i.test(c)) return { kind: 'cmd', intent: 'tests', label: t('stream.runningTests') };
  if (/node\s+--check/i.test(c)) return { kind: 'cmd', intent: 'syntax', label: t('stream.checkingSyntax') };
  if (/^git\s/i.test(c)) return { kind: 'cmd', intent: 'git', label: `git: ${clip(c.slice(4), 40)}` };
  if (/(npm|pnpm|yarn)\s+(i|install|add)\b/i.test(c)) return { kind: 'cmd', intent: 'deps', label: t('stream.installingDeps') };
  if (/^(Set-Content|Add-Content|Out-File|New-Item)\b/i.test(c) || /apply_patch/i.test(c)) {
    // [^\s;|] y no \S+: si no, "archivo.txt; git status" se lee como un solo nombre.
    const f = fileArg(/(?:-LiteralPath|-Path|-FilePath)\s+([^\s;|]+)/i);
    return { kind: 'write', label: t('stream.writing', { file: f || t('stream.files') }), file: f || undefined };
  }
  if (/^(Get-Content|cat|type|head|tail)\b/i.test(c)) {
    const f = fileArg(/(?:-LiteralPath|-Path)\s+([^\s;|]+)/i) || fileArg(/^\S+\s+(?:-\S+\s+)*([^\s;|]+)/);
    return { kind: 'read', label: t('stream.reading', { file: f || t('stream.file') }), file: f || undefined };
  }
  if (/^(rg|grep|Select-String|findstr)\b/i.test(c)) return { kind: 'search', intent: 'search', label: t('stream.searching', { q: clip(c.replace(/^\S+\s+/, ''), 36) }) };
  if (/^(Get-ChildItem|ls|dir|tree)\b/i.test(c)) return { kind: 'search', intent: 'explore', label: t('stream.exploringFolders') };
  return { kind: 'cmd', label: t('stream.running', { cmd: clip(c, 48) }) };
}

// Codex (y a veces Claude) mete varias lecturas y escrituras en un solo comando de PowerShell.
// La burbuja y el log tienen que decir cada archivo; quedarse con el primero esconde el resto.
// El argumento puede ser una lista: -LiteralPath HANDOFF.md,MEMORIA.md,'mi nota.md' (Codex, misión real).
const PATH_ITEM = String.raw`(?:'[^'\r\n]*'|"[^"\r\n]*"|[^\s;|'",]+)`;
const FLAGGED_FILE_OP = new RegExp(String.raw`\b(Set-Content|Add-Content|Out-File|New-Item|Get-Content)\b[^;|\r\n]*?(?:-LiteralPath|-Path|-FilePath)\s+(${PATH_ITEM}(?:\s*,\s*${PATH_ITEM})*)`, 'gi');
// Codex y Grok también leen y escriben con .NET: [System.IO.File]::WriteAllText((Join-Path $PWD 'x.md'), $t).
// La ventana es larga a propósito: callArg recorta en el ')' de ESTA llamada, así que no se cuela el archivo de la siguiente.
const DOTNET_FILE_OP = /\[(?:System\.)?IO\.File\]::(Read|Write|Append)All(?:Text|Lines|Bytes)\s*\((?=([^\r\n]{0,400}))/gi;
const NAMED = new Set(['tests', 'syntax', 'deps', 'explore', 'git', 'search']);
const PATH_LIKE = /[\\/]|\.[A-Za-z][A-Za-z0-9]{0,7}$/;
const TYPE_NAME = /^(?:System|Microsoft|Windows)\b/;
// Inicio de sentencia: ; && || | & (PowerShell y bash). No un '>' de redirección.
const STMT = String.raw`(?:^|&&|\|\||[;&|])\s*`;

const fileOp = (write, file) => write
  ? { kind: 'write', label: t('stream.writing', { file }), file }
  : { kind: 'read', label: t('stream.reading', { file }), file };

// El argumento de File::Read/Write acaba en su ')' de cierre. Parar en '::' cortaba Path::Combine
// y dejaba System.IO.Path como si fuera el archivo. Un tipo (System.Text.UTF8Encoding) tampoco es un archivo.
function callArg(raw) {
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) return raw.slice(0, i);
      depth--;
    } else if (ch === ';' && depth === 0) return raw.slice(0, i);
  }
  return raw;
}

function quotedPath(s) {
  for (const m of s.matchAll(/['"]([^'"\r\n]+)['"]/g)) {
    if (!TYPE_NAME.test(m[1]) && PATH_LIKE.test(m[1])) return m[1];
  }
  return '';
}

function dotnetTarget(arg, vars) {
  const window = callArg(arg);
  const quoted = quotedPath(window);
  if (quoted) return quoted;
  const candidates = [];
  for (const raw of window.match(/\$(\w+)/g) || []) {
    const v = vars[raw.slice(1).toLowerCase()];
    if (v && !TYPE_NAME.test(v)) candidates.push(v);
  }
  return candidates.find(v => PATH_LIKE.test(v)) || (candidates.length === 1 ? candidates[0] : '');
}

function scanFileOps(cmd, cwd) {
  const c = cleanCommand(cmd);
  const found = [];
  for (const m of c.matchAll(FLAGGED_FILE_OP)) {
    const write = /^(Set-Content|Add-Content|Out-File|New-Item)$/i.test(m[1]);
    for (const item of m[2].match(new RegExp(PATH_ITEM, 'g')) || []) {
      const file = shortPath(item.replace(/^['"]+|['")]+$/g, ''), cwd);
      if (file) found.push({ at: m.index, op: fileOp(write, file) });
    }
  }
  const vars = {};
  for (const m of c.matchAll(/\$(\w+)\s*=\s*(['"])([^'"\r\n]+)\2/g)) vars[m[1].toLowerCase()] = m[3];
  for (const m of c.matchAll(DOTNET_FILE_OP)) {
    const file = shortPath(dotnetTarget(m[2], vars), cwd);
    if (file) found.push({ at: m.index, op: fileOp(!/^read$/i.test(m[1]), file) });
  }
  scanRedirs(c, found, cwd);
  // En el orden en que aparecen, y sin repetir la misma lectura o escritura (Grok lee un archivo de tres formas).
  const seen = new Set();
  return found.sort((a, b) => a.at - b.at).map(f => f.op)
    .filter(op => !seen.has(op.label) && seen.add(op.label));
}

// git y rg/grep solo se veían si el comando EMPEZABA por ellos. Al final ("…; git status") desaparecían.
function sideIntents(cmd) {
  const masked = cleanCommand(cmd).replace(/'[^'\r\n]*'|"[^"\r\n]*"/g, m => ' '.repeat(m.length));
  const out = [];
  const push = ev => { if (!out.some(e => e.label === ev.label)) out.push(ev); };
  const git = masked.match(new RegExp(STMT + String.raw`git\s+([^\n;|&]{1,80})`, 'i'));
  if (git) push({ kind: 'cmd', intent: 'git', label: `git: ${clip(git[1].trim(), 40)}` });
  const search = masked.match(new RegExp(STMT + String.raw`(?:rg|grep|Select-String|findstr)\b\s*([^\n;|&]{0,80})`, 'i'));
  if (search && search[1].trim()) push({ kind: 'search', intent: 'search', label: t('stream.searching', { q: clip(search[1].trim(), 36) }) });
  return out;
}

// `> archivo` y `>> archivo` fuera de comillas. `2>&1` no es un archivo.
function scanRedirs(c, found, cwd) {
  let quote = '';
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch !== '>') continue;
    let j = i;
    while (j > 0 && c[j - 1] === '>') j--;
    const prev = j > 0 ? c[j - 1] : '';
    if (prev && !/[\s;&|*\d]/.test(prev)) continue;
    let k = i + 1;
    while (k < c.length && c[k] === '>') k++;
    while (k < c.length && c[k] === ' ') k++;
    if (k >= c.length || c[k] === '&') continue;
    const tok = c.slice(k).match(/^('([^'\r\n]*)'|"([^"\r\n]*)"|[^\s;&|>]+)/);
    if (!tok) continue;
    const raw = tok[2] ?? tok[3] ?? tok[1];
    if (!raw || raw.startsWith('$')) continue;
    const file = shortPath(raw, cwd);
    if (file) found.push({ at: i, op: fileOp(true, file) });
    i = k + tok[0].length - 1;
  }
}

function commandEvents(cmd, cwd) {
  const ops = scanFileOps(cmd, cwd);
  const one = classifyCommand(cmd, cwd);
  const extras = sideIntents(cmd);
  const named = NAMED.has(one.intent);
  const lead = [];
  if (named) {
    const tight = extras.find(e => e.intent && e.intent === one.intent);
    lead.push(tight || one);
  }
  for (const e of extras) {
    const same = x => x.label === e.label || (e.intent && x.intent === e.intent && (e.intent === 'git' || e.intent === 'search'));
    if (!lead.some(same)) lead.push(e);
  }
  if (ops.length) return lead.length ? [...lead, ...ops] : ops;
  if (one.file && lead.length && !named) return [...lead, one];
  if (named && lead.length) return lead;
  return [one];
}

const describeCommand = (cmd, cwd) => classifyCommand(cmd, cwd).label;

const TOOL_KINDS = [
  ['read', /^(read|read_file|view_file|notebookread|readfile)$/i],
  ['write', /^(write|write_file|write_to_file|edit|multiedit|edit_file|replace_file_content|multi_replace_file_content|search_replace|sed_file|notebookedit|notebook_edit|apply_patch|str_replace.*|writefile|strreplacefile)$/i],
  ['cmd', /^(bash|powershell|run_command|run_terminal_command|shell|command_execution|send_command_input)$/i],
  ['search', /^(grep|glob|ls|grep_search|find_by_name|list_dir|search|codebase_search)$/i],
  ['web', /^(websearch|webfetch|searchweb|fetchurl|search_web|read_url_content|web_search|web_fetch|open_browser_url|read_browser_page)$/i],
  ['plan', /^(todowrite|todo_write|manage_task|enter_plan_mode|exit_plan_mode)$/i],
  ['agent', /^(task|agent|spawn_subagent|invoke_subagent|browser_subagent)$/i],
];

function toolKind(name) {
  for (const [kind, re] of TOOL_KINDS) if (re.test(name || '')) return kind;
  return 'tool';
}

const pick = (obj, ...keys) => {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) if (obj[k] != null && obj[k] !== '') return obj[k];
  return undefined;
};

// Convierte una llamada a herramienta (de cualquier CLI) en un evento.
function toolEvent(name, input, cwd) {
  const kind = toolKind(name);
  const file = pick(input, 'file_path', 'path', 'Path', 'target_file', 'TargetFile', 'AbsolutePath', 'notebook_path', 'filePath');
  const f = shortPath(file, cwd);
  const isEdit = /edit|replace|sed|patch/i.test(name || '');
  switch (kind) {
    case 'read': return { kind, tool: name, file: f, label: t('stream.reading', { file: f || t('stream.file') }) };
    case 'write': return { kind, tool: name, file: f, label: t(isEdit ? 'stream.editing' : 'stream.writing', { file: f || t('stream.file') }) };
    case 'cmd': {
      const cmd = pick(input, 'command', 'CommandLine', 'cmd', 'Input') || '';
      return { ...classifyCommand(cmd, cwd), tool: name, detail: clip(cleanCommand(cmd), 300) };
    }
    case 'search': {
      const q = pick(input, 'pattern', 'Query', 'query', 'Pattern', 'glob', 'SearchPath', 'SearchDirectory', 'target_directory', 'DirectoryPath', 'path');
      return { kind, tool: name, label: /list|ls/i.test(name) ? t('stream.exploring', { target: shortPath(q, cwd) || t('stream.folder') }) : t('stream.searchingQuoted', { q: clip(shortPath(q, cwd), 30) }) };
    }
    case 'web': {
      const q = pick(input, 'query', 'Query', 'url', 'Url', 'URL');
      return { kind, tool: name, label: t('stream.researching', { q: clip(q, 40) }) };
    }
    case 'plan': return { kind, tool: name, label: t('stream.planning') };
    case 'agent': return { kind, tool: name, label: t('stream.delegating', { what: clip(pick(input, 'description', 'prompt', 'Task') || t('stream.subagent'), 40) }) };
    default: return { kind, tool: name, label: t('stream.using', { name }) };
  }
}

// Una herramienta de shell puede ser varios eventos (un archivo por lectura o escritura).
function toolEvents(name, input, cwd) {
  if (toolKind(name) !== 'cmd') return [toolEvent(name, input, cwd)];
  const cmd = pick(input, 'command', 'CommandLine', 'cmd', 'Input') || '';
  const detail = clip(cleanCommand(cmd), 300);
  return commandEvents(cmd, cwd).map(e => ({ ...e, tool: name, detail }));
}

function safeJson(line) {
  if (!line.startsWith('{')) return null;
  try { return JSON.parse(line); } catch { return null; }
}

// Normaliza el consumo de tokens y coste que reporta el evento final de cada CLI.
function normalizeUsage(u, costUsd) {
  if (!u || typeof u !== 'object') return null;
  const cachedTokens = Number(u.cache_read_input_tokens ?? u.cache_read_tokens ?? u.cached_input_tokens ?? 0) || 0;
  const cacheCreate = Number(u.cache_creation_input_tokens ?? u.cache_write_input_tokens ?? 0) || 0;
  const rawInput = Number(u.input_tokens ?? 0) || 0;
  // Solo Codex (cached_input_tokens) incluye la caché dentro de input_tokens. En Claude, Grok y Agy es solo lo no cacheado:
  // las capturas de Agy traen cache_read_tokens mayor que input_tokens (misión real del 22-oct-2026).
  const inputIncludesCache = 'cached_input_tokens' in u;
  const inputTokens = inputIncludesCache ? rawInput : rawInput + cachedTokens + cacheCreate;
  const outputTokens = Number(u.output_tokens ?? 0) || 0;
  // total_tokens no significa lo mismo en todas (Grok cuenta la caché, Agy no): se calcula igual para las 4.
  const totalTokens = inputTokens + outputTokens;
  if (!totalTokens && !inputTokens && !outputTokens) return null;
  const out = { inputTokens, outputTokens, cachedTokens, totalTokens };
  if (typeof costUsd === 'number' && costUsd > 0) out.costUsd = Math.round(costUsd * 1e6) / 1e6;
  return out;
}

// ---------- Un manejador por formato: recibe un objeto JSON, devuelve eventos ----------

function claudeHandler(state) {
  return obj => {
    const out = [];
    if (obj.type === 'system' && obj.subtype === 'init') {
      state.cwd = obj.cwd || state.cwd;
      out.push({ kind: 'info', label: t('stream.sessionStarted') });
    } else if (obj.type === 'assistant') {
      for (const block of obj.message?.content || []) {
        if (block.type === 'tool_use') out.push(...toolEvents(block.name, block.input, state.cwd));
        else if (block.type === 'text' && block.text?.trim()) {
          state.lastText = block.text;
          out.push({ kind: 'text', label: t('stream.drafting'), detail: block.text });
        } else if (block.type === 'thinking') out.push({ kind: 'think', label: t('stream.thinking'), ...(block.thinking?.trim() ? { detail: clip(block.thinking, 600) } : {}) });
      }
    } else if (obj.type === 'user') {
      for (const block of obj.message?.content || []) {
        if (block.type === 'tool_result' && block.is_error) {
          const text = Array.isArray(block.content) ? block.content.map(c => c.text || '').join(' ') : block.content;
          out.push({ kind: 'error', label: t('stream.toolFailed'), detail: clip(text, 300) });
        }
      }
    } else if (obj.type === 'result') {
      // Una tarea en segundo plano que termina después del reporte produce un segundo «result» corto («el servidor de
      // demo se cerró…»): no debe tapar el reporte con NOTA/VEREDICTO del primero.
      const keepReport = typeof state.final === 'string' && /NOTA\s*:/i.test(state.final) && !/NOTA\s*:/i.test(obj.result || '');
      if (typeof obj.result === 'string' && !keepReport) state.final = obj.result;
      state.usage = normalizeUsage(obj.usage, obj.total_cost_usd) || state.usage;
      if (obj.is_error) out.push({ kind: 'error', label: t('stream.endedWithError'), detail: clip(obj.result || obj.subtype, 300) });
      else out.push({ kind: 'info', label: t('stream.turnDone') });
    }
    return out;
  };
}

function agyHandler(state) {
  const steps = {};
  const say = growing();
  return obj => {
    const out = [];
    if (obj.event === 'init') {
      state.cwd = obj.init?.cwd || state.cwd;
      out.push({ kind: 'info', label: t('stream.sessionStarted') });
    } else if (obj.event === 'step_update') {
      const s = obj.step_update || {};
      if (s.step_type === 'tool' && (s.state === 'ACTIVE' || s.state === 'DONE') && !steps[s.step_index]) {
        steps[s.step_index] = true;
        out.push(...toolEvents(s.tool_info?.name || s.tool_name, s.tool_info?.parameters, state.cwd));
      }
      if (s.step_type === 'tool' && s.state === 'DONE' && /^(error|failed)/i.test(s.tool_info?.output || '')) {
        out.push({ kind: 'error', label: t('stream.toolFailedNamed', { name: s.tool_name }), detail: clip(s.tool_info.output, 300) });
      } else if (s.step_type === 'agent_response') {
        const key = `t${s.step_index}`;
        if (s.text_delta) {
          const prev = steps[key] || '';
          steps[key] = prev + s.text_delta;
          // La burbuja no puede esperar al DONE: el primer delta ya dice que está redactando.
          if (!prev.trim() && steps[key].trim()) out.push({ kind: 'text', label: t('stream.drafting'), detail: clip(steps[key], 240) });
          else say(out, steps[key], !prev, t('stream.drafting'));
        }
        if (s.state === 'DONE' && steps[key]?.trim()) {
          state.lastText = steps[key];
          out.push({ kind: 'text', label: t('stream.drafting'), detail: steps[key] });
        } else if (s.state === 'ACTIVE' && !steps[key + 'seen']) {
          steps[key + 'seen'] = true;
          if (!steps[key]?.trim()) out.push({ kind: 'think', label: t('stream.thinking') });
        }
      }
    } else if (obj.event === 'result') {
      const r = obj.result || {};
      if (typeof r.response === 'string') state.final = r.response;
      state.usage = normalizeUsage(r.usage, r.total_cost_usd) || state.usage;
      if (r.status && r.status !== 'SUCCESS') out.push({ kind: 'error', label: t('stream.endedStatus', { status: r.status }), detail: clip(r.error || '', 300) });
      else out.push({ kind: 'info', label: t('stream.turnDone') });
    } else if (obj.event === 'error' || obj.error) {
      out.push({ kind: 'error', label: t('stream.cliError'), detail: clip(obj.error?.message || JSON.stringify(obj.error || obj), 300) });
    }
    return out;
  };
}

function codexHandler(state) {
  return obj => {
    const out = [];
    const item = obj.item || {};
    if (obj.type === 'thread.started') out.push({ kind: 'info', label: t('stream.sessionStarted') });
    else if (obj.type === 'item.started' && item.type === 'command_execution') out.push(...toolEvents('command_execution', { command: item.command }, state.cwd));
    else if (obj.type === 'item.started' && item.type === 'mcp_tool_call') out.push(...toolEvents(item.tool || 'mcp', item.arguments, state.cwd));
    else if (obj.type === 'item.started' && item.type === 'web_search') out.push({ kind: 'web', label: t('stream.researching', { q: clip(item.query, 40) }) });
    else if (obj.type === 'item.completed') {
      if (item.type === 'agent_message' && item.text?.trim()) {
        state.final = item.text;
        out.push({ kind: 'text', label: t('stream.drafting'), detail: item.text });
      } else if (item.type === 'reasoning') out.push({ kind: 'think', label: t('stream.thinking'), detail: clip(item.text, 300) });
      else if (item.type === 'command_execution' && item.exit_code) {
        out.push({ kind: 'error', label: t('stream.commandFailed', { code: item.exit_code }), detail: clip(`${cleanCommand(item.command)}\n${item.aggregated_output || ''}`, 300) });
      } else if (item.type === 'file_change') {
        for (const ch of item.changes || []) {
          const f = shortPath(ch.path, state.cwd);
          out.push({ kind: 'write', tool: 'file_change', file: f, label: t(ch.kind === 'add' ? 'stream.creating' : ch.kind === 'delete' ? 'stream.deleting' : 'stream.editing', { file: f }) });
        }
      } else if (item.type === 'todo_list') out.push({ kind: 'plan', label: t('stream.planning') });
    } else if (obj.type === 'turn.failed' || obj.type === 'error') {
      out.push({ kind: 'error', label: t('stream.cliError'), detail: clip(obj.error?.message || obj.message || '', 300) });
    } else if (obj.type === 'turn.completed') {
      state.usage = normalizeUsage(obj.usage) || state.usage;
      out.push({ kind: 'info', label: t('stream.turnDone') });
    }
    return out;
  };
}

function grokHandler(state) {
  let segment = '';
  let thinking = false;
  let thought = '';
  const say = growing();
  const flush = out => {
    if (segment.trim()) out.push({ kind: 'text', label: t('stream.drafting'), detail: segment });
    segment = '';
  };
  state.grokFinal = () => segment;
  return obj => {
    const out = [];
    if (obj.type === 'text') {
      const prev = segment;
      segment += obj.data || '';
      thinking = false;
      state.lastText = segment;
      // Grok manda el texto en deltas. Sin este aviso la burbuja no cambia hasta la herramienta o el fin.
      if (!prev.trim() && segment.trim()) out.push({ kind: 'text', label: t('stream.drafting'), detail: clip(segment, 240) });
      else say(out, segment, !prev, t('stream.drafting'));
    } else if (obj.type === 'thought') {
      if (!thinking) { thought = ''; out.push({ kind: 'think', label: t('stream.thinking') }); }
      thought += obj.data || '';
      say(out, thought, !thinking, t('stream.thinking'));
      thinking = true;
    } else if (obj.type === 'tool_call') {
      flush(out);
      thinking = false;
      out.push(...toolEvents(obj.toolName || obj.title, obj.rawInput, state.cwd));
    } else if (obj.type === 'tool_call_update' && obj.status === 'failed') {
      out.push({ kind: 'error', label: t('stream.toolFailed'), detail: clip(JSON.stringify(obj.content || ''), 300) });
    } else if (obj.type === 'end') {
      state.final = segment;
      flush(out);
      state.usage = normalizeUsage(obj.usage, obj.total_cost_usd) || state.usage;
      if (obj.stopReason && obj.stopReason !== 'end_turn') out.push({ kind: 'error', label: t('stream.endedStatus', { status: obj.stopReason }) });
      else out.push({ kind: 'info', label: t('stream.turnDone') });
    } else if (obj.type === 'error') {
      out.push({ kind: 'error', label: t('stream.cliError'), detail: clip(obj.message || obj.data || '', 300) });
    }
    return out;
  };
}

// Kimi Code (`kimi -p … --output-format stream-json`): una línea por mensaje, con forma de chat.
// {role:'assistant', content, tool_calls?} · {role:'tool', tool_call_id, content} · {role:'meta', type:'session.resume_hint'}.
// No trae uso de tokens ni el pensamiento. El reporte es el último mensaje del asistente con texto.
function kimiHandler(state) {
  const textOf = c => typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => (typeof p === 'string' ? p : p?.text || '')).join('') : '';
  return obj => {
    const out = [];
    if (obj.role === 'assistant') {
      const text = textOf(obj.content);
      if (text.trim()) {
        state.lastText = text;
        out.push({ kind: 'text', label: t('stream.drafting'), detail: text });
      }
      for (const call of obj.tool_calls || []) {
        const fn = call.function || {};
        const input = typeof fn.arguments === 'string' ? (safeJson(fn.arguments) || {}) : fn.arguments || {};
        out.push(...toolEvents(fn.name, input, state.cwd));
      }
    } else if (obj.role === 'tool' && /^\s*(error|failed)/i.test(textOf(obj.content))) {
      out.push({ kind: 'error', label: t('stream.toolFailed'), detail: clip(textOf(obj.content), 300) });
    } else if (obj.role === 'meta' && obj.type === 'session.resume_hint') {
      out.push({ kind: 'info', label: t('stream.turnDone') });
    }
    return out;
  };
}

const HANDLERS = { claude: claudeHandler, agy: agyHandler, codex: codexHandler, grok: grokHandler, kimi: kimiHandler };

// Crea un parser incremental. feed() acepta trozos arbitrarios (las líneas pueden llegar partidas).
function createStreamParser(format = 'text', { cwd } = {}) {
  const state = { cwd, final: null, lastText: '', usage: null };
  const handle = HANDLERS[format] ? HANDLERS[format](state) : null;
  let buffer = '';
  let plain = ''; // todo lo que no fue JSON reconocible (o todo, en modo texto)
  let jsonLines = 0;

  const processLine = line => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    const obj = handle ? safeJson(trimmed) : null;
    if (obj) {
      jsonLines++;
      return handle(obj).map(e => ({ ...e, label: clip(e.label, 60) }));
    }
    plain += line + '\n';
    return [{ kind: 'raw', label: clip(trimmed, 60), detail: clip(trimmed, 500) }];
  };

  return {
    feed(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      return lines.flatMap(processLine);
    },
    end() {
      const rest = buffer;
      buffer = '';
      return rest ? processLine(rest) : [];
    },
    // Texto final del agente (su reporte). Si no hubo streaming reconocible, es la salida en texto plano.
    finalText() {
      if (state.final != null && state.final.trim()) return state.final.trim();
      if (state.grokFinal && state.grokFinal().trim()) return state.grokFinal().trim();
      if (state.lastText.trim()) return state.lastText.trim();
      return plain.trim();
    },
    get usedStreaming() { return jsonLines > 0; },
    get usage() { return state.usage; },
  };
}

module.exports = { createStreamParser, toolEvent, toolEvents, cleanCommand, classifyCommand, commandEvents, describeCommand, shortPath, normalizeUsage, sayText, FORMATS };
