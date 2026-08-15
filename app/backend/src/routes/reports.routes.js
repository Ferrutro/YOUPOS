import { Router, sendJson } from '../lib/http.js';
import db from '../db/connection.js';
import { authenticate, requireRole } from '../middleware/authenticate.js';
import { fromCents } from '../lib/money.js';

const router = new Router();

function dateRange(url) {
  const from = url.searchParams.get('from') || '1970-01-01';
  const to = url.searchParams.get('to') || '2999-12-31 23:59:59';
  return { from, to };
}

// Resumen general del dashboard
router.get('/api/reports/summary', authenticate, async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { from, to } = dateRange(url);

  const salesSummary = db
    .prepare(`
      SELECT COUNT(*) AS sales_count, COALESCE(SUM(total), 0) AS total_revenue,
             COALESCE(SUM(tax_total), 0) AS total_tax, COALESCE(SUM(discount_total), 0) AS total_discount
      FROM sales WHERE status = 'completed' AND created_at BETWEEN ? AND ?
    `)
    .get(from, to);

  const profit = db
    .prepare(`
      SELECT COALESCE(SUM((si.unit_price - COALESCE(p.cost_price, 0)) * si.quantity - si.discount), 0) AS gross_profit
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      LEFT JOIN products p ON p.id = si.product_id
      WHERE s.status = 'completed' AND s.created_at BETWEEN ? AND ?
    `)
    .get(from, to);

  const lowStockCount = db
    .prepare('SELECT COUNT(*) AS c FROM products WHERE active = 1 AND track_stock = 1 AND stock_qty <= min_stock')
    .get().c;

  const paymentBreakdown = db
    .prepare(`
      SELECT sp.method, COALESCE(SUM(sp.amount), 0) AS total
      FROM sale_payments sp
      JOIN sales s ON s.id = sp.sale_id
      WHERE s.status = 'completed' AND s.created_at BETWEEN ? AND ?
      GROUP BY sp.method
    `)
    .all(from, to);

  sendJson(res, 200, {
    sales_count: salesSummary.sales_count,
    total_revenue: fromCents(salesSummary.total_revenue),
    total_tax: fromCents(salesSummary.total_tax),
    total_discount: fromCents(salesSummary.total_discount),
    gross_profit: fromCents(profit.gross_profit),
    low_stock_count: lowStockCount,
    payment_breakdown: paymentBreakdown.map((row) => ({ ...row, total: fromCents(row.total) })),
  });
});

// Ventas agrupadas por día
router.get('/api/reports/sales-by-day', authenticate, async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { from, to } = dateRange(url);
  const rows = db
    .prepare(`
      SELECT date(created_at) AS day, COUNT(*) AS sales_count, COALESCE(SUM(total), 0) AS total
      FROM sales
      WHERE status = 'completed' AND created_at BETWEEN ? AND ?
      GROUP BY date(created_at)
      ORDER BY day
    `)
    .all(from, to)
    .map((row) => ({ ...row, total: fromCents(row.total) }));
  sendJson(res, 200, { rows });
});

// Productos más vendidos
router.get('/api/reports/top-products', authenticate, async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { from, to } = dateRange(url);
  const limit = Number(url.searchParams.get('limit') || 10);
  const rows = db
    .prepare(`
      SELECT si.product_name, COALESCE(si.product_id, 0) AS product_id,
             SUM(si.quantity) AS total_qty, SUM(si.line_total) AS total_revenue
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.status = 'completed' AND s.created_at BETWEEN ? AND ?
      GROUP BY si.product_name, si.product_id
      ORDER BY total_qty DESC
      LIMIT ?
    `)
    .all(from, to, limit)
    .map((row) => ({ ...row, total_revenue: fromCents(row.total_revenue) }));
  sendJson(res, 200, { rows });
});

// Ventas por método de pago
router.get('/api/reports/payments', authenticate, async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { from, to } = dateRange(url);
  const rows = db
    .prepare(`
      SELECT sp.method, COALESCE(SUM(sp.amount), 0) AS total, COUNT(*) AS count
      FROM sale_payments sp
      JOIN sales s ON s.id = sp.sale_id
      WHERE s.status = 'completed' AND s.created_at BETWEEN ? AND ?
      GROUP BY sp.method
    `)
    .all(from, to)
    .map((row) => ({ ...row, total: fromCents(row.total) }));
  sendJson(res, 200, { rows });
});

// Ventas por cajero
router.get('/api/reports/sales-by-user', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const { from, to } = dateRange(url);
  const rows = db
    .prepare(`
      SELECT u.name AS user_name, COUNT(*) AS sales_count, COALESCE(SUM(s.total), 0) AS total
      FROM sales s
      JOIN users u ON u.id = s.user_id
      WHERE s.status = 'completed' AND s.created_at BETWEEN ? AND ?
      GROUP BY u.id
      ORDER BY total DESC
    `)
    .all(from, to)
    .map((row) => ({ ...row, total: fromCents(row.total) }));
  sendJson(res, 200, { rows });
});

export default router;
