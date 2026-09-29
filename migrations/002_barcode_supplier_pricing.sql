-- ParUp V1.1 migration. Safe to run more than once.
-- NOTE: The Worker also creates these tables automatically on first API request.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inventory_barcodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL,
  barcode TEXT NOT NULL UNIQUE,
  is_primary INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(inventory_id) REFERENCES inventory(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_inventory_barcodes_inventory ON inventory_barcodes(inventory_id);

CREATE TABLE IF NOT EXISTS supplier_price_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier TEXT NOT NULL,
  file_name TEXT DEFAULT '',
  effective_from TEXT NOT NULL,
  effective_through TEXT,
  row_count INTEGER DEFAULT 0,
  matched_count INTEGER DEFAULT 0,
  imported_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER NOT NULL,
  supplier TEXT NOT NULL,
  inventory_id INTEGER,
  supplier_sku TEXT DEFAULT '',
  barcode TEXT DEFAULT '',
  product_name TEXT NOT NULL,
  size TEXT DEFAULT '',
  price_type TEXT NOT NULL,
  unit_price REAL NOT NULL,
  effective_from TEXT NOT NULL,
  effective_through TEXT,
  source_row_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(import_id) REFERENCES supplier_price_imports(id) ON DELETE CASCADE,
  FOREIGN KEY(inventory_id) REFERENCES inventory(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_inventory_date ON supplier_prices(inventory_id,effective_from);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_barcode ON supplier_prices(barcode);
CREATE INDEX IF NOT EXISTS idx_supplier_prices_import ON supplier_prices(import_id);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL,
  barcode TEXT DEFAULT '',
  quantity REAL NOT NULL DEFAULT 1,
  purchase_date TEXT NOT NULL,
  supplier TEXT NOT NULL,
  price_type TEXT NOT NULL,
  unit_price REAL NOT NULL,
  total_cost REAL NOT NULL,
  supplier_price_id INTEGER,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(inventory_id) REFERENCES inventory(id) ON DELETE RESTRICT,
  FOREIGN KEY(supplier_price_id) REFERENCES supplier_prices(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_purchases_inventory_date ON purchases(inventory_id,purchase_date);
