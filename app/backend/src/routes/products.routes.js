import { Router, sendJson, readJsonBody, HttpError } from '../lib/http.js';
import db from '../db/connection.js';
import { authenticate, requireRole } from '../middleware/authenticate.js';
import { toCents, fromCents } from '../lib/money.js';

const router = new Router();

function rowToProduct(row) {
  return {
    ...row,
    active: !!row.active,
    track_stock: !!row.track_stock,
    cost_price: fromCents(row.cost_price),
    sale_price: fromCents(row.sale_price),
  };
}

// Listar productos (con búsqueda opcional ?q= y filtro ?category_id=)
router.get('/api/products', authenticate, async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const q = url.searchParams.get('q');
  const categoryId = url.searchParams.get('category_id');
  const onlyActive = url.searchParams.get('active') !== 'false';

  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (onlyActive) sql += ' AND active = 1';
  if (categoryId) {
    sql += ' AND category_id = ?';
    params.push(categoryId);
  }
  if (q) {
    sql += ' AND (name LIKE ? OR sku LIKE ? OR barcode LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY name';
  const products = db.prepare(sql).all(...params).map(rowToProduct);
  sendJson(res, 200, { products });
});

router.get('/api/products/low-stock', authenticate, async (req, res) => {
  const products = db
    .prepare('SELECT * FROM products WHERE active = 1 AND track_stock = 1 AND stock_qty <= min_stock ORDER BY name')
    .all()
    .map(rowToProduct);
  sendJson(res, 200, { products });
});

router.get('/api/products/:id', authenticate, async (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) throw new HttpError(404, 'Producto no encontrado.');
  sendJson(res, 200, { product: rowToProduct(product) });
});

router.post('/api/products', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const b = await readJsonBody(req);
  if (!b.name) throw new HttpError(400, 'El nombre del producto es requerido.');
  try {
    const info = db
      .prepare(`
        INSERT INTO products (sku, barcode, name, description, category_id, cost_price, sale_price, tax_rate, stock_qty, min_stock, unit, track_stock, image_data, color)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        b.sku || null,
        b.barcode || null,
        b.name,
        b.description || null,
        b.category_id || null,
        toCents(b.cost_price),
        toCents(b.sale_price),
        Number(b.tax_rate || 0),
        Number(b.stock_qty || 0),
        Number(b.min_stock || 0),
        b.unit || 'pza',
        b.track_stock === false ? 0 : 1,
        b.image_data || null,
        b.color || null
      );
    const productId = Number(info.lastInsertRowid);
    if (Number(b.stock_qty || 0) !== 0) {
      db.prepare(
        'INSERT INTO stock_movements (product_id, type, qty_change, resulting_qty, note, user_id) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(productId, 'initial', Number(b.stock_qty || 0), Number(b.stock_qty || 0), 'Existencia inicial', req.user.id);
    }
    sendJson(res, 201, { id: productId });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'El SKU o código de barras ya existe.');
    throw err;
  }
});

router.put('/api/products/:id', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) throw new HttpError(404, 'Producto no encontrado.');
  const b = await readJsonBody(req);
  const merged = {
    sku: b.sku ?? existing.sku,
    barcode: b.barcode ?? existing.barcode,
    name: b.name ?? existing.name,
    description: b.description ?? existing.description,
    category_id: b.category_id ?? existing.category_id,
    // b.cost_price/b.sale_price llegan en pesos desde el cliente; existing
    // ya está en centavos (tal cual se guarda en la base de datos).
    cost_price: b.cost_price === undefined ? existing.cost_price : toCents(b.cost_price),
    sale_price: b.sale_price === undefined ? existing.sale_price : toCents(b.sale_price),
    tax_rate: b.tax_rate ?? existing.tax_rate,
    min_stock: b.min_stock ?? existing.min_stock,
    unit: b.unit ?? existing.unit,
    active: b.active === undefined ? existing.active : (b.active ? 1 : 0),
    track_stock: b.track_stock === undefined ? existing.track_stock : (b.track_stock ? 1 : 0),
    // A diferencia de los demás campos, `image_data` sí se puede vaciar a
    // propósito (botón "Quitar imagen"), así que un `null` explícito debe
    // borrarla — no tratarse como "no enviado" (por eso no usa `??`).
    image_data: 'image_data' in b ? b.image_data : existing.image_data,
    // Igual que `image_data`: se puede quitar a propósito (botón "Quitar
    // color"), así que un `null` explícito debe borrarlo.
    color: 'color' in b ? b.color : existing.color,
  };
  try {
    db.prepare(`
      UPDATE products SET sku=?, barcode=?, name=?, description=?, category_id=?, cost_price=?, sale_price=?,
        tax_rate=?, min_stock=?, unit=?, active=?, track_stock=?, image_data=?, color=?, updated_at=datetime('now')
      WHERE id = ?
    `).run(
      merged.sku, merged.barcode, merged.name, merged.description, merged.category_id,
      Number(merged.cost_price), Number(merged.sale_price), Number(merged.tax_rate),
      Number(merged.min_stock), merged.unit, merged.active, merged.track_stock, merged.image_data, merged.color, req.params.id
    );
    sendJson(res, 200, { ok: true });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) throw new HttpError(409, 'El SKU o código de barras ya existe.');
    throw err;
  }
});

router.delete('/api/products/:id', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  sendJson(res, 200, { ok: true });
});

// Borrado permanente (distinto de "desactivar"): quita el producto de la
// base de datos por completo. Es seguro para el historial de ventas porque
// sale_items guarda su propio nombre/precio y solo pierde la referencia
// (product_id se pone en NULL); solo se borran en cascada sus propios
// movimientos de inventario (stock_movements).
router.delete('/api/products/:id/permanent', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) throw new HttpError(404, 'Ese producto ya no existe.');
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  sendJson(res, 200, { ok: true });
});

// Ajuste manual de inventario
router.post('/api/products/:id/adjust-stock', authenticate, requireRole('admin', 'manager'), async (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) throw new HttpError(404, 'Producto no encontrado.');
  const b = await readJsonBody(req);
  const qtyChange = Number(b.qty_change);
  if (!qtyChange || Number.isNaN(qtyChange)) throw new HttpError(400, 'qty_change debe ser un número distinto de cero.');

  const newQty = product.stock_qty + qtyChange;
  db.prepare('UPDATE products SET stock_qty = ?, updated_at = datetime(\'now\') WHERE id = ?').run(newQty, product.id);
  db.prepare(
    'INSERT INTO stock_movements (product_id, type, qty_change, resulting_qty, note, user_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(product.id, 'adjustment', qtyChange, newQty, b.note || null, req.user.id);

  sendJson(res, 200, { ok: true, new_stock: newQty });
});

router.get('/api/products/:id/movements', authenticate, async (req, res) => {
  const movements = db
    .prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY created_at DESC, id DESC LIMIT 100')
    .all(req.params.id);
  sendJson(res, 200, { movements });
});

export default router;
