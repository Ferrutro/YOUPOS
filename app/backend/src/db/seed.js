import { db } from './connection.js';
import { migrate } from './migrate.js';
import { hashPassword } from '../lib/auth.js';
import { toCents } from '../lib/money.js';

function seed() {
  migrate();

  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    db.prepare(
      'INSERT INTO users (name, username, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run('Administrador', 'admin', hashPassword('admin123'), 'admin');
    console.log('Usuario admin creado -> usuario: admin / contraseña: admin123 (cámbiala después de iniciar sesión)');
  }

  const settingsDefaults = {
    business_name: 'Mi Negocio',
    currency: 'MXN',
    default_tax_rate: '0',
    address: '',
    phone: '',
    receipt_footer: 'Gracias por su compra',
    // Métodos de pago adicionales a "Efectivo" (que siempre está fijo, por
    // su calculadora de cambio). El administrador los agrega/quita desde
    // Configuración → Ticket y venta. Cada uno puede traer su propio % de
    // recargo (ej. tarjeta de crédito), para que el cobro le diga al
    // cajero cuánto marcar en la terminal.
    payment_methods: JSON.stringify([
      { name: 'Tarjeta', surchargePct: 0 },
      { name: 'Transferencia', surchargePct: 0 },
    ]),
  };
  const upsertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
  );
  for (const [key, value] of Object.entries(settingsDefaults)) {
    upsertSetting.run(key, value);
  }

  const catCount = db.prepare('SELECT COUNT(*) AS c FROM categories').get().c;
  if (catCount === 0) {
    const insertCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
    const demoCategories = ['General', 'Bebidas', 'Abarrotes', 'Snacks'];
    const catIds = {};
    for (const name of demoCategories) {
      const info = insertCat.run(name);
      catIds[name] = info.lastInsertRowid;
    }

    const insertProduct = db.prepare(`
      INSERT INTO products (sku, barcode, name, category_id, cost_price, sale_price, tax_rate, stock_qty, min_stock, unit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const demoProducts = [
      ['SKU-0001', '7501000000011', 'Refresco 600ml', catIds['Bebidas'], 8, 15, 0, 50, 10, 'pza'],
      ['SKU-0002', '7501000000028', 'Agua 1L', catIds['Bebidas'], 5, 10, 0, 80, 15, 'pza'],
      ['SKU-0003', '7501000000035', 'Arroz 1kg', catIds['Abarrotes'], 18, 28, 0, 40, 5, 'pza'],
      ['SKU-0004', '7501000000042', 'Frijol 1kg', catIds['Abarrotes'], 20, 30, 0, 35, 5, 'pza'],
      ['SKU-0005', '7501000000059', 'Papas fritas', catIds['Snacks'], 10, 18, 0, 60, 10, 'pza'],
    ];
    for (const p of demoProducts) {
      // cost_price y sale_price (índices 4 y 5) se guardan en centavos.
      const row = [...p];
      row[4] = toCents(row[4]);
      row[5] = toCents(row[5]);
      insertProduct.run(...row);
      const productId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
      db.prepare(
        'INSERT INTO stock_movements (product_id, type, qty_change, resulting_qty, note) VALUES (?, ?, ?, ?, ?)'
      ).run(productId, 'initial', p[7], p[7], 'Existencia inicial (demo)');
    }
    console.log('Categorías y productos de ejemplo creados.');
  }

  console.log('Seed completado.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed();
}

export { seed };
