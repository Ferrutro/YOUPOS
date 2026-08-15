import { Router, sendJson, readJsonBody, HttpError } from '../lib/http.js';
import db from '../db/connection.js';
import { authenticate } from '../middleware/authenticate.js';
import { toCents, fromCents } from '../lib/money.js';

const router = new Router();

function sessionToPesos(session) {
  if (!session) return session;
  return {
    ...session,
    opening_amount: fromCents(session.opening_amount),
    closing_amount: fromCents(session.closing_amount),
    expected_amount: fromCents(session.expected_amount),
    difference: fromCents(session.difference),
  };
}

function summaryToPesos(summary) {
  return {
    opening_amount: fromCents(summary.opening_amount),
    cash_collections: fromCents(summary.cash_collections),
    cash_refunds: fromCents(summary.cash_refunds),
    deposited: fromCents(summary.deposited),
    paid_out: fromCents(summary.paid_out),
    theoretical_cash: fromCents(summary.theoretical_cash),
    gross_sales: fromCents(summary.gross_sales),
    refunds: fromCents(summary.refunds),
    discounts: fromCents(summary.discounts),
    net_sales: fromCents(summary.net_sales),
  };
}

// Calcula el resumen de un turno (cajón de efectivo + resumen de ventas) en
// vivo, sin necesidad de cerrarlo. Se usa tanto para la pantalla de "Turno"
// mientras sigue abierto como, con los mismos números, al cerrarlo — así el
// efectivo teórico que se ve antes de cerrar coincide con el que se calcula
// al cerrar. Todos los montos, tanto los de entrada (session.opening_amount)
// como los del resultado, están en centavos — la conversión a pesos ocurre
// en las respuestas de la API (summaryToPesos).
function computeSessionSummary(session) {
  const cashCollections = db
    .prepare(`
      SELECT COALESCE(SUM(sp.amount), 0) AS total
      FROM sale_payments sp
      JOIN sales s ON s.id = sp.sale_id
      WHERE s.cash_session_id = ? AND sp.method = 'cash' AND s.status = 'completed'
    `)
    .get(session.id).total;

  const cashRefunds = db
    .prepare(`
      SELECT COALESCE(SUM(sp.amount), 0) AS total
      FROM sale_payments sp
      JOIN sales s ON s.id = sp.sale_id
      WHERE s.cash_session_id = ? AND sp.method = 'cash' AND s.status IN ('cancelled', 'refunded')
    `)
    .get(session.id).total;

  const movements = db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'deposit' THEN amount ELSE 0 END), 0) AS deposits,
        COALESCE(SUM(CASE WHEN type = 'withdrawal' THEN amount ELSE 0 END), 0) AS withdrawals
      FROM cash_movements WHERE cash_session_id = ?
    `)
    .get(session.id);

  const salesTotals = db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'completed' THEN subtotal + discount_total ELSE 0 END), 0) AS gross_completed,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN discount_total ELSE 0 END), 0) AS discounts,
        COALESCE(SUM(CASE WHEN status IN ('cancelled', 'refunded') THEN subtotal + discount_total ELSE 0 END), 0) AS refunds
      FROM sales WHERE cash_session_id = ?
    `)
    .get(session.id);

  const theoreticalCash = session.opening_amount + cashCollections - cashRefunds + movements.deposits - movements.withdrawals;
  const netSales = salesTotals.gross_completed - salesTotals.refunds - salesTotals.discounts;

  return {
    opening_amount: session.opening_amount,
    cash_collections: cashCollections,
    cash_refunds: cashRefunds,
    deposited: movements.deposits,
    paid_out: movements.withdrawals,
    theoretical_cash: theoreticalCash,
    gross_sales: salesTotals.gross_completed,
    refunds: salesTotals.refunds,
    discounts: salesTotals.discounts,
    net_sales: netSales,
  };
}

