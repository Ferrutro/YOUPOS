import { Router, sendJson, readJsonBody, HttpError } from '../lib/http.js';
import db from '../db/connection.js';
import { authenticate, requireRole } from '../middleware/authenticate.js';
import { toCents, fromCents } from '../lib/money.js';

const router = new Router();

// Convierte los campos de dinero (guardados en centavos) a pesos para las
// respuestas de la API. No muta la fila original.
function saleToPesos(sale) {
  return {
    ...sale,
    subtotal: fromCents(sale.subtotal),
    tax_total: fromCents(sale.tax_total),
    discount_total: fromCents(sale.discount_total),
    total: fromCents(sale.total),
  };
}

function itemToPesos(item) {
  return { ...item, unit_price: fromCents(item.unit_price), discount: fromCents(item.discount), line_total: fromCents(item.line_total) };
}

function paymentToPesos(payment) {
  return { ...payment, amount: fromCents(payment.amount) };
}

function generateFolio() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 90000 + 10000);
  return `V-${y}${m}${d}-${rand}`;
}

// Listar ventas (con filtros de fecha ?from=&to=)
router.get('/api/sales', authenticate, async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  let sql = `
    SELECT s.*, u.name AS user_name, c.name AS customer_name
    FROM sales s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN customers c ON c.id = s.customer_id
    WHERE 1=1
  `;
  const params = [];
  if (from) { sql += ' AND s.created_at >= ?'; params.push(from); }
  if (to) { sql += ' AND s.created_at <= ?'; params.push(to); }
  sql += ' ORDER BY s.id DESC LIMIT 500';
  const sales = db.prepare(sql).all(...params).map(saleToPesos);
  sendJson(res, 200, { sales });
});

router.get('/api/sales/:id', authenticate, async (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) throw new HttpError(404, 'Venta no encontrada.');
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id).map(itemToPesos);
  const payments = db.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').all(sale.id).map(paymentToPesos);
  sendJson(res, 200, { sale: saleToPesos(sale), items, payments });
});

