-- Esquema de base de datos del sistema de punto de venta (POS)
PRAGMA foreign_keys = ON;

-- Usuarios del sistema (administradores, cajeros)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'cashier')) DEFAULT 'cashier',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Categorías de productos
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Productos
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE,
  barcode TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  cost_price INTEGER NOT NULL DEFAULT 0, -- centavos
  sale_price INTEGER NOT NULL DEFAULT 0, -- centavos
  tax_rate REAL NOT NULL DEFAULT 0,
  stock_qty REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'pza',
  active INTEGER NOT NULL DEFAULT 1,
  track_stock INTEGER NOT NULL DEFAULT 1,
  image_data TEXT,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Movimientos de inventario (auditoría de cambios de stock)
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('sale', 'purchase', 'adjustment', 'return', 'initial')),
  qty_change REAL NOT NULL,
  resulting_qty REAL NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reference_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Clientes
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  tax_id TEXT,
  address TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cortes / turnos de caja
CREATE TABLE IF NOT EXISTS cash_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  opening_amount INTEGER NOT NULL DEFAULT 0, -- centavos
  closing_amount INTEGER, -- centavos
  expected_amount INTEGER, -- centavos
  difference INTEGER, -- centavos
  status TEXT NOT NULL CHECK (status IN ('open', 'closed')) DEFAULT 'open',
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  notes TEXT
);

-- Ventas
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folio TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  cash_session_id INTEGER REFERENCES cash_sessions(id) ON DELETE SET NULL,
  subtotal INTEGER NOT NULL DEFAULT 0, -- centavos
  tax_total INTEGER NOT NULL DEFAULT 0, -- centavos
  discount_total INTEGER NOT NULL DEFAULT 0, -- centavos
  total INTEGER NOT NULL DEFAULT 0, -- centavos
  status TEXT NOT NULL CHECK (status IN ('completed', 'cancelled', 'refunded')) DEFAULT 'completed',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Detalle de venta (líneas de productos vendidos)
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price INTEGER NOT NULL, -- centavos
  tax_rate REAL NOT NULL DEFAULT 0,
  discount INTEGER NOT NULL DEFAULT 0, -- centavos
  line_total INTEGER NOT NULL, -- centavos
  notes TEXT
);

-- Pagos por venta (permite pagos mixtos: efectivo + tarjeta, etc.)
-- "method" es 'cash' para efectivo, o el nombre exacto de un método
-- configurado en Configuración → Ticket y venta (ej. "Tarjeta",
-- "Transferencia", "Vales") — ya no está limitado a una lista fija.
CREATE TABLE IF NOT EXISTS sale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL, -- centavos
  -- Etiqueta libre, usada solo por ventas viejas hechas con el método
  -- "Otro" de antes (ej. "Vales de despensa"); ya no se usa para ventas
  -- nuevas, pero se conserva para no perder ese detalle en el historial.
  label TEXT
);

-- Configuración general del negocio (clave/valor)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
-- Ventas puestas "en espera" para retomarlas después (F2 en el POS)
CREATE TABLE IF NOT EXISTS held_sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  customer_name TEXT,
  note TEXT,
  items_json TEXT NOT NULL,
  -- Tipo de cuenta (mesa / para llevar / a domicilio / plataforma / junta de
  -- varias cuentas), guardado como JSON: {type, label, detail}. Null =
  -- cuenta sin tipo (venta de mostrador que se dejó en espera).
  order_type_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Estado en la pantalla de cocina: NULL = todavía no se envió a cocina
  -- (es solo una cuenta guardada, ej. con "Guardar"), o 'pending' /
  -- 'preparing' / 'ready' una vez que sí se mandó con "Enviar a cocina".
  kitchen_status TEXT CHECK (kitchen_status IN ('pending', 'preparing', 'ready')),
  -- Cuándo se mandó a cocina por primera vez (para ordenar la cola por
  -- quién llegó primero y mostrar cuánto tiempo lleva esperando).
  kitchen_sent_at TEXT
);

-- Retiros y depósitos de efectivo durante un turno de caja
CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cash_session_id INTEGER NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('withdrawal', 'deposit')),
  amount INTEGER NOT NULL, -- centavos
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_held_sales_user ON held_sales(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements(cash_session_id);

-- Notas tipo "sticky note" del punto de venta (pizarrón compartido entre
-- todos los que usan la terminal, ej. "Dinero que agarran")
CREATE TABLE IF NOT EXISTS sticky_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT 'yellow',
  pos_x INTEGER NOT NULL DEFAULT 40,
  pos_y INTEGER NOT NULL DEFAULT 40,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sticky_notes_user ON sticky_notes(user_id);
