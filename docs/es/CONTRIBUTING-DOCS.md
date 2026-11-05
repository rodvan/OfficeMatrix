# Cómo se actualiza la documentación

[![English](https://img.shields.io/badge/Language-English-blue.svg)](../CONTRIBUTING-DOCS.md)
[![Español](https://img.shields.io/badge/Idioma-Español-orange.svg)](CONTRIBUTING-DOCS.md)

Las reglas que el equipo ya sigue cuando cambia la documentación de OfficeMatrix. Corta a propósito: si cambias cómo se comporta algo, esta página dice qué archivos se mueven con ello.

## 1. Cada guía existe dos veces, con el mismo nombre

- En inglés en `docs/<NOMBRE>.md` y en español en `docs/es/<NOMBRE>.md`. Mismo nombre de archivo, mismas secciones en el mismo orden.
- Las dos empiezan con el título y estas dos insignias, para cambiar de idioma desde arriba:

  ```markdown
  # Conecta un Grok Bot

  [![English](https://img.shields.io/badge/Language-English-blue.svg)](../GROK-BOTS.md)
  [![Español](https://img.shields.io/badge/Idioma-Español-orange.svg)](GROK-BOTS.md)
  ```

  En el archivo en inglés los enlaces van al revés: `GROK-BOTS.md` y `es/GROK-BOTS.md`.
- Si cambias una, cambia la otra en la misma edición. Una guía que existe en un solo idioma está a medias.
- Una guía nueva lleva además una fila en los dos índices: [docs/README.md](../README.md) y [docs/es/README.md](README.md).
- Las guías antiguas tienen un nombre traducido dentro de `docs/` (`INSTALL.md` / `INSTALAR.md`, `AGENTS.md` / `AGENTES.md`, `MODES.md` / `MODOS-DE-TRABAJO.md`, `FOR-AGENTS.md` / `PARA-AGENTES.md`, `PUBLISH.md` / `PUBLICAR.md`). Déjalas donde están; las nuevas usan `docs/es/` con el mismo nombre.

## 2. Cada decisión de diseño lleva número

Las decisiones se registran en [docs/DECISIONES.md](../DECISIONES.md), en español (es el cuaderno de trabajo del equipo). Cada entrada toma el número siguiente (`D85`, `D86`, …; mira el último encabezado del archivo) y tiene esta forma:

```markdown
## D86 · Qué se decidió, en una línea (quién, fecha)
- **Qué:** qué cambió: archivos, rutas, funciones, la prueba que lo cubre.
- **Por qué:** la razón, y qué pasó para que hiciera falta.
- **Reglas:** lo que tiene que seguir siendo cierto desde ahora.
```

No renumeres ni reescribas entradas viejas. Si una decisión reemplaza a otra, dilo en la nueva ("reemplaza a D46").

## 3. Un cambio de comportamiento mueve cuatro cosas juntas

Cuando OfficeMatrix empieza a hacer algo de otra forma, el mismo cambio toca:

1. **La guía del tema**, en los dos idiomas (por ejemplo `docs/GROK-BOTS.md` y `docs/es/GROK-BOTS.md`).
2. **El registro de decisiones**, con una entrada `Dn` nueva.
3. **Las pruebas** en `tests/*.test.js`: una que fallaría sin el cambio.
4. **Los textos de la interfaz**, si cambia una pantalla: `public/i18n/en.json` y `public/i18n/es.json` con las mismas claves y los mismos `{huecos}` (una prueba lo comprueba), y el texto en inglés del HTML igual al de `en.json`.

Si un número del README se queda viejo (el total de pruebas, por ejemplo), corrígelo en el mismo cambio.

## 4. Corre las pruebas

```bash
npm test
```

Sin dependencias: ejecuta `node --test "tests/*.test.js"`. Todo tiene que salir en verde antes de dar el cambio por terminado. Antes de publicar, corre también:

```bash
node scripts/revisar-publicacion.js
```

Comprueba que no se publique ningún archivo privado, llave ni dato personal.

## 5. Lo que nunca va en los docs

- Llaves, tokens, secretos de webhook, contraseñas, códigos OAuth ni nada de un archivo `*.secreto.json`.
- URLs de túnel reales. Usa `https://<palabras-al-azar>.trycloudflare.com` o `https://bots.tudominio.com`.
- Correos, IDs de cuenta, IDs de Discord ni direcciones de pago reales. Usa marcadores evidentes.
- Capturas que muestren cualquiera de lo anterior. Recórtalas o difumínalas antes de ponerlas en `docs/img/`.

## 6. Cómo se escribe

- Frases cortas y pasos numerados. Nombra botones y campos exactamente como los muestra la pantalla, en **negrita**.
- Di qué ve quien lee cuando funcionó (la línea verde, la palabra `pong`), no solo qué pulsar.
- Di lo que OfficeMatrix **no** hace solo (descargar programas, arrancar un túnel, publicar un post) cuando alguien podría esperarlo.
- Cuando algo sale mal a menudo, añádelo a una tabla "Qué puede salir mal": lo que ves, por qué, cómo se arregla.
