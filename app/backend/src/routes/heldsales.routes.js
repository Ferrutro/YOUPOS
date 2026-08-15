import { Router, sendJson, readJsonBody, HttpError } from '../lib/http.js';
import db from '../db/connection.js';
import { authenticate } from '../middleware/authenticate.js';

const router = new Router();

// Ventas puestas "en espera" (F2 en el POS) para retomarlas más tarde.
// ?kitchen=1 devuelve solo las que sí se mandaron a cocina (kitchen_status
// no nulo), en orden de llegada (la más vieja primero) — es lo que consume
// la pantalla de cocina.
router.get('/api/held-sales', authenticate, async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const kitchenOnly = url.searchParams.get('kitchen') === '1';
  const rows = kitchenOnly
    ? db
        .prepare(`
          SELECT hs.*, u.name AS user_name
          FROM held_sales hs
          JOIN users u ON u.id = hs.user_id
          WHERE hs.kitchen_status IS NOT NULL
          ORDER BY hs.kitchen_sent_at ASC
        `)
        .all()
    : db
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

// Manda (o vuelve a mandar) una cuenta a la pantalla de cocina. La primera
// vez guarda `kitchen_sent_at` (para el orden de la cola); si ya se había
// mandado antes, no lo pisa — así la cola respeta cuándo llegó originalmente
// aunque se le agreguen artículos después. El estado siempre vuelve a
// 'pending', porque un reenvío casi siempre es "hay algo nuevo que preparar".
router.post('/api/held-sales/:id/send-to-kitchen', authenticate, async (req, res) => {
  const row = db.prepare('SELECT * FROM held_sales WHERE id = ?').get(req.params.id);
  if (!row) throw new HttpError(404, 'Esa cuenta ya no existe.');
  db.prepare(`
    UPDATE held_sales SET kitchen_status = 'pending', kitchen_sent_at = COALESCE(kitchen_sent_at, datetime('now'))
    WHERE id = ?
  `).run(req.params.id);
  sendJson(res, 200, { ok: true });
});

// Avanza el estado en la pantalla de cocina (pending -> preparing -> ready).
// `status: null` es "ya se entregó" — quita la cuenta de la pantalla de
// cocina sin tocar la cuenta en sí (sigue disponible para cobrarla).
router.post('/api/held-sales/:id/kitchen-status', authenticate, async (req, res) => {
  const row = db.prepare('SELECT * FROM held_sales WHERE id = ?').get(req.params.id);
  if (!row) throw new HttpError(404, 'Esa cuenta ya no existe.');
  const b = await readJsonBody(req);
  if (![null, 'pending', 'preparing', 'ready'].includes(b.status)) {
    throw new HttpError(400, 'Estado de cocina inválido.');
  }
  db.prepare('UPDATE held_sales SET kitchen_status = ? WHERE id = ?').run(b.status, req.params.id);
  sendJson(res, 200, { ok: true });
});

router.delete('/api/held-sales/:id', authenticate, async (req, res) => {
  const row = db.prepare('SELECT * FROM held_sales WHERE id = ?').get(req.params.id);
  if (!row) throw new HttpError(404, 'Esa venta en espera ya no existe.');
  db.prepare('DELETE FROM held_sales WHERE id = ?').run(req.params.id);
  sendJson(res, 200, { ok: true });
});

export default router;
