# 💬 Discord: un bot por oficina

[![English](https://img.shields.io/badge/Language-English-blue.svg)](../DISCORD.md)
[![Español](https://img.shields.io/badge/Idioma-Español-orange.svg)](DISCORD.md)

Cada oficina puede tener **su propio bot de Discord**. Hablas con las IAs de tu oficina desde el celular, te llegan avisos
cuando termina una misión y apruebas propuestas editoriales con un botón. El bot se conecta **hacia** Discord, así que no
hay túnel ni puerto abierto. Tampoco necesita librerías extra: OfficeMatrix usa el WebSocket que ya trae Node.

```
Tu servidor de Discord
 ├─ #nave        → Bot Nave        → estado de todas, pregunta a la oficina que nombres
 ├─ #cerebro     → Bot Cerebro     → solo la oficina Cerebro
 └─ #acme        → Bot Acme        → solo la oficina Acme
        ▲
   OfficeMatrix (tu PC): cada bot se conecta hacia Discord
```

## 🔒 Aislamiento: las reglas

- **Un bot solo habla con su oficina.** Queda atado a ella al arrancar: sus mensajes van al chat de esa oficina, sus
  propuestas son las de esa oficina y sus avisos, las misiones de esa oficina. Aunque le pidas «muéstrame Acme», no tiene
  cómo llegar a otra oficina.
- **El bot de la Nave** (se configura en el ⚙ de la Nave) da el estado de todas las oficinas y le pasa una pregunta a la
  oficina que nombres. Solo lo hace con las oficinas que tienen activo **Compartir con el bot de la Nave**. De las demás
  solo dice que no comparten. Los avisos de la Nave son una línea por misión, sin detalles.
- **Solo obedece a usuarios autorizados.** Son los IDs de Discord que pongas en la lista. Con la lista vacía no obedece a
  nadie: a quien lo menciona le contesta con su ID, como mucho una vez por hora y persona, para que lo copies.
- **Solo lectura.** Un mensaje de Discord nunca edita archivos. Los turnos del chat de oficina ya son de solo lectura.
  Desde Discord, además, Claude pierde las herramientas de leer archivos y abrir páginas, así que nadie en un canal puede
  pedirle leer una ruta de tu disco. Las otras CLIs no tienen ese interruptor, y es otra razón para que solo hablen los
  usuarios autorizados.
- **Imágenes.** Una IA solo puede generar imágenes con su propia herramienta. OfficeMatrix sube las que aparecen en ese turno (en su cajón temporal o, con Antigravity, en la carpeta de esa conversación) y no las guarda en el chat.
- **El token se queda en tu PC.** Vive en `discord.secreto.json`, dentro de la carpeta de la oficina y fuera de git. El
  panel no lo vuelve a mostrar, y el chat lo tapa si alguien lo pega. **Nunca lo pegues en un chat.**
- **Datos sensibles.** Si una oficina maneja datos que solo deben ir a las IAs que elegiste, no la conectes a Discord y
  apaga **Compartir con el bot de la Nave**. Discord es un servicio externo.

## 🚀 Paso a paso (5 minutos)

1. Abre <https://discord.com/developers/applications>, pulsa **New Application** y ponle el nombre de la oficina (p. ej.
   *Cerebro*).
2. Ve a **Bot**, luego **Reset Token**, y copia el token.
3. En OfficeMatrix abre el ⚙ de la oficina y entra a **Discord**. Pega el token y pulsa **Guardar**. El estado dice
   🟢 Conectado y el nombre de tu bot.
4. Pulsa **Invitar el bot a tu servidor**. El enlace ya pide solo lo necesario: ver canales, enviar mensajes, insertar
   enlaces, adjuntar archivos y leer el historial.
5. En Discord activa el **Modo desarrollador** (Ajustes de usuario → Avanzado). Haz clic derecho en un canal o en una
   persona y elige **Copiar ID**.
6. Menciona al bot una vez (`@bot hola`). Te contesta con **tu ID**. Pégalo en **Usuarios autorizados** y guarda.
7. Opcional: un **Canal de avisos**, los **Canales que escucha** y qué avisos quieres.
8. Pulsa **Enviar prueba**.

Repítelo en cada oficina, con una aplicación de Discord por oficina. Para la Nave, selecciona la Nave (🛸) y abre su ⚙: solo trae la sección de Discord.

## 🗣️ Cómo se usa

| Escribes en Discord | Qué pasa |
| --- | --- |
| `@bot @grok busca tendencias de Artemis` | Contesta esa IA de la oficina, firmado con su nombre |
| `@bot ¿qué opinan?` (sin `@nombre`) | Contesta el **anfitrión del chat** de la oficina (⚙ → Anfitrión del chat); si no hay, Claude o la primera IA |
| `@bot @gemini dibuja un astronauta en la luna` | Si la IA genera una imagen, llega a Discord con su respuesta (hasta 4 imágenes y 8 MB). Hoy lo hace Gemini (Antigravity) |
| `@bot propuestas` | Las propuestas editoriales pendientes, como tarjetas con botones |
| `@bot ayuda` | Un recordatorio corto |
| Nave: `@nave estado` | Por oficina: misiones en curso, propuestas pendientes y el estado de su bot |
| Nave: `@nave acme: ¿cómo va el landing?` | Le pregunta a la oficina Acme (si comparte) y contesta con 🏢 Acme |
| Nave: `@nave @claude resume la semana` | Contesta esa IA de la Nave. Sin oficina ni `@nombre`, contesta Claude (o la primera IA) |

Los mensajes de Discord también quedan en el chat de la oficina del panel, como «Discord · tu nombre», así que es una
sola conversación.

## 🔔 Avisos

| Aviso | Dónde | Contenido |
| --- | --- | --- |
| 🏁 Misión terminada | canal de avisos de la oficina | título, resultado y resumen |
| ⚠️ Falló una IA | canal de avisos de la oficina | quién, por qué y quién sigue |
| 📰 Propuesta editorial nueva | canal de avisos de la oficina | tema, gancho, copy, semáforo, fuentes, imagen y botones |
| 🏢 Titular | canal de avisos de la Nave | una línea, solo de las oficinas que comparten con la Nave |

**Botones de una propuesta:**
- **Aprobar** la manda a ViralHunt, igual que en el dashboard.
- Las 🔴 **rojas** no se pueden aprobar: el botón sale desactivado.
- Las 🟡 **amarillas** piden un segundo clic, *Confirmar amarilla y aprobar*.
- **Rechazar** deja anotado «Rechazada desde Discord por …».
- Solo los usuarios autorizados pueden pulsarlos. A cualquier otro le sale un aviso privado de «no autorizado».

Pedir cambios se queda en el dashboard, porque necesita una nota y las casillas de qué cambiar.

## 🔌 API (solo desde el panel)

| Método y ruta | Cuerpo | Respuesta |
| --- | --- | --- |
| `GET /api/oficinas/<id>/discord` | | `{ configurado, activo, estado, bot, invitacion, usuarios, canales, canalAvisos, avisos, permitirNave, nave }` (nunca el token) |
| `PUT /api/oficinas/<id>/discord` | `{ token?, usuarios, canales, canalAvisos, avisos: { misiones, fallos, propuestas }, permitirNave, activo }` | la misma vista; sin `token` se conserva el guardado |
| `DELETE /api/oficinas/<id>/discord` | | apaga el bot y borra `discord.secreto.json` |
| `POST /api/oficinas/<id>/discord/probar` | | manda un mensaje de prueba |

Para la Nave el id es `edificio`. Una llave de agente de oficina (`om_…`) no puede usar estas rutas.

Código: [`lib/discord.js`](../../lib/discord.js) (cliente del Gateway y REST) y
[`lib/discord-oficinas.js`](../../lib/discord-oficinas.js) (los bots por oficina). Pruebas:
[`tests/discord.test.js`](../../tests/discord.test.js), con un Discord falso y sin red.

## 🩺 Problemas comunes

| Ves | Solución |
| --- | --- |
| 🔴 Error · Discord rechazó el token | Cópialo otra vez en **Bot → Reset Token** (al resetear, el anterior deja de servir) |
| El bot está en línea pero no contesta | Menciónalo (`@bot …`). Revisa que tu ID esté en Usuarios autorizados y que el canal esté en la lista (o que la lista esté vacía) |
| «Nadie fue mencionado y esta oficina no tiene anfitrión» | Escribe `@nombre` de una IA o elige un Anfitrión del chat en ⚙ |
| No llegan avisos | Pon un Canal de avisos y dale permiso al bot de escribir ahí |
| «La oficina está contestando otro mensaje» | Contesta un mensaje a la vez por oficina; intenta en un momento |
