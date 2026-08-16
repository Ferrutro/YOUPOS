// Servidorcito temporal, solo para poder descargar el instalador por la red
// local — no forma parte de la app.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const EXE_PATH = path.join(__dirname, 'dist', 'YOUPOS Setup 1.0.0.exe');
const PORT = 8080;

http.createServer((req, res) => {
  const content = fs.readFileSync(EXE_PATH);
  res.writeHead(200, {
    'Content-Type': 'application/x-msdownload',
    'Content-Length': content.length,
    'Content-Disposition': 'attachment; filename="YOUPOS Setup 1.0.0.exe"',
  });
  res.end(content);
}).listen(PORT, () => console.log(`Sirviendo el instalador en el puerto ${PORT}`));
