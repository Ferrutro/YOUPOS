import { Router, sendJson, readJsonBody, HttpError } from '../lib/http.js';
import db from '../db/connection.js';
import { authenticate } from '../middleware/authenticate.js';

const router = new Router();

const COLORS = ['yellow', 'pink', 'blue', 'green', 'orange'];

// Notas tipo "sticky note": un pizarrón compartido por todos los que usan
// esta terminal (no son privadas por cajero), pensadas para recordatorios
// rápidos como "Dinero que agarran".
router.get('/api/notes', authenticate, async (req, res) => {
  const notes = db.prepare('SELECT * FROM sticky_notes ORDER BY id ASC').all();
  sendJson(res, 200, { notes });
});

router.post('/api/notes', authenticate, async (req, res) => {
  const b = await readJsonBody(req);
  const info = db
    .prepare(`
      INSERT INTO sticky_notes (user_id, content, color, pos_x, pos_y)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      req.user.id,
      b.content || '',
      COLORS.includes(b.color) ? b.color : 'yellow',
      Number.isFinite(b.pos_x) ? b.pos_x : 40,
      Number.isFinite(b.pos_y) ? b.pos_y : 40
    );
  const note = db.prepare('SELECT * FROM sticky_notes WHERE id = ?').get(info.lastInsertRowid);
  sendJson(res, 201, { note });
});

router.put('/api/notes/:id', authenticate, async (req, res) => {
  const row = db.prepare('SELECT * FROM sticky_notes WHERE id = ?').get(req.params.id);
  if (!row) throw new HttpError(404, 'Esa nota ya no existe.');
  const b = await readJsonBody(req);
  const content = b.content !== undefined ? b.content : row.content;
  const color = b.color !== undefined && COLORS.includes(b.color) ? b.color : row.color;
  const posX = Number.isFinite(b.pos_x) ? b.pos_x : row.pos_x;
  const posY = Number.isFinite(b.pos_y) ? b.pos_y : row.pos_y;
  db
    .prepare(`UPDATE sticky_notes SET content = ?, color = ?, pos_x = ?, pos_y = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(content, color, posX, posY, req.params.id);
  const note = db.prepare('SELECT * FROM sticky_notes WHERE id = ?').get(req.params.id);
  sendJson(res, 200, { note });
});

router.delete('/api/notes/:id', authenticate, async (req, res) => {
  const row = db.prepare('SELECT * FROM sticky_notes WHERE id = ?').get(req.params.id);
  if (!row) throw new HttpError(404, 'Esa nota ya no existe.');
  db.prepare('DELETE FROM sticky_notes WHERE id = ?').run(req.params.id);
  sendJson(res, 200, { ok: true });
});

export default router;
