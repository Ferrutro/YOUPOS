import os from 'node:os';
import { Router, sendJson, readJsonBody } from '../lib/http.js';
import db from '../db/connection.js';
import { authenticate, requireRole } from '../middleware/authenticate.js';
import { PORT } from '../config.js';

const router = new Router();

router.get('/api/settings', authenticate, async (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  sendJson(res, 200, { settings });
});

// Direcciones IP de este equipo en la red local + el puerto — para que una
// tablet de cocina (u otro dispositivo en la misma red) sepa qué dirección
// escribir en su navegador para llegar a este mismo servidor.
router.get('/api/server-info', authenticate, async (req, res) => {
  const addresses = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const addr of iface || []) {
      if (addr.family === 'IPv4' && !addr.internal) addresses.push(addr.address);
    }
  }
  sendJson(res, 200, { addresses, port: PORT });
});

router.put('/api/settings', authenticate, requireRole('admin'), async (req, res) => {
  const b = await readJsonBody(req);
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [key, value] of Object.entries(b)) {
    upsert.run(key, String(value));
  }
  sendJson(res, 200, { ok: true });
});

export default router;