// Crear una venta (checkout del POS)
router.post('/api/sales', authenticate, async (req, res) => {
  const b = await readJsonBody(req);
  const items = Array.isArray(b.items) ? b.items : [];
  const payments = Array.isArray(b.payments) ? b.payments : [];

  if (items.length === 0) throw new HttpError(400, 'La venta debe tener al menos un producto.');
  if (payments.length === 0) throw new HttpError(400, 'La venta debe tener al menos un método de pago.');

  const cashSession = db
    .prepare("SELECT * FROM cash_sessions WHERE user_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
    .get(req.user.id);

  // Calcular totales en el servidor (nunca confiar en los totales del
  // cliente). Todo el cálculo ocurre en centavos enteros para que no se
  // acumulen errores de redondeo de punto flotante.
  let subtotalCents = 0;
  let taxTotalCents = 0;
  let discountTotalCents = 0;
  const resolvedItems = [];

  for (const it of items) {
    const qty = Number(it.quantity);
    if (!qty || qty <= 0) throw new HttpError(400, 'Cantidad inválida en un producto.');
    let unitPriceCents, taxRate, productName, productId = null;

    if (it.product_id) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
      if (!product) throw new HttpError(404, `Producto ${it.product_id} no encontrado.`);
      if (product.track_stock && product.stock_qty < qty) {
        throw new HttpError(409, `Stock insuficiente para "${product.name}" (disponible: ${product.stock_qty}).`);
      }
      unitPriceCents = product.sale_price; // ya está en centavos
      taxRate = product.tax_rate;
      productName = product.name;
      productId = product.id;
    } else {
      // Línea libre (producto no catalogado)
      unitPriceCents = toCents(it.unit_price);
      taxRate = Number(it.tax_rate || 0);
      productName = it.product_name || 'Producto';
    }

    const discountCents = toCents(it.discount);
    const lineSubtotalCents = Math.round(unitPriceCents * qty) - discountCents;
    const lineTaxCents = Math.round(lineSubtotalCents * (taxRate / 100));
    const lineTotalCents = lineSubtotalCents + lineTaxCents;

    subtotalCents += lineSubtotalCents;
    taxTotalCents += lineTaxCents;
    discountTotalCents += discountCents;

    const notes = it.notes ? String(it.notes).slice(0, 500) : null;

    resolvedItems.push({
      productId, productName, qty, notes,
      unitPrice: unitPriceCents, taxRate, discount: discountCents, lineTotal: lineTotalCents,
    });
  }

  const totalCents = subtotalCents + taxTotalCents;
  const paymentsTotalCents = payments.reduce((sum, p) => sum + toCents(p.amount), 0);
  if (Math.abs(paymentsTotalCents - totalCents) > 1) {
    throw new HttpError(
      400,
      `El total pagado (${fromCents(paymentsTotalCents).toFixed(2)}) no coincide con el total de la venta (${fromCents(totalCents).toFixed(2)}).`
    );
  }

  const folio = generateFolio();

  db.exec('BEGIN IMMEDIATE');
  try {
    const saleInfo = db
      .prepare(`
        INSERT INTO sales (folio, user_id, customer_id, cash_session_id, subtotal, tax_total, discount_total, total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(folio, req.user.id, b.customer_id || null, cashSession ? cashSession.id : null, subtotalCents, taxTotalCents, discountTotalCents, totalCents);
    const saleId = Number(saleInfo.lastInsertRowid);

    const insertItem = db.prepare(`
      INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, tax_rate, discount, line_total, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const ri of resolvedItems) {
      insertItem.run(saleId, ri.productId, ri.productName, ri.qty, ri.unitPrice, ri.taxRate, ri.discount, ri.lineTotal, ri.notes);

      if (ri.productId) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(ri.productId);
        if (product.track_stock) {
          const newQty = product.stock_qty - ri.qty;
          db.prepare("UPDATE products SET stock_qty = ? WHERE id = ?").run(newQty, product.id);
          db.prepare(
            "INSERT INTO stock_movements (product_id, type, qty_change, resulting_qty, note, user_id, reference_id) VALUES (?, 'sale', ?, ?, ?, ?, ?)"
          ).run(product.id, -ri.qty, newQty, `Venta ${folio}`, req.user.id, saleId);
        }
      }
    }

    // El método de pago es 'cash' para efectivo, o el nombre exacto de un
    // método configurado en Configuración → Ticket y venta (ej. "Tarjeta",
    // "Transferencia", "Vales") — ya no está limitado a una lista fija.
    const insertPayment = db.prepare('INSERT INTO sale_payments (sale_id, method, amount, label) VALUES (?, ?, ?, ?)');
    for (const p of payments) {
      const method = String(p.method || '').trim().slice(0, 40);
      if (!method) throw new HttpError(400, 'Cada pago debe indicar un método de pago.');
      if (!(Number(p.amount) > 0)) throw new HttpError(400, `Monto inválido para el pago "${method}".`);
      const label = p.label ? String(p.label).trim().slice(0, 80) : null;
      insertPayment.run(saleId, method, toCents(p.amount), label || null);
    }

    db.exec('COMMIT');
    sendJson(res, 201, {
      id: saleId, folio,
      total: fromCents(totalCents), subtotal: fromCents(subtotalCents),
      tax_total: fromCents(taxTotalCents), discount_total: fromCents(discountTotalCents),
    });
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
});

// Cancelar / devolver una venta (restaura inventario)
router.post('/api/sales/:id/cancel', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(req.params.id);
  if (!sale) throw new HttpError(404, 'Venta no encontrada.');
  if (sale.status !== 'completed') throw new HttpError(409, 'Esta venta ya fue cancelada o reembolsada.');

  db.exec('BEGIN IMMEDIATE');
  try {
    const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
    for (const item of items) {
      if (item.product_id) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id);
        if (product && product.track_stock) {
          const newQty = product.stock_qty + item.quantity;
          db.prepare('UPDATE products SET stock_qty = ? WHERE id = ?').run(newQty, product.id);
          db.prepare(
            "INSERT INTO stock_movements (product_id, type, qty_change, resulting_qty, note, user_id, reference_id) VALUES (?, 'return', ?, ?, ?, ?, ?)"
          ).run(product.id, item.quantity, newQty, `Cancelación venta ${sale.folio}`, req.user.id, sale.id);
        }
      }
    }
    db.prepare("UPDATE sales SET status = 'cancelled' WHERE id = ?").run(sale.id);
    db.exec('COMMIT');
    sendJson(res, 200, { ok: true });
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
});

export default router;
