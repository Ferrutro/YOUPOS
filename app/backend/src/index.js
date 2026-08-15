import http from 'node:http';
import { exec } from 'node:child_process';
import { Router, sendJson } from './lib/http.js';
import { serveStatic } from './lib/static.js';
import { PORT, FRONTEND_DIR } from './config.js';
import { seed } from './db/seed.js';

import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/users.routes.js';
import categoryRoutes from './routes/categories.routes.js';
import productRoutes from './routes/products.routes.js';
import customerRoutes from './routes/customers.routes.js';
import cashSessionRoutes from './routes/cashsessions.routes.js';
import saleRoutes from './routes/sales.routes.js';
import reportRoutes from './routes/reports.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import heldSaleRoutes from './routes/heldsales.routes.js';
import noteRoutes from './routes/notes.routes.js';

// Asegura que la base de datos exista y tenga datos iniciales (seed() ya aplica la migración)
seed();

const api = new Router();
for (const r of [
  authRoutes, userRoutes, categoryRoutes, productRoutes,
  customerRoutes, cashSessionRoutes, saleRoutes, reportRoutes, settingsRoutes, heldSaleRoutes, noteRoutes,
]) {
  api.routes.push(...r.routes);
}

const serveFrontend = serveStatic(FRONTEND_DIR);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // CORS básico (útil si el frontend se sirve desde otro origen en desarrollo)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    const handled = await api.handle(req, res, url.pathname);
    if (!handled) sendJson(res, 404, { error: 'Ruta de API no encontrada.' });
    return;
  }

  const served = serveFrontend(req, res);
  if (!served) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('No encontrado');
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\nSistema POS corriendo en ${url}\n`);
  console.log('Deja esta ventana abierta mientras uses el sistema. Ciérrala para apagarlo.\n');

  // Abre el navegador automáticamente (útil sobre todo al correr como .exe)
  if (process.env.POS_NO_OPEN_BROWSER !== '1') {
    const openCommand =
      process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(openCommand, () => {});
  }
});
