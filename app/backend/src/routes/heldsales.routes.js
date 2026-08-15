import { Router, sendJson, readJsonBody, HttpError } from '../lib/http.js';
import db from '../db/connection.js';
import { authenticate } from '../middleware/authenticate.js';

const router = new Router();

// Ventas puestas "en espera" (F2 en el POS) para retomarlas más tarde.
router.get('/api/held-sales', authenticate, async (req, res) => {
  const rows = db
    .prepare(`
      SELECT hs.*, u.name AS user_name
      FROM held_sales hs
      JOIN users u ON u.id = hs.user_id
      ORDER BY hs.id DESC
      LIMIT 100
    `)
    .all();
  const heldSales = rows.map((r) => {
    let items = [];
    try { items = JSON.parse(r.items_json); } catch { items = []; }
    let order_type = null;
    if (r.order_type_json) {
      try { order_type = JSON.parse(r.order_type_json); } catch { order_type = null; }
    }
    return { ...r, items, order_type };
  });
  sendJson(res, 200, { heldSales });
});

router.post('/api/held-sales', authenticate, async (req, res) => {
  const b = await readJsonBody(req);
  const items = Array.isArray(b.items) ? b.items : [];
  // Una cuenta (mesa/para llevar/etc.) se puede dejar abierta aunque todavía
  // no tenga artículos — p. ej. se abre la mesa apenas se sientan los
  // clientes, antes de que pidan algo. Solo se rechaza si no hay ni
  // artículos NI un tipo de cuenta que la identifique.
  if (items.length === 0 && !b.order_type) {
    throw new HttpError(400, 'El ticket está vacío, no hay nada que poner en espera.');
  }
  const orderTypeJson = b.order_type ? JSON.stringify(b.order_type) : null;
  const info = db
    .prepare(`
      INSERT INTO held_sales (user_id, customer_id, customer_name, note, items_json, order_type_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(req.user.id, b.customer_id || null, b.customer_name || null, b.note || null, JSON.stringify(items), orderTypeJson);
  sendJson(res, 201, { id: Number(info.lastInsertRowid) });
});

// Actualiza una cuenta abierta que ya existe (p. ej. el botón "Guardar" del
// POS, o al cambiar a otra cuenta dejando ésta guardada) — conserva el mismo
// id durante toda la vida de la cuenta, en vez de borrar y volver a crear.
router.put('/api/held-sales/:id', authenticate, async (req, res) => {
  const row = db.prepare('SELECT * FROM held_sales WHERE id = ?').get(req.params.id);
  if (!row) throw new HttpError(404, 'Esa cuenta ya no existe.');
  const b = await readJsonBody(req);
  const items = Array.isArray(b.items) ? b.items : [];
  const orderTypeJson = b.order_type ? JSON.stringify(b.order_type) : null;
  db.prepare(`
    UPDATE held_sales SET customer_id = ?, customer_name = ?, note = ?, items_json = ?, order_type_json = ?
    WHERE id = ?
  `).run(b.customer_id || null, b.customer_name || null, b.note || null, JSON.stringify(items), orderTypeJson, req.params.id);
  sendJson(res, 200, { ok: true });
});

router.delete('/api/held-sales/:id', authenticate, async (req, res) => {
  const row = db.prepare('SELECT * FROM held_sales WHERE id = ?').get(req.params.id);
  if (!row) throw new HttpError(404, 'Esa venta en espera ya no existe.');
  db.prepare('DELETE FROM held_sales WHERE id = ?').run(req.params.id);
  sendJson(res, 200, { ok: true });
});

export default router;
