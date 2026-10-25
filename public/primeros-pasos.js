// Catálogo compartido por el asistente y los instaladores. Nunca ejecuta estos comandos.
// Las notas son claves del diccionario (public/i18n/<idioma>.json), para que salgan en el idioma elegido.
(function (root) {
  const catalog = {
    claude: { windows: 'irm https://claude.ai/install.ps1 | iex', unix: 'curl -fsSL https://claude.ai/install.sh | bash', login: 'claude' },
    codex: { windows: 'npm install -g @openai/codex', unix: 'npm install -g @openai/codex', login: 'codex login' },
    grok: { windows: 'irm https://x.ai/cli/install.ps1 | iex', unix: 'https://x.ai/cli', login: 'grok login' },
    gemini: { windows: 'irm https://antigravity.google/cli/install.ps1 | iex', unix: 'https://antigravity.google/cli', login: 'agy', noteKey: 'setup.note.gemini' },
    kimi: { windows: 'irm https://code.kimi.com/kimi-code/install.ps1 | iex', unix: 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash', login: 'kimi login', noteKey: 'setup.note.kimi' },
  };
  if (typeof module === 'object') module.exports = catalog;
  else root.primerosPasosCatalog = catalog;
})(globalThis);