// Turno de caja abierto actualmente para el usuario en sesión
router.get('/api/cash-sessions/current', authenticate, async (req, res) => {
  const session = db
    .prepare("SELECT * FROM cash_sessions WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
    .get(req.user.id);
  sendJson(res, 200, { session: sessionToPesos(session) });
});

// Resumen en vivo del turno (cajón de efectivo + ventas), sin cerrarlo.
router.get('/api/cash-sessions/:id/summary', authenticate, async (req, res) => {
  const session = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(req.params.id);
  if (!session) throw new HttpError(404, 'Turno no encontrado.');
  sendJson(res, 200, { summary: summaryToPesos(computeSessionSummary(session)) });
});

router.get('/api/cash-sessions', authenticate, async (req, res) => {
  const sessions = db
    .prepare(`
      SELECT cs.*, u.name AS user_name FROM cash_sessions cs
      JOIN users u ON u.id = cs.user_id
      ORDER BY cs.id DESC LIMIT 200
    `)
    .all()
    .map(sessionToPesos);
  sendJson(res, 200, { sessions });
});

router.post('/api/cash-sessions/open', authenticate, async (req, res) => {
  const open = db
    .prepare("SELECT * FROM cash_sessions WHERE user_id = ? AND status = 'open'")
    .get(req.user.id);
  if (open) throw new HttpError(409, 'Ya tienes un turno de caja abierto.');
  const b = await readJsonBody(req);
  const info = db
    .prepare('INSERT INTO cash_sessions (user_id, opening_amount) VALUES (?, ?)')
    .run(req.user.id, toCents(b.opening_amount));
  sendJson(res, 201, { id: Number(info.lastInsertRowid) });
});

router.post('/api/cash-sessions/:id/close', authenticate, async (req, res) => {
  const session = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(req.params.id);
  if (!session) throw new HttpError(404, 'Turno no encontrado.');
  if (session.status === 'closed') throw new HttpError(409, 'Ese turno ya está cerrado.');
  if (session.user_id !== req.user.id && req.user.role === 'cashier') {
    throw new HttpError(403, 'No puedes cerrar el turno de otro cajero.');
  }
  const b = await readJsonBody(req);

  const summary = computeSessionSummary(session);
  const expectedCents = summary.theoretical_cash;
  const closingAmountCents = toCents(b.closing_amount);
  const differenceCents = closingAmountCents - expectedCents;

  db.prepare(`
    UPDATE cash_sessions SET status='closed', closing_amount=?, expected_amount=?, difference=?, closed_at=datetime('now'), notes=?
    WHERE id = ?
  `).run(closingAmountCents, expectedCents, differenceCents, b.notes || null, session.id);

  sendJson(res, 200, {
    ok: true,
    expected_amount: fromCents(expectedCents),
    difference: fromCents(differenceCents),
    summary: summaryToPesos(summary),
  });
});

// Retiros y depósitos de efectivo durante un turno abierto (p. ej. para
// enviar dinero a la bóveda o meter cambio extra al cajón).
router.get('/api/cash-sessions/:id/movements', authenticate, async (req, res) => {
  const movements = db
    .prepare(`
      SELECT cm.*, u.name AS user_name FROM cash_movements cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.cash_session_id = ?
      ORDER BY cm.id DESC
    `)
    .all(req.params.id)
    .map((m) => ({ ...m, amount: fromCents(m.amount) }));
  sendJson(res, 200, { movements });
});

router.post('/api/cash-sessions/:id/movements', authenticate, async (req, res) => {
  const session = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(req.params.id);
  if (!session) throw new HttpError(404, 'Turno no encontrado.');
  if (session.status !== 'open') throw new HttpError(409, 'Ese turno ya está cerrado.');

  const b = await readJsonBody(req);
  if (!['withdrawal', 'deposit'].includes(b.type)) {
    throw new HttpError(400, 'Tipo de movimiento inválido (debe ser "withdrawal" o "deposit").');
  }
  const amount = Number(b.amount);
  if (!amount || amount <= 0) throw new HttpError(400, 'El monto debe ser mayor a cero.');

  const info = db
    .prepare('INSERT INTO cash_movements (cash_session_id, user_id, type, amount, note) VALUES (?, ?, ?, ?, ?)')
    .run(session.id, req.user.id, b.type, toCents(amount), b.note || null);

  sendJson(res, 201, { id: Number(info.lastInsertRowid) });
});

export default router;
