import { verifyToken } from '../lib/auth.js';
import { HttpError } from '../lib/http.js';
import db from '../db/connection.js';

export function getTokenFromRequest(req) {
  const header = req.headers['authorization'];
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }
  return null;
}

export async function authenticate(req, res, next) {
  const token = getTokenFromRequest(req);
  const payload = verifyToken(token);
  if (!payload) {
    throw new HttpError(401, 'No autenticado. Inicia sesión de nuevo.');
  }
  const user = db.prepare('SELECT id, name, username, role, active FROM users WHERE id = ?').get(payload.sub);
  if (!user || !user.active) {
    throw new HttpError(401, 'Usuario inválido o inactivo.');
  }
  req.user = user;
  next();
}

// Middleware factory: requiere alguno de los roles indicados
export function requireRole(...roles) {
  return async function (req, res, next) {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new HttpError(403, 'No tienes permisos para esta acción.');
    }
    next();
  };
}
