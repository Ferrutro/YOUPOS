import { Router, sendJson, readJsonBody, HttpError } from '../lib/http.js';
import db from '../db/connection.js';
import { verifyPassword, hashPassword, createToken } from '../lib/auth.js';
import { authenticate } from '../middleware/authenticate.js';

const router = new Router();

router.post('/api/auth/login', async (req, res) => {
  const body = await readJsonBody(req);
  const { username, password } = body;
  if (!username || !password) {
    throw new HttpError(400, 'Usuario y contraseña son requeridos.');
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    throw new HttpError(401, 'Usuario o contraseña incorrectos.');
  }
  const token = createToken({ sub: user.id, role: user.role });
  sendJson(res, 200, {
    token,
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
  });
});

router.get('/api/auth/me', authenticate, async (req, res) => {
  sendJson(res, 200, { user: req.user });
});

router.post('/api/auth/change-password', authenticate, async (req, res) => {
  const body = await readJsonBody(req);
  const { currentPassword, newPassword } = body;
  if (!newPassword || String(newPassword).length < 4) {
    throw new HttpError(400, 'La nueva contraseña debe tener al menos 4 caracteres.');
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(currentPassword, user.password_hash)) {
    throw new HttpError(401, 'La contraseña actual no es correcta.');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
  sendJson(res, 200, { ok: true });
});

export default router;
