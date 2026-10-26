const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Los diccionarios reales, como los deja cargados public/i18n.js en el navegador.
const dicts = Object.fromEntries(['en', 'es'].map(l => [l, JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n', `${l}.json`), 'utf8'))]));
const I18N = lang => ({ DEFAULT: 'en', lang, dict: l => dicts[l] || null, load: async () => {} });

function setup() {
 const pending=[], ctx={currentId:'a',officeEpoch:0,current:{running:false},renderReports(){}, document:{addEventListener(k,f){ctx.click=f;}}, api:url=>new Promise(resolve=>pending.push({url,resolve}))};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/cierre.js','utf8'),ctx);
 return {ctx,pending};
}
function card(uiLang) {
  const ctx = {
    currentId: 'a', officeEpoch: 0, current: { running: false }, renderReports() {},
    document: { documentElement: { lang: uiLang }, addEventListener() {} }, I18N: I18N(uiLang),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('public/cierre-textos.js', 'utf8'), ctx);
  vm.runInContext(fs.readFileSync('public/cierre.js', 'utf8'), ctx);
  return data => {
    vm.runInContext(`cierreView={id:'a',epoch:0,data:${JSON.stringify(data)}}`, ctx);
    return vm.runInContext('cierreHtml()', ctx);
  };
}
const base = {
  semaforo: 'verde', causa: 'aprobado', autor: 'plantilla', aplicado: false,
  numeros: { fuente: 'instantaneas', tocados: 2, minutos: 3, turnos: 4, pruebasDefinidas: {}, agentes: [], porRonda: [], archivos: [] },
  logros: [], brief: { puntos: [] }, noLogrado: {}, pendientes: { otraRonda: [], tu: [] }, riesgos: [], ejecutado: { pruebas: [], puertos: [], capturas: [] },
  mision: { minScore: 9 },
};

test('cierre: una respuesta antigua no cruza A → B → A ni oficinas',async()=>{
 const {ctx,pending}=setup();const old=ctx.loadCierre();ctx.officeEpoch++;const fresh=ctx.loadCierre();pending[1].resolve({marker:'nuevo'});await fresh;pending[0].resolve({marker:'viejo'});await old;
 assert.equal(vm.runInContext('cierreView.data.marker',ctx),'nuevo');
});

test('cierre: la tarjeta habla el idioma del informe', () => {
  const html = card('es')({
    ...base, idioma: 'en', veredicto: { frase: 'Done: everyone approved without changes' },
    opciones: [{ id: 'seguir', etiqueta: '▶ 1 more round', explica: 'Starts the team again.', coste: 'up to 1 turn', disponible: true }],
  });
  assert.match(html, /What was achieved/);
  assert.match(html, /Green · Approved/);
  assert.match(html, /▶ 1 more round/);
  assert.doesNotMatch(html, /Qué se logró|Verde · Aprobado/);
  assert.doesNotMatch(html, /cierre-top-actions/, 'aprobado: no hace falta «Continuar» arriba');
});

test('cierre: sin informe, el botón «Generate closing report» sale en el idioma de la interfaz (inglés por defecto)', () => {
  assert.match(card('en')({ missing: true }), /Generate closing report/);
  assert.match(card('es')({ missing: true }), /Generar informe de cierre/);
});

test('cierre: «▶ Continue until done» va arriba del informe cuando el equipo se paró sin aprobar', () => {
  const L = require('../public/cierre-textos.js');
  const html = card('en')({
    ...base, idioma: 'en', semaforo: 'ambar', causa: 'meseta', veredicto: { frase: L.en.meseta },
    opciones: [
      { id: 'seguir', etiqueta: L.en.continuar, explica: L.en.explicaContinuar, coste: L.en.coste(8, 40), disponible: true, editable: 'text' },
      { id: 'aceptar', etiqueta: L.en.aceptar, explica: L.en.explicaAceptar, coste: L.en.ceroTurnos },
    ],
  });
  assert.equal(L.en.continuar, '▶ Continue until done');
  const top = html.indexOf('cierre-top-actions'), achieved = html.indexOf('What was achieved'), options = html.indexOf('Your options');
  assert.ok(top > 0 && top < achieved && achieved < options, 'el botón va antes de las secciones del informe');
  assert.match(html.slice(top, achieved), /data-cierre-action="0">▶ Continue until done</);
});

test('cierre: cada texto del informe existe en los dos idiomas (ninguno cae a su clave)', () => {
  const L = require('../public/cierre-textos.js');
  const args = [2, 'x', 3, 'y', true];
  for (const lang of ['en', 'es']) {
    const walk = (o, p) => {
      for (const [k, v] of Object.entries(o)) {
        const s = typeof v === 'function' ? v(...(k === 'objecionCierre' ? [{ id: 1, by: 'a', text: 't' }] : k === 'puntoCierre' ? [{ estado: 'falta', texto: 't' }] : args)) : v;
        if (typeof s === 'string') assert.ok(!/^cierre\./.test(s) && !/\{\w+\}/.test(s), `${lang} ${p}${k}: ${s}`);
        else if (s && typeof s === 'object') walk(s, `${p}${k}.`);
      }
    };
    walk(L[lang], '');
  }
});

test('cierre: instrucciones editadas conservan ruta, método y configuración',async()=>{
 const {ctx}=setup();const sent=[];ctx.withBusy=async(b,f)=>f();ctx.api=async(...a)=>sent.push(a);ctx.openChat=async()=>{};ctx.loadChats=async()=>{};ctx.toast=()=>{};
 vm.runInContext(`cierreView={id:'a',epoch:0,data:{opciones:[{editable:'text',metodo:'POST',ruta:'/api/chats/a/messages',cuerpo:{text:'original',config:{maxRounds:2}}}]}}`,ctx);
 const btn={dataset:{cierreSend:'0'},hasAttribute:k=>k==='data-cierre-send',closest:()=>({querySelector:()=>({querySelector:()=>({value:'Cerrar pendientes'})})})};
 await ctx.click({target:{closest:()=>btn}});
 assert.equal(sent[0][0],'/api/chats/a/messages');assert.equal(sent[0][1].method,'POST');assert.deepEqual(JSON.parse(sent[0][1].body),{text:'Cerrar pendientes',config:{maxRounds:2}});
});
