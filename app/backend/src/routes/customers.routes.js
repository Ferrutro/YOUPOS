import { Router, sendJson, readJsonBody, HttpError } from '../lib/http.js';
import db from '../db/connection.js';
import { authenticate } from '../middleware/authenticate.js';

const router = new Router();

router.get('/api/customers', authenticate, async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('q');
  let sql = 'SELECT * FROM customers';
  const params = [];
  if (q) {
    sql += ' WHERE name LIKE ? OR phone LIKE ? OR email LIKE ?';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY name';
  const customers = db.prepare(sql).all(...params);
  sendJson(res, 200, { customers });
});

router.post('/api/customers', authenticate, async (req, res) => {
  const b = await readJsonBody(req);
  if (!b.name) throw new HttpError(400, 'El nombre del cliente es requerido.');
  const info = db
    .prepare('INSERT INTO customers (name, phone, email, tax_id, address, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(b.name, b.phone || null, b.email || null, b.tax_id || null, b.address || null, b.notes || null);
  sendJson(res, 201, { id: Number(info.lastInsertRowid) });
});

router.put('/api/customers/:id', authenticate, async (req, res) => {
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!existing) throw new HttpError(404, 'Cliente no encontrado.');
  const b = await readJsonBody(req);
  const merged = { ...existing, ...b };
  db.prepare('UPDATE customers SET name=?, phone=?, email=?, tax_id=?, address=?, notes=? WHERE id=?').run(
    merged.name, merged.phone, merged.email, merged.tax_id, merged.address, merged.notes, req.params.id
  );
  sendJson(res, 200, { ok: true });
});

router.delete('/api/customers/:id', authenticate, async (req, res) => {
  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  sendJson(res, 200, { ok: true });
});

export default router;
