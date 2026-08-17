// Copia el HTML/CSS/JS que ya existe en app/frontend hacia www/, para que
// Capacitor lo empaque en el APK. app/frontend sigue siendo la única fuente
// real — este script solo junta las piezas que Cocina necesita (nada se
// edita a mano dentro de www/, se pisa cada vez que se corre esto).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, '..', 'app', 'frontend');
const WWW = path.resolve(__dirname, 'www');

const FILES = [
  ['kitchen.html', 'index.html'],
  ['css/styles.css', 'css/styles.css'],
  ['css/kitchen.css', 'css/kitchen.css'],
  ['js/api.js', 'js/api.js'],
  ['js/icons.js', 'js/icons.js'],
  ['js/theme.js', 'js/theme.js'],
  ['js/kitchen.js', 'js/kitchen.js'],
  ['img/YOUPOS.png', 'img/YOUPOS.png'],
];

fs.rmSync(WWW, { recursive: true, force: true });
for (const [from, to] of FILES) {
  const src = path.join(FRONTEND, from);
  const dest = path.join(WWW, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
console.log(`Copiados ${FILES.length} archivos de app/frontend a cocina-app/www/`);
