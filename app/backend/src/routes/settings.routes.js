import { Router, sendJson, readJsonBody } from '../lib/http.js';
import db from '../db/connection.js';
import { authenticate, requireRole } from '../middleware/authenticate.js';

const router = new Router();

router.get('/api/settings', authenticate, async (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) settings[row.key] = row.value;
  sendJson(res, 200, { settings });
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
