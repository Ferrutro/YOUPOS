import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// `CREATE TABLE IF NOT EXISTS` (en schema.sql) no hace nada si la tabla ya
// existe, así que agregar una columna nueva a una tabla que ya existía (por
// ejemplo, en la instalación real del usuario) requiere un ALTER TABLE
// aparte. Esta función es segura de correr siempre: si la columna ya existe
// (instalación nueva, donde schema.sql ya la trae) no hace nada.
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Instalaciones ya existentes crearon `sale_payments.method` con una
// restricción CHECK fija a 4 valores ('cash', 'card', 'transfer', 'other').
// Ahora los métodos de pago (aparte de "Efectivo") se agregan y quitan
// libremente desde Configuración, así que esa restricción ya no debe
// existir. SQLite no permite quitar un CHECK con ALTER TABLE, así que se
// reconstruye la tabla completa (patrón estándar de SQLite para esto),
// conservando todos los pagos ya registrados. Es segura de correr siempre:
// si la tabla ya está en el formato nuevo, no hace nada.
function migrateSalePaymentsCheckConstraint() {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sale_payments'").get();
  if (!row || !row.sql || !row.sql.includes('CHECK')) return;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('ALTER TABLE sale_payments RENAME TO sale_payments_old');
    db.exec(`
      CREATE TABLE sale_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        method TEXT NOT NULL,
        amount INTEGER NOT NULL,
        label TEXT
      )
    `);
    const oldCols = db.prepare('PRAGMA table_info(sale_payments_old)').all().map((c) => c.name);
    const insertSql = oldCols.includes('label')
      ? 'INSERT INTO sale_payments (id, sale_id, method, amount, label) SELECT id, sale_id, method, amount, label FROM sale_payments_old'
      : 'INSERT INTO sale_payments (id, sale_id, method, amount) SELECT id, sale_id, method, amount FROM sale_payments_old';
    db.exec(insertSql);
    db.exec('DROP TABLE sale_payments_old');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Todas las columnas de dinero se guardaban como pesos con decimales
// (REAL), lo que acumulaba errores de redondeo de punto flotante en sumas
// (ej. el efectivo esperado en un corte de caja quedando en -$0.02). Ahora
// se guardan como centavos enteros. Esta función convierte una sola vez los
// datos ya existentes (pesos -> centavos); en una instalación nueva las
// tablas están vacías y solo deja la marca para que nunca se vuelva a
// correr (si no, los montos ya insertados en centavos por el propio
// backend se multiplicarían por 100 otra vez).
function migrateMoneyToCents() {
  const marker = db.prepare("SELECT value FROM settings WHERE key = '_money_cents_migrated'").get();
  if (marker && marker.value === '1') return;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`UPDATE products SET cost_price = ROUND(cost_price * 100), sale_price = ROUND(sale_price * 100)`);
    db.exec(`
      UPDATE cash_sessions SET
        opening_amount = ROUND(opening_amount * 100),
        closing_amount = CASE WHEN closing_amount IS NULL THEN NULL ELSE ROUND(closing_amount * 100) END,
        expected_amount = CASE WHEN expected_amount IS NULL THEN NULL ELSE ROUND(expected_amount * 100) END,
        difference = CASE WHEN difference IS NULL THEN NULL ELSE ROUND(difference * 100) END
    `);
    db.exec(`
      UPDATE sales SET
        subtotal = ROUND(subtotal * 100), tax_total = ROUND(tax_total * 100),
        discount_total = ROUND(discount_total * 100), total = ROUND(total * 100)
    `);
    db.exec(`
      UPDATE sale_items SET
        unit_price = ROUND(unit_price * 100), discount = ROUND(discount * 100), line_total = ROUND(line_total * 100)
    `);
    db.exec(`UPDATE sale_payments SET amount = ROUND(amount * 100)`);
    db.exec(`UPDATE cash_movements SET amount = ROUND(amount * 100)`);
    db.exec(`
      INSERT INTO settings (key, value) VALUES ('_money_cents_migrated', '1')
      ON CONFLICT(key) DO UPDATE SET value = '1'
    `);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  addColumnIfMissing('products', 'image_data', 'TEXT');
  addColumnIfMissing('products', 'color', 'TEXT');
  addColumnIfMissing('categories', 'color', 'TEXT');
  addColumnIfMissing('sale_items', 'notes', 'TEXT');
  addColumnIfMissing('held_sales', 'order_type_json', 'TEXT');
  // Etiqueta libre, usada solo por ventas viejas con el método "Otro" de
  // antes (ej. "Vales de despensa"); se conserva por si ya la usaste.
  addColumnIfMissing('sale_payments', 'label', 'TEXT');
  migrateSalePaymentsCheckConstraint();
  migrateMoneyToCents();
  console.log('Migración aplicada correctamente.');
}

// Permite ejecutar `node src/db/migrate.js` directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
}
