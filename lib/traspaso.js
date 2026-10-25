// Traspaso de memoria entre oficinas: el ÚNICO cruce permitido (herencia cero, D1 de docs/simulaciones/SIMULACIONES.md).
// 1. Desde el panel Cerebro de A eliges una entrada y un destino B.
// 2. Se copia a .control/oficinas/B/entrantes/<fecha>-<slug>.md, FUERA de oficinas/B/: ni el brief ni la búsqueda de B
//    lo ven, y ningún agente de B lo encuentra en su memoria.
// 3. Entra en la memoria de B solo cuando, DENTRO de B, pulsas «Aceptar» y eliges tema.
// Es una copia, no un enlace: si el original cambia, B no cambia. Ningún agente (ni con llave) puede traspasar.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const memory = require('./memory');
const { t } = require('./i18n');

const FILE_RE = /^\d{8}-\d{6}-[a-z0-9-]{1,50}\.md$/;
const slug = t => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'entrada';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function createTraspasos(DATA, registry, control = path.join(DATA, '.control')) {
  const dirOf = id => path.join(control, 'oficinas', id, 'entrantes');
  const fail = (status, msg) => Object.assign(new Error(msg), { status });

  // Entradas de un tema (las mismas que ve la búsqueda), para elegir cuál traspasar.
  function entradas(origen, name) {
    const file = memory.validName(name);
    const full = file && path.join(registry.dirs(origen).memoria, file);
    if (!full || !fs.existsSync(full)) throw fail(404, t('transfer.err.topicMissing'));
    return memory.splitEntries(file, fs.readFileSync(full, 'utf8')).map((e, i) => ({ index: i, heading: e.heading, text: e.text }));
  }

  function traspasar(origen, { name, index, destino }) {
    if (!registry.read(destino)) throw fail(404, t('transfer.err.destMissing'));
    if (destino === origen) throw fail(400, t('transfer.err.sameOffice'));
    const e = entradas(origen, name)[Number(index)];
    if (!e) throw fail(404, t('transfer.err.entryMissing'));
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const titulo = (e.text.split('\n')[0] || e.heading).replace(/^[#\-*\s]+/, '').slice(0, 120);
    const base = `${stamp}-${slug(titulo)}`;
    let archivo;
    const de = registry.read(origen);
    const head = t('transfer.header', { office: de.nombre, file: name, title: titulo, sha: sha(e.text).slice(0, 16), when: now.toISOString() });
    const body = `${head}\n\n${e.text}\n`;
    fs.mkdirSync(dirOf(destino), { recursive: true });
    // Nunca sustituir un entrante: dos temas pueden tener el mismo título y
    // enviarse en el mismo segundo. wx comprueba y crea en una sola operación.
    for (let n = 0; ; n++) {
      const suffix = n ? `-${n}` : '';
      archivo = `${base.slice(0, 66 - suffix.length)}${suffix}.md`;
      try {
        fs.writeFileSync(path.join(dirOf(destino), archivo), body, { flag: 'wx' });
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }
    }
    registry.bitacora?.(origen, t('transfer.log.sent', { title: titulo, file: name, office: registry.read(destino).nombre }));
    return { archivo, destino, titulo };
  }

  function listar(destino) {
    const dir = dirOf(destino);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => FILE_RE.test(f)).sort().map(archivo => {
      const content = fs.readFileSync(path.join(dir, archivo), 'utf8');
      return { archivo, desde: (/^> (?:Traspaso desde|Transfer from): ([^·\n]+)/.exec(content)?.[1] || '').trim(), content };
    });
  }

  const fileOf = (destino, archivo) => {
    if (!FILE_RE.test(String(archivo || ''))) throw fail(400, t('transfer.err.badIncoming'));
    const f = path.join(dirOf(destino), archivo);
    if (!fs.existsSync(f)) throw fail(404, t('transfer.err.incomingMissing'));
    return f;
  };

  // Aceptar: el texto (con su cabecera de procedencia) se añade al final del tema elegido, con historial.
  function aceptar(destino, archivo, tema) {
    const f = fileOf(destino, archivo);
    const name = memory.validName(tema);
    if (!name) throw fail(400, t('transfer.err.badTopic'));
    const memDir = registry.dirs(destino).memoria;
    const target = path.join(memDir, name);
    const prev = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : `# ${name.replace(/\.md$/, '')}\n`;
    memory.writeWithHistory(memDir, name, `${prev.trimEnd()}\n\n${fs.readFileSync(f, 'utf8').trim()}\n`);
    fs.unlinkSync(f);
    registry.bitacora?.(destino, t('transfer.log.accepted', { file: name, item: archivo }));
    return { tema: name };
  }

  function descartar(destino, archivo) {
    fs.unlinkSync(fileOf(destino, archivo));
    registry.bitacora?.(destino, t('transfer.log.discarded', { item: archivo }));
  }

  return { entradas, traspasar, listar, aceptar, descartar, dirOf };
}

module.exports = { createTraspasos };
