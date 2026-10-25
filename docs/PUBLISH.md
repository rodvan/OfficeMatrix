# 📦 Publishing a release

[![English](https://img.shields.io/badge/Language-English-blue.svg)](PUBLISH.md)
[![Español](https://img.shields.io/badge/Idioma-Español-orange.svg)](PUBLICAR.md)

For whoever maintains the repository. The development history contains private data, so the public release comes from a
new branch with a single commit.

1. **Everything green.** The scanner checks the index and also the new files `.gitignore` doesn't exclude (what a
   `git add -A` would pick up):
   ```powershell
   npm test
   node scripts/revisar-publicacion.js
   ```
2. **Orphan branch `publico`** with the current content (ignored files stay out):
   ```powershell
   node scripts/preparar-publico.js            # --rehacer if the branch already exists
   ```
   The script uses a temporary index: it doesn't switch branches or touch your index or your files (with
   `git checkout --orphan` and switching back, git would overwrite the ignored internal documents with their old version).
   It writes the list of what gets published to [`LISTA-PUBLICA.txt`](LISTA-PUBLICA.txt), creates the parentless commit,
   clones only that branch into a temporary folder and runs `revisar-publicacion.js --historial` over its whole history.
3. **Check it from a clone of just that branch**, like a new user would:
   ```powershell
   git clone --single-branch -b publico <this folder> $env:TEMP\om-new
   cd $env:TEMP\om-new
   $env:PORT=4400; node server.js
   ```
   Then follow [INSTALL.md](INSTALL.md) to the letter.
4. **Push only that branch:** `git push <remote> publico:main`. Never push `master` or other development branches.
