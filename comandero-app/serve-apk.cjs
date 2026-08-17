// Servidorcito temporal, solo para poder descargar el APK por la red local
// mientras se prueba — no forma parte de la app.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const APK_PATH = path.join(__dirname, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const PORT = 8081;

http.createServer((req, res) => {
  const content = fs.readFileSync(APK_PATH);
  res.writeHead(200, {
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': content.length,
    'Content-Disposition': 'attachment; filename="comandero.apk"',
  });
  res.end(content);
}).listen(PORT, () => console.log(`Sirviendo el APK en el puerto ${PORT}`));
