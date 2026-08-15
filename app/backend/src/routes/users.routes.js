import { Router, sendJson, readJsonBody, HttpError } from '../lib/http.js';
import db from '../db/connection.js';
import { hashPassword } from '../lib/auth.js';
import { authenticate, requireRole } from '../middleware/authenticate.js';

const router = new Router();

router.get('/api/users', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const users = db.prepare('SELECT id, name, username, role, active, created_at FROM users ORDER BY id').all();
  sendJson(res, 200, { users });
});

router.post('/api/users', authenticate, requireRole('admin'), async (req, res) => {
  const body = await readJsonBody(req);
  const { name, username, password, role } = body;
  if (!name || !username || !password) {
    throw new HttpError(400, 'Nombre, usuario y contraseña son requeridos.');
  }
  if (!['admin', 'manager', 'cashier'].includes(role)) {
    throw new HttpError(400, 'Rol inválido.');
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) throw new HttpError(409, 'Ese nombre de usuario ya existe.');
  const info = db
    .prepare('INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name, username, hashPassword(password), role);
  sendJson(res, 201, { id: Number(info.lastInsertRowid) });
});

router.put('/api/users/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const body = await readJsonBody(req);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) throw new HttpError(404, 'Usuario no encontrado.');

  const name = body.name ?? existing.name;
  const role = body.role ?? existing.role;
  const active = body.active === undefined ? existing.active : (body.active ? 1 : 0);

  db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(name, role, active, id);

  if (body.password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), id);
  }
  sendJson(res, 200, { ok: true });
});

router.delete('/api/users/:id', authenticate, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) {
    throw new HttpError(400, 'No puedes desactivar tu propio usuario.');
  }
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
  sendJson(res, 200, { ok: true });
});

export default router;
