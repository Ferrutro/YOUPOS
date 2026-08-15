import { Router, sendJson, readJsonBody, HttpError } from '../lib/http.js';
import db from '../db/connection.js';
import { authenticate, requireRole } from '../middleware/authenticate.js';

const router = new Router();

router.get('/api/categories', authenticate, async (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  sendJson(res, 200, { categories });
});

router.post('/api/categories', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const body = await readJsonBody(req);
  if (!body.name) throw new HttpError(400, 'El nombre de la categoría es requerido.');
  try {
    const info = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').run(body.name, body.color || null);
    sendJson(res, 201, { id: Number(info.lastInsertRowid) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'Esa categoría ya existe.');
    throw err;
  }
});

router.put('/api/categories/:id', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) throw new HttpError(404, 'Categoría no encontrada.');
  const body = await readJsonBody(req);
  if (!body.name) throw new HttpError(400, 'El nombre de la categoría es requerido.');
  // `color` se puede quitar a propósito (botón "Quitar color"), así que un
  // `null` explícito debe borrarlo — no tratarse como "no enviado".
  const color = 'color' in body ? body.color : existing.color;
  db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(body.name, color, req.params.id);
  sendJson(res, 200, { ok: true });
});

router.delete('/api/categories/:id', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  sendJson(res, 200, { ok: true });
});

export default router;
