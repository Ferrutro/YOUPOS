// Punto de entrada mínimo para empaquetar MiPOS.exe con la función oficial
// "Single Executable Applications" de Node.js.
//
// Este archivo NO contiene la lógica de la aplicación. Su único trabajo es:
//   1. Averiguar dónde está el .exe (no dónde está este script, que queda
//      incrustado dentro del binario y no tiene una ubicación real en disco).
//   2. Cargar dinámicamente la app real (app/backend/src/index.js), que debe
//      quedar SIEMPRE junto al .exe, dentro de la carpeta "app".
//
// Por qué así: la función de Node para generar ejecutables solo permite
// incrustar UN archivo. En vez de fusionar los ~20 archivos de la app en uno
// solo (lo que requeriría herramientas adicionales), este script truco carga
// la app real desde disco en tiempo de ejecución. El resultado final se
// comporta igual: el usuario solo necesita el .exe y la carpeta "app" al
// lado, sin instalar Node.js.

const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const exeDir = path.dirname(process.execPath);
const appEntry = path.join(exeDir, 'app', 'backend', 'src', 'index.js');

if (!fs.existsSync(appEntry)) {
  console.error('\nNo se encontró la aplicación.');
  console.error(`Se esperaba encontrarla en: ${appEntry}`);
  console.error('Asegúrate de que la carpeta "app" esté junto al archivo .exe.\n');
  process.exit(1);
}

import(pathToFileURL(appEntry).href).catch((err) => {
  console.error('Error al iniciar el sistema POS:', err);
  process.exit(1);
});
