import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Sirve archivos estáticos desde `rootDir`. Si la ruta no existe y no tiene
// extensión, cae a index.html (útil para navegación de una sola página).
export function serveStatic(rootDir) {
  const resolvedRoot = path.resolve(rootDir);
  return function (req, res) {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    let filePath = path.join(resolvedRoot, urlPath === '/' ? 'index.html' : urlPath);
    filePath = path.resolve(filePath);

    // Evita path traversal fuera del directorio raíz
    if (!filePath.startsWith(resolvedRoot)) {
      res.writeHead(403);
      res.end('Prohibido');
      return true;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      const ext = path.extname(urlPath);
      if (!ext) {
        filePath = path.join(resolvedRoot, 'index.html');
      } else {
        return false;
      }
    }

    if (!fs.existsSync(filePath)) return false;

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': content.length });
    res.end(content);
    return true;
  };
}
