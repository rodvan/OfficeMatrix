// Copia autoritativa del equipo fuera de la carpeta de trabajo de la misión.
// En contexto comparte usuario con las CLIs: esta ubicación no es una frontera del SO.
const fs=require('node:fs');
const path=require('node:path');
// Raíz de control: OFFICEMATRIX_CONTROL la saca de la raíz de datos (con S1F, ProgramData con ACL de solo lectura
// para las cuentas de oficina). Nunca dentro de un árbol donde trabajan agentes.
function controlDir(data, env = process.env) {
  const dir = env.OFFICEMATRIX_CONTROL ? path.resolve(env.OFFICEMATRIX_CONTROL) : path.join(data, '.control');
  const under = root => { const rel = path.relative(path.resolve(root), dir); return !rel.startsWith('..') && !path.isAbsolute(rel); };
  if (['oficinas', 'proyectos', 'memoria'].some(d => under(path.join(data, d)))) throw new Error('CONTROL_EN_ARBOL_DE_TRABAJO');
  return dir;
}
function createManifests(data, control = path.join(data, '.control')) {
  const valid=s=>typeof s==='string' && /^[a-z0-9][a-z0-9-]{0,119}$/.test(s);
  const fileFor=(office,mission)=>{
    if(!valid(office)||!valid(mission))throw new Error('MANIFIESTO_ID_INVALIDO');
    return path.join(control,'oficinas',office,'misiones',mission,'manifiesto.json');
  };
  return {
    read(office,mission) {
      const file=fileFor(office,mission);
      if(!fs.existsSync(file))return null;
      const value=JSON.parse(fs.readFileSync(file,'utf8'));
      if(value.oficina!==office||value.mision!==mission)throw new Error('MANIFIESTO_AJENO');
      return value;
    },
    create(office,mission,snapshot) {
      const file=fileFor(office,mission);
      fs.mkdirSync(path.dirname(file),{recursive:true});
      // No se sobrescribe al reanudar ni al cambiar fichas.
      fs.writeFileSync(file,JSON.stringify({version:1,oficina:office,mision:mission,equipo:snapshot},null,2),{flag:'wx'});
    },
  };
}
module.exports={createManifests, controlDir};
