# Publicar una versión

Para quien mantiene el repositorio. La historia de desarrollo contiene datos privados, así que la versión pública sale de
una rama nueva con un solo commit.

1. Todo en verde. El escáner mira el índice y también los archivos nuevos que `.gitignore` no excluye
   (lo que entraría en un `git add -A`):
   ```powershell
   npm test
   node scripts/revisar-publicacion.js
   ```
2. Rama huérfana `publico` con el contenido actual (lo ignorado no entra):
   ```powershell
   node scripts/preparar-publico.js            # --rehacer si la rama ya existe
   ```
   El script usa un índice temporal: no cambia de rama ni toca tu índice ni tus archivos (con `git checkout --orphan`
   y la vuelta a tu rama, git reescribiría los documentos internos ignorados con su versión vieja). Escribe la lista
   de lo que se publica en [`LISTA-PUBLICA.txt`](LISTA-PUBLICA.txt), crea el commit sin padre, clona solo esa rama en
   una carpeta temporal y pasa `revisar-publicacion.js --historial` sobre su historia entera.
3. Comprueba desde un clon de solo esa rama, como un usuario nuevo:
   ```powershell
   git clone --single-branch -b publico <esta carpeta> $env:TEMP\om-nuevo
   cd $env:TEMP\om-nuevo
   $env:PORT=4400; node server.js
   ```
   Y sigue [INSTALAR.md](INSTALAR.md) al pie de la letra.
4. Sube **solo** esa rama: `git push <remoto> publico:main`. Nunca subas `master` ni otras ramas de desarrollo.
