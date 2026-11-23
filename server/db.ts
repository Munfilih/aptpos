import fs from 'fs';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import initSqlJs, { Database } from 'sql.js';
import type {
  Customer,
  CashbookEntry,
  CashbookOpeningBalance,
  CashierShift,
  CreateCashbookEntryInput,
  AppComponentId,
  InventoryOption,
  InventoryOptionType,
  ProductAdditionalBarcode,
  CreateSaleReturnInput,
  PaymentMethod,
  PrintJob,
  Product,
  ProductCategory,
  ProductMultiUnit,
  RegistrationRequest,
  RegistrationRequestStatus,
  RegistrationRequestType,
  PurchaseReturnVoucher,
  PurchaseReturnItem,
  PurchaseEntry,
  PurchaseItem,
  CreatePurchaseReturnInput,
  Sale,
  SaleItem,
  SalesReturnVoucher,
  CreateSalesReturnVoucherInput,
  StoreSettings,
  UserAccount,
  UserSession,
  Vendor,
} from '../src/types/pos';
import { APP_COMPONENTS, APP_VERSIONS } from '../src/types/pos';
import { parseVersionComponentPolicies } from '../src/utils/versionComponentPolicies';
import { calculateSaleReturnRefund } from '../src/utils/saleReturns';
import { calculateSalesTax } from '../src/utils/salesTax';
import { getKotNumberFromInvoice } from '../src/utils/documentNumbers';

const DATA_DIR = process.env.POS_DATA_DIR || path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'pos.sqlite');

let db: Database | null = null;
let cachedHardwareSystemIdentity: { fingerprint: string; systemCode: string } | null = null;

function saveDatabase(): void {
  if (!db) return;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export async function getDb(): Promise<Database> {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // If the target DB doesn't exist, try copying from template if available
  if (!fs.existsSync(DB_PATH)) {
    const templateCandidates = [
      process.env.POS_TEMPLATE_DB,
      path.resolve(process.cwd(), 'data', 'pos.sqlite'),
    ].filter(Boolean) as string[];

    for (const tpl of templateCandidates) {
      if (fs.existsSync(tpl) && tpl !== DB_PATH) {
        try {
          fs.copyFileSync(tpl, DB_PATH);
          break;
        } catch {
          // Continue to fallback
        }
      }
    }
  }

  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  initSchema(db);
  seedInitialData(db);
  seedInventoryOptions(db);
  saveDatabase();
  return db;
}

function migrateOptionalProductBarcodes(database: Database): void {
  const indexes = database.exec('PRAGMA index_list(products)')[0]?.values ?? [];
  const hasLegacyBarcodeConstraint = indexes.some((index) => {
    if (Number(index[2]) !== 1 || Number(index[4]) === 1) return false;
    const indexName = String(index[1]).replace(/"/g, '""');
    const columns = database.exec(`PRAGMA index_info("${indexName}")`)[0]?.values ?? [];
    return columns.some((column) => String(column[2]) === 'barcode');
  });

  if (hasLegacyBarcodeConstraint) {
    const foreignKeysEnabled =
      Number(database.exec('PRAGMA foreign_keys')[0]?.values[0]?.[0] ?? 0) === 1;
    database.run('PRAGMA foreign_keys = OFF');
    database.run('BEGIN IMMEDIATE');
    try {
      database.run(`
        CREATE TABLE products_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sku TEXT UNIQUE NOT NULL,
          barcode TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL,
          name_ar TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL,
          brand TEXT NOT NULL DEFAULT '',
          image_data TEXT NOT NULL DEFAULT '',
          image_path TEXT NOT NULL DEFAULT '',
          cost_price REAL NOT NULL DEFAULT 0,
          retail_price REAL NOT NULL DEFAULT 0,
          stock INTEGER NOT NULL DEFAULT 0,
          reorder_level INTEGER NOT NULL DEFAULT 5,
          unit TEXT NOT NULL DEFAULT 'ea',
          multi_units TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL,
          tax_rate REAL DEFAULT 15
        )
      `);
      database.run(`
        INSERT INTO products_new (
          id, sku, barcode, name, name_ar, category, brand, image_data, image_path,
          cost_price, retail_price, stock, reorder_level, unit, multi_units, updated_at, tax_rate
        )
        SELECT
          id, sku, barcode, name, name_ar, category, brand, image_data, image_path,
          cost_price, retail_price, stock, reorder_level, unit, multi_units, updated_at, tax_rate
        FROM products
      `);
      database.run('DROP TABLE products');
      database.run('ALTER TABLE products_new RENAME TO products');
      database.run('COMMIT');
    } catch (error) {
      database.run('ROLLBACK');
      throw error;
    } finally {
      database.run(`PRAGMA foreign_keys = ${foreignKeysEnabled ? 'ON' : 'OFF'}`);
    }
  }

  database.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_products_nonempty_barcode_unique
     ON products(barcode) WHERE TRIM(barcode) <> ''`
  );
  database.run('CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)');
  database.run('CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)');
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_products_normalized_sku ON products(LOWER(TRIM(sku)))'
  );
  database.run(
    'CREATE INDEX IF NOT EXISTS idx_products_normalized_barcode ON products(LOWER(TRIM(barcode)))'
  );
}

function initSchema(database: Database): void {
  const hasColumn = (table: string, column: string) =>
    database.exec(`PRAGMA table_info(${table})`)[0]?.values.some(
      (row) => String(row[1]) === column
    ) || false;
  const hadProductTaxRate = hasColumn('products', 'tax_rate');
  const hadSaleItemTaxRate = hasColumn('sale_items', 'tax_rate');
  const hadSaleItemTaxAmount = hasColumn('sale_items', 'tax_amount');
  const hadSaleItemDiscountAmount = hasColumn('sale_items', 'discount_amount');

  database.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE NOT NULL,
      barcode TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      name_ar TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      image_data TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      cost_price REAL NOT NULL DEFAULT 0,
      retail_price REAL NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      reorder_level INTEGER NOT NULL DEFAULT 5,
      unit TEXT NOT NULL DEFAULT 'ea',
      multi_units TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_barcodes (
      barcode TEXT PRIMARY KEY COLLATE NOCASE,
      product_id INTEGER NOT NULL,
      unit_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL CHECK (kind IN ('unit', 'alias')),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_number TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      cashier_name TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT 'Walk-in Customer / عميل نقدي',
      subtotal REAL NOT NULL,
      discount_type TEXT NOT NULL DEFAULT 'fixed',
      discount_value REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 15.0,
      tax_type TEXT,
      tax_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      payment_method TEXT NOT NULL,
      amount_tendered REAL NOT NULL,
      change_due REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'COMPLETED'
    );

    CREATE TABLE IF NOT EXISTS issued_invoice_numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      name_ar TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      unit_id TEXT NOT NULL DEFAULT '',
      unit_name TEXT NOT NULL DEFAULT '',
      units_per_base INTEGER NOT NULL DEFAULT 1,
      tax_rate REAL,
      tax_amount REAL,
      discount_amount REAL,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS sales_return_vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_number TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      cashier_name TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      refund_amount REAL NOT NULL DEFAULT 0,
      tax_refund_amount REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sale_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      voucher_id INTEGER,
      created_at TEXT NOT NULL,
      cashier_name TEXT NOT NULL,
      refund_amount REAL NOT NULL DEFAULT 0,
      tax_refund_amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    CREATE TABLE IF NOT EXISTS sale_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL,
      sale_item_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      returned_quantity INTEGER NOT NULL,
      refund_amount REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (return_id) REFERENCES sale_returns(id),
      FOREIGN KEY (sale_item_id) REFERENCES sale_items(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_installation (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      system_code TEXT NOT NULL UNIQUE,
      hardware_fingerprint TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS registration_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_type TEXT NOT NULL CHECK (request_type IN ('demo', 'license')),
      system_code TEXT NOT NULL,
      submitted_key TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL,
      reviewed_at TEXT,
      reviewed_by TEXT
    );

    CREATE TABLE IF NOT EXISTS demo_access (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      system_code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      offline_grace_started_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_registration_requests_status_created
      ON registration_requests(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS inventory_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('category', 'brand', 'taxRate', 'unit')),
      value TEXT NOT NULL,
      image_data TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      UNIQUE(type, value)
    );

    CREATE TABLE IF NOT EXISTS cashbook_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_date TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('IN', 'OUT')),
      category TEXT NOT NULL,
      payment_type TEXT,
      account_name TEXT,
      description TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      reference TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashbook_opening_balance (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      entry_date TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount >= 0)
    );

    CREATE TABLE IF NOT EXISTS cashier_shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cashier_username TEXT NOT NULL COLLATE NOCASE,
      cashier_name TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      opening_cash REAL NOT NULL CHECK (opening_cash >= 0),
      closed_at TEXT,
      closing_cash REAL CHECK (closing_cash IS NULL OR closing_cash >= 0)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cashier_shifts_one_open_per_cashier
      ON cashier_shifts(cashier_username) WHERE closed_at IS NULL;

    CREATE TABLE IF NOT EXISTS print_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      receipt_number TEXT NOT NULL,
      created_at TEXT NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED'
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_ar TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      building_no TEXT NOT NULL DEFAULT '',
      street_name TEXT NOT NULL DEFAULT '',
      district TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT 'Saudi Arabia',
      vat_number TEXT NOT NULL DEFAULT '',
      cr_number TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_ar TEXT NOT NULL DEFAULT '',
      contact_person TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      building_no TEXT NOT NULL DEFAULT '',
      street_name TEXT NOT NULL DEFAULT '',
      district TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT 'Saudi Arabia',
      tax_number TEXT NOT NULL DEFAULT '',
      cr_number TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      vendor_id INTEGER NOT NULL,
      vendor_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      received_date TEXT NOT NULL,
      subtotal REAL NOT NULL,
      tax_amount REAL NOT NULL DEFAULT 0,
      shipping_cost REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'PAID',
      notes TEXT NOT NULL DEFAULT '',
      paid_amount REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (vendor_id) REFERENCES vendors(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_return_vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_number TEXT UNIQUE NOT NULL,
      purchase_id INTEGER NOT NULL,
      invoice_number TEXT NOT NULL,
      vendor_id INTEGER NOT NULL,
      vendor_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      notes TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (purchase_id) REFERENCES purchases(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_id INTEGER NOT NULL,
      purchase_item_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_cost REAL NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY (voucher_id) REFERENCES purchase_return_vouchers(id),
      FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(id)
    );
  `);

  // Safe migrations for newly added columns if table already exists
  const migrations = [
    'ALTER TABLE products ADD COLUMN name_ar TEXT DEFAULT ""',
    'ALTER TABLE products ADD COLUMN brand TEXT DEFAULT ""',
    'ALTER TABLE products ADD COLUMN image_data TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE products ADD COLUMN image_path TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE products ADD COLUMN multi_units TEXT NOT NULL DEFAULT "[]"',
    'ALTER TABLE customers ADD COLUMN name_ar TEXT DEFAULT ""',
    'ALTER TABLE customers ADD COLUMN building_no TEXT DEFAULT ""',
    'ALTER TABLE customers ADD COLUMN street_name TEXT DEFAULT ""',
    'ALTER TABLE customers ADD COLUMN district TEXT DEFAULT ""',
    'ALTER TABLE customers ADD COLUMN city TEXT DEFAULT ""',
    'ALTER TABLE customers ADD COLUMN postal_code TEXT DEFAULT ""',
    'ALTER TABLE customers ADD COLUMN country TEXT DEFAULT "Saudi Arabia"',
    'ALTER TABLE customers ADD COLUMN vat_number TEXT DEFAULT ""',
    'ALTER TABLE customers ADD COLUMN cr_number TEXT DEFAULT ""',
    'ALTER TABLE vendors ADD COLUMN name_ar TEXT DEFAULT ""',
    'ALTER TABLE vendors ADD COLUMN building_no TEXT DEFAULT ""',
    'ALTER TABLE vendors ADD COLUMN street_name TEXT DEFAULT ""',
    'ALTER TABLE vendors ADD COLUMN district TEXT DEFAULT ""',
    'ALTER TABLE vendors ADD COLUMN city TEXT DEFAULT ""',
    'ALTER TABLE vendors ADD COLUMN postal_code TEXT DEFAULT ""',
    'ALTER TABLE vendors ADD COLUMN country TEXT DEFAULT "Saudi Arabia"',
    'ALTER TABLE vendors ADD COLUMN cr_number TEXT DEFAULT ""',
    'ALTER TABLE sale_items ADD COLUMN name_ar TEXT DEFAULT ""',
    'ALTER TABLE sale_items ADD COLUMN unit_id TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE sale_items ADD COLUMN unit_name TEXT NOT NULL DEFAULT ""',
    'ALTER TABLE sale_items ADD COLUMN units_per_base INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE sale_items ADD COLUMN tax_rate REAL',
    'ALTER TABLE sale_items ADD COLUMN tax_amount REAL',
    'ALTER TABLE sale_items ADD COLUMN discount_amount REAL',
    'ALTER TABLE sales ADD COLUMN tax_type TEXT',
    'ALTER TABLE inventory_options ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE sale_returns ADD COLUMN voucher_id INTEGER',
    'ALTER TABLE sale_returns ADD COLUMN tax_refund_amount REAL NOT NULL DEFAULT 0',
    'ALTER TABLE cashbook_entries ADD COLUMN payment_type TEXT',
    'ALTER TABLE cashbook_entries ADD COLUMN account_name TEXT',
    'ALTER TABLE products ADD COLUMN tax_rate REAL DEFAULT 15',
    'ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT ""',
    'ALTER TABLE purchases ADD COLUMN paid_amount REAL NOT NULL DEFAULT 0',
    'CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)',
    'CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)',
    'CREATE INDEX IF NOT EXISTS idx_products_normalized_sku ON products(LOWER(TRIM(sku)))',
    'CREATE INDEX IF NOT EXISTS idx_products_normalized_barcode ON products(LOWER(TRIM(barcode)))',
    'CREATE INDEX IF NOT EXISTS idx_product_barcodes_normalized_barcode ON product_barcodes(LOWER(TRIM(barcode)))',
    'CREATE INDEX IF NOT EXISTS idx_products_name ON products(name)',
    'CREATE INDEX IF NOT EXISTS idx_product_barcodes_product_id ON product_barcodes(product_id)',
    'CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id)',
    'CREATE INDEX IF NOT EXISTS idx_sale_returns_sale_id ON sale_returns(sale_id)',
    'CREATE INDEX IF NOT EXISTS idx_sale_returns_voucher_id ON sale_returns(voucher_id)',
    'CREATE INDEX IF NOT EXISTS idx_purchase_return_vouchers_purchase_id ON purchase_return_vouchers(purchase_id)',
    'CREATE INDEX IF NOT EXISTS idx_purchase_return_items_voucher_id ON purchase_return_items(voucher_id)',
    'CREATE INDEX IF NOT EXISTS idx_purchase_return_items_purchase_item_id ON purchase_return_items(purchase_item_id)',
    'DROP INDEX IF EXISTS idx_sales_order_number',
  ];

  for (const m of migrations) {
    try {
      database.run(m);
    } catch {
      // Column already exists
    }
  }

  if (!hasColumn('demo_access', 'offline_grace_started_at')) {
    database.run('ALTER TABLE demo_access ADD COLUMN offline_grace_started_at TEXT');
  }

  const hasHardwareFingerprint = database.exec('PRAGMA table_info(app_installation)')[0]?.values
    .some((row) => String(row[1]) === 'hardware_fingerprint') ?? false;
  if (!hasHardwareFingerprint) {
    database.run(
      "ALTER TABLE app_installation ADD COLUMN hardware_fingerprint TEXT NOT NULL DEFAULT ''"
    );
  }

  database.run(
    "UPDATE purchases SET paid_amount = total WHERE payment_status = 'PAID' AND paid_amount = 0"
  );

  migrateOptionalProductBarcodes(database);

  if (!hadProductTaxRate) {
    const configuredTaxRate = Number(
      database.exec("SELECT value FROM settings WHERE key = 'taxRate'")[0]?.values[0]?.[0]
    );
    const legacyTaxRate = Number.isFinite(configuredTaxRate) &&
      configuredTaxRate >= 0 && configuredTaxRate <= 100
      ? configuredTaxRate
      : 15;
    database.run('UPDATE products SET tax_rate = ?', [legacyTaxRate]);
  }
  if (!hadSaleItemTaxRate) {
    database.run(
      `UPDATE sale_items
       SET tax_rate = COALESCE(
         (SELECT CASE WHEN products.tax_rate = 0 THEN 0 END
          FROM products WHERE products.id = sale_items.product_id),
         (SELECT tax_rate FROM sales WHERE sales.id = sale_items.sale_id),
         15
       )`
    );
  }
  const zeroVatRepair = database.exec(
    "SELECT value FROM settings WHERE key = 'zeroVatLineTaxRepairV1'"
  )[0]?.values[0]?.[0];
  if (String(zeroVatRepair ?? '') !== '1') {
    database.run(
      `UPDATE sale_items
       SET tax_rate = 0
       WHERE tax_rate = COALESCE(
         (SELECT tax_rate FROM sales WHERE sales.id = sale_items.sale_id),
         15
       )
       AND EXISTS (
         SELECT 1 FROM sales
         WHERE sales.id = sale_items.sale_id AND sales.tax_type IS NULL
       )
       AND EXISTS (
         SELECT 1 FROM products
         WHERE products.id = sale_items.product_id AND products.tax_rate = 0
       )`
    );
    database.run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('zeroVatLineTaxRepairV1', '1')"
    );
  }
  if (!hadSaleItemTaxAmount) {
    database.run(
      `UPDATE sale_items
       SET tax_amount = CASE
         WHEN (SELECT tax_rate FROM sales WHERE sales.id = sale_items.sale_id) > 0
         THEN ROUND(
           (SELECT tax_amount FROM sales WHERE sales.id = sale_items.sale_id) *
           line_total /
           MAX(1, (SELECT SUM(line_total) FROM sale_items AS sale_gross WHERE sale_gross.sale_id = sale_items.sale_id)),
           2
         )
         ELSE 0
       END`
    );
  }
  if (!hadSaleItemDiscountAmount) {
    database.run(
      `UPDATE sale_items
       SET discount_amount = ROUND(
         (SELECT discount_amount FROM sales WHERE sales.id = sale_items.sale_id) *
         line_total /
         MAX(1, (SELECT SUM(line_total) FROM sale_items AS sale_gross WHERE sale_gross.sale_id = sale_items.sale_id)),
         2
       )`
    );
  }

  database.run(
    `INSERT OR IGNORE INTO issued_invoice_numbers (invoice_number, created_at)
     SELECT receipt_number, created_at FROM sales WHERE receipt_number <> ''`
  );
  database.run("DELETE FROM settings WHERE key = 'documentPrefixes'");
  migrateLegacySaleReturns(database);
}

function seedInventoryOptions(database: Database): void {
  const configuredTaxRate = database.exec(
    "SELECT value FROM settings WHERE key = 'taxRate'"
  )[0]?.values[0]?.[0];
  const defaultTaxRate = Number(configuredTaxRate);
  const validDefaultTaxRate = Number.isFinite(defaultTaxRate) && defaultTaxRate >= 0 && defaultTaxRate <= 100
    ? defaultTaxRate
    : 15;
  const defaults: Array<[InventoryOptionType, string]> = [
    ...['ea', 'pcs', 'box', 'pack', 'btl', 'kg', 'g', 'L', 'ml'].map(
      (value) => ['unit', value] as [InventoryOptionType, string]
    ),
    ['taxRate', String(validDefaultTaxRate)],
  ];

  const insert = database.prepare(
    'INSERT OR IGNORE INTO inventory_options (type, value) VALUES (?, ?)'
  );
  for (const type of ['category', 'unit', 'taxRate'] as InventoryOptionType[]) {
    const count = database.exec(
      'SELECT COUNT(*) FROM inventory_options WHERE type = ?',
      [type]
    );
    if (Number(count[0]?.values[0]?.[0] || 0) > 0) continue;
    for (const [defaultType, value] of defaults) {
      if (defaultType === type) insert.run([type, value]);
    }
  }

  const productOptions = database.exec(`
    SELECT 'category', category FROM products WHERE TRIM(category) <> ''
    UNION SELECT 'brand', brand FROM products WHERE TRIM(brand) <> ''
    UNION SELECT 'unit', unit FROM products WHERE TRIM(unit) <> ''
    UNION SELECT 'taxRate', CAST(tax_rate AS TEXT) FROM products
  `);
  const options = [...(productOptions[0]?.values || []).map(
    (row) => [String(row[0]) as InventoryOptionType, String(row[1])] as [InventoryOptionType, string]
  )];
  for (const [type, value] of options) {
    const normalizedValue = type === 'taxRate' ? String(Number(value)) : value.trim();
    if (normalizedValue) insert.run([type, normalizedValue]);
  }
  const configuredRate = String(validDefaultTaxRate);
  const defaultOption = database.exec(
    `SELECT id FROM inventory_options
     WHERE type = 'taxRate' AND is_default = 1 ORDER BY id LIMIT 1`
  )[0]?.values[0]?.[0];
  const matchingOption = database.exec(
    `SELECT id FROM inventory_options
     WHERE type = 'taxRate' AND value = ? ORDER BY id LIMIT 1`,
    [configuredRate]
  )[0]?.values[0]?.[0];
  const fallbackOption = database.exec(
    `SELECT id FROM inventory_options WHERE type = 'taxRate' ORDER BY id LIMIT 1`
  )[0]?.values[0]?.[0];
  const selectedOption = defaultOption ?? matchingOption ?? fallbackOption;
  if (selectedOption !== undefined) {
    database.run(
      `UPDATE inventory_options SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END
       WHERE type = 'taxRate'`,
      [selectedOption]
    );
  }
  const defaultUnitOption = database.exec(
    `SELECT id FROM inventory_options
     WHERE type = 'unit' AND is_default = 1 ORDER BY id LIMIT 1`
  )[0]?.values[0]?.[0];
  const preferredUnitOption = database.exec(
    `SELECT id FROM inventory_options
     WHERE type = 'unit' AND LOWER(value) = 'ea' ORDER BY id LIMIT 1`
  )[0]?.values[0]?.[0];
  const fallbackUnitOption = database.exec(
    `SELECT id FROM inventory_options WHERE type = 'unit' ORDER BY id LIMIT 1`
  )[0]?.values[0]?.[0];
  const selectedUnitOption =
    defaultUnitOption ?? preferredUnitOption ?? fallbackUnitOption;
  if (selectedUnitOption !== undefined) {
    database.run(
      `UPDATE inventory_options SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END
       WHERE type = 'unit'`,
      [selectedUnitOption]
    );
  }
  insert.free();
}

function migrateLegacySaleReturns(database: Database): void {
  const legacyReturns = database.exec(
    `SELECT r.id, r.sale_id, r.created_at, r.cashier_name, r.refund_amount,
            r.payment_method, s.total, s.tax_amount
     FROM sale_returns r
     LEFT JOIN sales s ON s.id = r.sale_id
     WHERE r.voucher_id IS NULL
     ORDER BY r.id ASC`
  );
  const returnedTaxBySale = new Map<number, number>();
  for (const row of legacyReturns[0]?.values || []) {
    const returnId = Number(row[0]);
    const saleId = Number(row[1]);
    const createdAt = String(row[2]);
    const cashierName = String(row[3]);
    const refundAmount = Number(row[4]);
    const paymentMethod = String(row[5]);
    const saleTotal = Number(row[6] || 0);
    const saleTax = Number(row[7] || 0);
    const year = new Date(createdAt).getFullYear() || new Date().getFullYear();
    const alreadyRefundedTax = returnedTaxBySale.get(saleId) || 0;
    const taxRefund = saleTotal > 0
      ? Number(
          Math.min(
            Math.max(0, saleTax - alreadyRefundedTax),
            (saleTax * refundAmount) / saleTotal
          ).toFixed(2)
        )
      : 0;
    returnedTaxBySale.set(saleId, alreadyRefundedTax + taxRefund);
    const voucherNumber = `SR-${year}-M${String(returnId).padStart(6, '0')}`;

    database.run(
      `INSERT INTO sales_return_vouchers
         (voucher_number, created_at, cashier_name, payment_method, refund_amount, tax_refund_amount)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [voucherNumber, createdAt, cashierName, paymentMethod, refundAmount, taxRefund]
    );
    const voucherId = Number(database.exec('SELECT last_insert_rowid()')[0].values[0][0]);
    database.run(
      'UPDATE sale_returns SET voucher_id = ?, tax_refund_amount = ? WHERE id = ?',
      [voucherId, taxRefund, returnId]
    );
  }
}

function seedInitialData(database: Database): void {
  const settingsCountRes = database.exec('SELECT COUNT(*) as cnt FROM settings');
  const settingsCount = Number(settingsCountRes[0]?.values[0]?.[0] ?? 0);

  if (settingsCount === 0) {
    const defaultSettings: Record<string, string> = {
      storeName: 'aptPOS Retail',
      storeNameAr: 'ابت بوس للتجزئة',
      crNumber: '1010123456',
      taxId: '310123456700003',
      address: 'King Fahd Road, Al Olaya, Riyadh, Saudi Arabia',
      buildingNo: '1234',
      streetName: 'King Fahd Rd',
      district: 'Al Olaya',
      city: 'Riyadh',
      postalCode: '12211',
      country: 'Saudi Arabia',
      phone: '+966 11 234 5678',
      taxRate: '15.0',
      taxType: 'inclusive',
      currencySymbol: 'SAR',
      receiptFooter: 'Thank you for your business!',
      receiptFooterAr: 'شكراً لتسوقكم معنا!',
      paperWidth: '80mm',
      printerOnline: 'true',
      cashierName: 'Cashier / الكاشير',
      defaultCustomer: 'Walk-in Customer / عميل نقدي',
    };

    const stmt = database.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(defaultSettings)) {
      stmt.run([k, v]);
    }
    stmt.free();
  }

  const usersCountRes = database.exec('SELECT COUNT(*) as cnt FROM users');
  const usersCount = Number(usersCountRes[0]?.values[0]?.[0] ?? 0);

  if (usersCount === 0) {
    const userStmt = database.prepare(
      'INSERT INTO users (username, password, role, display_name, permissions) VALUES (?, ?, ?, ?, ?)'
    );
    userStmt.run([
      'aptadmin',
      'aptpwd123',
      'admin',
      'Company Admin / مدير الشركة',
      'register,inventory,purchases,customers,vendors,accounts,reports,sales,edit-sales,sales-return,manage-sales-returns,delete-sales,settings',
    ]);
    userStmt.free();
  }

  const customersCountRes = database.exec('SELECT COUNT(*) as cnt FROM customers');
  const customersCount = Number(customersCountRes[0]?.values[0]?.[0] ?? 0);
  if (customersCount === 0) {
    const custStmt = database.prepare(
      `INSERT INTO customers (
        name, name_ar, phone, email, address,
        building_no, street_name, district, city, postal_code, country,
        vat_number, cr_number, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const now = new Date().toISOString();
    custStmt.run([
      'Walk-in Customer',
      'عميل نقدي',
      '',
      '',
      'Riyadh, Saudi Arabia',
      '1234',
      'King Fahd Rd',
      'Al Olaya',
      'Riyadh',
      '12211',
      'Saudi Arabia',
      '',
      '',
      'Default retail walk-in customer',
      now,
    ]);
    custStmt.free();
  }

  // NOTE: Zero dummy products, zero dummy sales, zero dummy purchases, and zero dummy vendors
  // are seeded. The database is completely clean for the business owner to import or create their products.
}


function normalizeProductMultiUnits(value: unknown): ProductMultiUnit[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('Multi-unit details must be a list.');

  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Multi-unit row ${index + 1} is invalid.`);
    }
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const barcode = typeof record.barcode === 'string' ? record.barcode.trim() : '';
    const unitsPerBase = Number(record.unitsPerBase);
    const price = record.price === null || record.price === undefined || record.price === ''
      ? null
      : Number(record.price);
    if (!id || id.length > 100 || ids.has(id)) {
      throw new Error(`Multi-unit row ${index + 1} needs a unique ID.`);
    }
    if (!name || name.length > 100 || names.has(name.toLocaleLowerCase())) {
      throw new Error(`Multi-unit row ${index + 1} needs a unique name.`);
    }
    if (!Number.isInteger(unitsPerBase) || unitsPerBase < 1) {
      throw new Error(`Multi-unit row ${index + 1} must contain at least one base unit.`);
    }
    if (barcode.length > 255) {
      throw new Error(`Multi-unit barcode in row ${index + 1} is too long.`);
    }
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      throw new Error(`Multi-unit price in row ${index + 1} must be zero or greater.`);
    }
    ids.add(id);
    names.add(name.toLocaleLowerCase());
    return { id, name, barcode, unitsPerBase, price };
  });
}

function normalizeProductAdditionalBarcodes(
  value: unknown,
  multiUnits: ProductMultiUnit[]
): ProductAdditionalBarcode[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('Additional barcodes must be a list.');
  const unitIds = new Set(multiUnits.map((unit) => unit.id));
  return value.flatMap((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`Additional barcode row ${index + 1} is invalid.`);
    }
    const record = entry as Record<string, unknown>;
    const barcode = typeof record.barcode === 'string' ? record.barcode.trim() : '';
    const unitId = typeof record.unitId === 'string' && record.unitId.trim()
      ? record.unitId.trim()
      : null;
    if (!barcode) return [];
    if (barcode.length > 255) {
      throw new Error(`Additional barcode in row ${index + 1} is too long.`);
    }
    if (unitId && !unitIds.has(unitId)) {
      throw new Error(`Additional barcode row ${index + 1} refers to an unknown multi-unit.`);
    }
    return [{ barcode, unitId }];
  });
}

function validateProductSku(
  database: Database,
  productId: number | null,
  sku: string
): void {
  const normalizedSku = sku.trim();
  if (!normalizedSku) throw new Error('SKU is required.');

  const conflict = database.exec(
    `SELECT id FROM products
     WHERE LOWER(TRIM(sku)) = LOWER(?) AND (? IS NULL OR id <> ?)
     LIMIT 1`,
    [normalizedSku, productId, productId]
  );
  if (conflict[0]?.values.length) {
    throw new Error(`SKU ${normalizedSku} is already assigned to another product.`);
  }

  const barcodeConflict = database.exec(
    `SELECT id FROM products
     WHERE LOWER(TRIM(barcode)) = LOWER(?) AND (? IS NULL OR id <> ?)
     UNION ALL
     SELECT product_id AS id FROM product_barcodes
     WHERE LOWER(TRIM(barcode)) = LOWER(?) AND (? IS NULL OR product_id <> ?)
     LIMIT 1`,
    [normalizedSku, productId, productId, normalizedSku, productId, productId]
  );
  if (barcodeConflict[0]?.values.length) {
    throw new Error(`SKU ${normalizedSku} is already used as a barcode by another product.`);
  }
}

function validateProductBarcodes(
  database: Database,
  productId: number | null,
  baseBarcode: string,
  multiUnits: ProductMultiUnit[],
  additionalBarcodes: ProductAdditionalBarcode[]
): void {
  const entries = [
    { barcode: baseBarcode.trim(), label: 'Base-unit barcode' },
    ...multiUnits
      .filter((unit) => unit.barcode)
      .map((unit) => ({ barcode: unit.barcode, label: `Barcode for ${unit.name}` })),
    ...additionalBarcodes.map((entry) => ({ barcode: entry.barcode, label: 'Additional barcode' })),
  ];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.barcode) continue;
    const normalized = entry.barcode.toLocaleLowerCase();
    if (seen.has(normalized)) {
      throw new Error(`${entry.label} duplicates another barcode on this product.`);
    }
    seen.add(normalized);

    const primaryConflict = database.exec(
      `SELECT id FROM products
       WHERE LOWER(TRIM(barcode)) = LOWER(?) AND (? IS NULL OR id <> ?)
       LIMIT 1`,
      [entry.barcode, productId, productId]
    );
    const additionalConflict = database.exec(
      `SELECT product_id FROM product_barcodes
       WHERE barcode = ? AND (? IS NULL OR product_id <> ?)
       LIMIT 1`,
      [entry.barcode, productId, productId]
    );
    if (primaryConflict[0]?.values.length || additionalConflict[0]?.values.length) {
      throw new Error(`Barcode ${entry.barcode} is already assigned to another product.`);
    }

    const skuConflict = database.exec(
      `SELECT id FROM products
       WHERE LOWER(TRIM(sku)) = LOWER(?) AND (? IS NULL OR id <> ?)
       LIMIT 1`,
      [entry.barcode, productId, productId]
    );
    if (skuConflict[0]?.values.length) {
      throw new Error(`Barcode ${entry.barcode} is already assigned as a SKU to another product.`);
    }
  }
}

function syncProductBarcodes(
  database: Database,
  productId: number,
  multiUnits: ProductMultiUnit[],
  additionalBarcodes: ProductAdditionalBarcode[]
): void {
  database.run('DELETE FROM product_barcodes WHERE product_id = ?', [productId]);
  const entries = [
    ...multiUnits
      .filter((unit) => unit.barcode)
      .map((unit) => ({ barcode: unit.barcode, unitId: unit.id, kind: 'unit' as const })),
    ...additionalBarcodes.map((entry) => ({
      barcode: entry.barcode,
      unitId: entry.unitId || '',
      kind: 'alias' as const,
    })),
  ];
  for (const entry of entries) {
    database.run(
      'INSERT INTO product_barcodes (barcode, product_id, unit_id, kind) VALUES (?, ?, ?, ?)',
      [entry.barcode, productId, entry.unitId, entry.kind]
    );
  }
}

function loadProductAdditionalBarcodes(
  database: Database,
  productId: number
): ProductAdditionalBarcode[] {
  const result = database.exec(
    `SELECT barcode, unit_id FROM product_barcodes
     WHERE product_id = ? AND kind = 'alias' ORDER BY rowid`,
    [productId]
  );
  return (result[0]?.values || []).map((row) => ({
    barcode: String(row[0]),
    unitId: String(row[1] || '') || null,
  }));
}

function attachProductAdditionalBarcodes(database: Database, products: Product[]): Product[] {
  const result = database.exec(
    `SELECT product_id, barcode, unit_id FROM product_barcodes
     WHERE kind = 'alias' ORDER BY rowid`
  );
  const aliasesByProduct = new Map<number, ProductAdditionalBarcode[]>();
  for (const row of result[0]?.values || []) {
    const productId = Number(row[0]);
    const aliases = aliasesByProduct.get(productId) || [];
    aliases.push({ barcode: String(row[1]), unitId: String(row[2] || '') || null });
    aliasesByProduct.set(productId, aliases);
  }
  return products.map((product) => ({
    ...product,
    additionalBarcodes: aliasesByProduct.get(product.id) || [],
  }));
}

function mapProductRow(row: unknown[]): Product {
  const multiUnits = normalizeProductMultiUnits(
    JSON.parse(String(row[16] || '[]')) as unknown
  );
  return {
    id: Number(row[0]),
    sku: String(row[1]),
    barcode: String(row[2]),
    name: String(row[3]),
    nameAr: row[4] ? String(row[4]) : '',
    category: String(row[5]) as ProductCategory,
    costPrice: Number(row[6]),
    retailPrice: Number(row[7]),
    stock: Number(row[8]),
    reorderLevel: Number(row[9]),
    unit: String(row[10]),
    updatedAt: String(row[11]),
    taxRate: row[12] !== undefined && row[12] !== null ? Number(row[12]) : 15,
    brand: row[13] ? String(row[13]) : '',
    imageData: row[14] ? String(row[14]) : '',
    imagePath: row[15] ? String(row[15]) : '',
    multiUnits,
    additionalBarcodes: [],
  };
}

function normalizeProductImageData(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (
    typeof value !== 'string' ||
    value.length > 2_100_000 ||
    !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error('Product image must be a JPEG, PNG, or WebP image smaller than 1.5 MB.');
  }
  return value;
}

function normalizeProductImagePath(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 4096 || !path.isAbsolute(value)) {
    throw new Error('Product image path must be an absolute local path.');
  }
  return value;
}

export async function listProducts(filters?: {
  search?: string;
  category?: string;
  stockStatus?: string;
}): Promise<Product[]> {
  const database = await getDb();
  const res = database.exec(
    `SELECT id, sku, barcode, name, name_ar, category, cost_price, retail_price, stock, reorder_level, unit, updated_at, tax_rate, brand, image_data, image_path, multi_units
     FROM products ORDER BY name ASC`
  );
  if (!res[0]) return [];

  let products = attachProductAdditionalBarcodes(
    database,
    res[0].values.map(mapProductRow)
  );

  if (filters?.category && filters.category !== 'All') {
    products = products.filter((p) => p.category === filters.category);
  }

  if (filters?.stockStatus === 'low') {
    products = products.filter((p) => p.stock > 0 && p.stock <= p.reorderLevel);
  } else if (filters?.stockStatus === 'out') {
    products = products.filter((p) => p.stock <= 0);
  }

  if (filters?.search && filters.search.trim() !== '') {
    const q = filters.search.trim().toLowerCase();
    products = products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.nameAr && p.nameAr.toLowerCase().includes(q)) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.toLowerCase().includes(q)
    );
  }

  return products;
}

function normalizeInventoryOptionValue(type: InventoryOptionType, value: unknown): string {
  if (type === 'taxRate') {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
      throw new Error('Tax rate is required.');
    }
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new Error('Tax rate must be a number between 0 and 100.');
    }
    return String(rate);
  }
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
    throw new Error('Name must contain 1 to 100 characters.');
  }
  return value.trim();
}

function normalizeCategoryImageData(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (
    typeof value !== 'string' ||
    value.length > 2_000_000 ||
    !/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  ) {
    throw new Error('Category image must be a JPEG, PNG, or WebP image smaller than 1.5 MB.');
  }
  return value;
}

function isInventoryOptionType(value: unknown): value is InventoryOptionType {
  return value === 'category' || value === 'brand' || value === 'taxRate' || value === 'unit';
}

export async function listInventoryOptions(): Promise<InventoryOption[]> {
  const database = await getDb();
  const productOptions = database.exec(`
    SELECT 'category', category FROM products WHERE TRIM(category) <> ''
    UNION SELECT 'brand', brand FROM products WHERE TRIM(brand) <> ''
    UNION SELECT 'unit', unit FROM products WHERE TRIM(unit) <> ''
    UNION SELECT 'taxRate', CAST(tax_rate AS TEXT) FROM products
  `);
  const usedOptions = productOptions[0]?.values || [];
  const insert = database.prepare(
    'INSERT OR IGNORE INTO inventory_options (type, value) VALUES (?, ?)'
  );
  let addedProductOption = false;
  for (const row of usedOptions) {
    const type = String(row[0]) as InventoryOptionType;
    const value = type === 'taxRate' ? String(Number(row[1])) : String(row[1]).trim();
    if (
      value &&
      !database.exec(
        'SELECT 1 FROM inventory_options WHERE type = ? AND value = ?',
        [type, value]
      )[0]?.values.length
    ) {
      insert.run([type, value]);
      addedProductOption = true;
    }
  }
  insert.free();
  const result = database.exec(
    `SELECT id, type, value, image_data, is_default
     FROM inventory_options
     ORDER BY type, value COLLATE NOCASE`
  );
  if (addedProductOption) saveDatabase();
  return (result[0]?.values || []).map((row) => ({
    id: Number(row[0]),
    type: String(row[1]) as InventoryOptionType,
    value: String(row[2]),
    imageData: String(row[3] || ''),
    isDefault: Boolean(row[4]),
  }));
}

export async function createInventoryOption(input: {
  type: unknown;
  value: unknown;
  imageData?: unknown;
}): Promise<InventoryOption> {
  const database = await getDb();
  if (!isInventoryOptionType(input.type)) throw new Error('Invalid inventory option type.');
  const value = normalizeInventoryOptionValue(input.type, input.value);
  const imageData = input.type === 'category'
    ? normalizeCategoryImageData(input.imageData)
    : '';
  const duplicate = database.exec(
    'SELECT id FROM inventory_options WHERE type = ? AND LOWER(value) = LOWER(?)',
    [input.type, value]
  );
  if (duplicate[0]?.values.length) {
    throw new Error('An option with this value already exists.');
  }
  database.run(
    'INSERT INTO inventory_options (type, value, image_data) VALUES (?, ?, ?)',
    [input.type, value, imageData]
  );
  const id = Number(database.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  saveDatabase();
  return { id, type: input.type, value, imageData, isDefault: false };
}

export async function updateInventoryOption(
  id: number,
  input: { value: unknown; imageData?: unknown; isDefault?: unknown }
): Promise<InventoryOption | null> {
  const database = await getDb();
  const result = database.exec(
    'SELECT type, value, image_data, is_default FROM inventory_options WHERE id = ?',
    [id]
  );
  const row = result[0]?.values[0];
  if (!row) return null;

  const type = String(row[0]) as InventoryOptionType;
  const oldValue = String(row[1]);
  const value = normalizeInventoryOptionValue(type, input.value);
  const imageData = type === 'category'
    ? normalizeCategoryImageData(input.imageData)
    : String(row[2] || '');
  const duplicate = database.exec(
    'SELECT id FROM inventory_options WHERE type = ? AND LOWER(value) = LOWER(?) AND id <> ?',
    [type, value, id]
  );
  if (duplicate[0]?.values.length) {
    throw new Error('An option with this value already exists.');
  }

  if (value !== oldValue) {
    if (type === 'category') {
      database.run('UPDATE products SET category = ? WHERE category = ?', [value, oldValue]);
    } else if (type === 'brand') {
      database.run('UPDATE products SET brand = ? WHERE brand = ?', [value, oldValue]);
    } else if (type === 'unit') {
      database.run('UPDATE products SET unit = ? WHERE unit = ?', [value, oldValue]);
    } else {
      database.run(
        'UPDATE products SET tax_rate = ? WHERE ABS(tax_rate - ?) < 0.000001',
        [Number(value), Number(oldValue)]
      );
    }
  }
  if ((type === 'taxRate' || type === 'unit') && input.isDefault === true) {
    database.run('UPDATE inventory_options SET is_default = 0 WHERE type = ?', [type]);
  }
  database.run(
    `UPDATE inventory_options
     SET value = ?, image_data = ?, is_default = CASE
       WHEN type IN ('taxRate', 'unit') AND ? = 1 THEN 1 ELSE is_default END
     WHERE id = ?`,
    [
      value,
      imageData,
      (type === 'taxRate' || type === 'unit') &&
        (input.isDefault === true || Boolean(row[3]))
        ? 1
        : 0,
      id,
    ]
  );
  saveDatabase();
  return {
    id,
    type,
    value,
    imageData,
    isDefault:
      (type === 'taxRate' || type === 'unit') &&
      (input.isDefault === true || Boolean(row[3])),
  };
}

export async function deleteInventoryOption(id: number): Promise<void> {
  const database = await getDb();
  const result = database.exec(
    'SELECT type, value, is_default FROM inventory_options WHERE id = ?',
    [id]
  );
  const row = result[0]?.values[0];
  if (!row) throw new Error('Inventory option not found.');
  const type = String(row[0]) as InventoryOptionType;
  const value = String(row[1]);
  if ((type === 'taxRate' || type === 'unit') && Boolean(row[2])) {
    const optionName = type === 'taxRate' ? 'tax rate' : 'unit';
    throw new Error(`The default ${optionName} cannot be deleted. Choose another default first.`);
  }
  const productField: Record<InventoryOptionType, string> = {
    category: 'category',
    brand: 'brand',
    taxRate: 'tax_rate',
    unit: 'unit',
  };
  const usage = database.exec(
    `SELECT COUNT(*) FROM products WHERE ${productField[type]} = ?`,
    [type === 'taxRate' ? Number(value) : value]
  );
  if (Number(usage[0]?.values[0]?.[0] || 0) > 0) {
    throw new Error('This option is used by products and cannot be deleted.');
  }
  const remaining = database.exec(
    'SELECT COUNT(*) FROM inventory_options WHERE type = ?',
    [type]
  );
  if (type !== 'brand' && Number(remaining[0]?.values[0]?.[0] || 0) <= 1) {
    throw new Error('Keep at least one option of this type.');
  }
  database.run('DELETE FROM inventory_options WHERE id = ?', [id]);
  saveDatabase();
}

function getDefaultInventoryTaxRate(database: Database): number {
  const configuredRate = Number(
    database.exec(
      `SELECT value FROM inventory_options
       WHERE type = 'taxRate' AND is_default = 1 LIMIT 1`
    )[0]?.values[0]?.[0]
  );
  return Number.isFinite(configuredRate) ? configuredRate : 15;
}

export async function createProduct(
  input: Omit<Product, 'id' | 'updatedAt'>
): Promise<Product> {
  const database = await getDb();
  const now = new Date().toISOString();
  const multiUnits = normalizeProductMultiUnits(input.multiUnits);
  const additionalBarcodes = normalizeProductAdditionalBarcodes(
    input.additionalBarcodes,
    multiUnits
  );
  const barcode = input.barcode.trim();
  validateProductSku(database, null, input.sku);
  validateProductBarcodes(database, null, barcode, multiUnits, additionalBarcodes);

  database.run('BEGIN TRANSACTION');
  let newId: number;
  try {
    database.run(
      `INSERT INTO products (sku, barcode, name, name_ar, category, cost_price, retail_price, tax_rate, stock, reorder_level, unit, updated_at, brand, image_data, image_path, multi_units)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.sku.trim(),
        barcode,
        input.name.trim(),
        (input.nameAr || '').trim(),
        input.category,
        Number(input.costPrice),
        Number(input.retailPrice),
        input.taxRate !== undefined ? Number(input.taxRate) : getDefaultInventoryTaxRate(database),
        Number(input.stock),
        Number(input.reorderLevel),
        input.unit.trim() || 'ea',
        now,
        input.brand || '',
        normalizeProductImageData(input.imageData),
        normalizeProductImagePath(input.imagePath),
        JSON.stringify(multiUnits),
      ]
    );
    newId = Number(database.exec('SELECT last_insert_rowid()')[0].values[0][0]);
    syncProductBarcodes(database, newId, multiUnits, additionalBarcodes);
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
  saveDatabase();

  const created = database.exec(
    `SELECT id, sku, barcode, name, name_ar, category, cost_price, retail_price, stock, reorder_level, unit, updated_at, tax_rate, brand, image_data, image_path, multi_units
     FROM products WHERE id = ?`,
    [newId]
  );
  return {
    ...mapProductRow(created[0].values[0]),
    additionalBarcodes: loadProductAdditionalBarcodes(database, newId),
  };
}

export async function updateProduct(
  id: number,
  input: Partial<Omit<Product, 'id' | 'updatedAt'>>
): Promise<Product | null> {
  const database = await getDb();
  const existingRes = database.exec(
    `SELECT id, sku, barcode, name, name_ar, category, cost_price, retail_price, stock, reorder_level, unit, updated_at, tax_rate, brand, image_data, image_path, multi_units
     FROM products WHERE id = ?`,
    [id]
  );
  if (!existingRes[0]?.values[0]) return null;

  const current = {
    ...mapProductRow(existingRes[0].values[0]),
    additionalBarcodes: loadProductAdditionalBarcodes(database, id),
  };
  const multiUnits = input.multiUnits !== undefined
    ? normalizeProductMultiUnits(input.multiUnits)
    : current.multiUnits || [];
  const additionalBarcodes = input.additionalBarcodes !== undefined
    ? normalizeProductAdditionalBarcodes(input.additionalBarcodes, multiUnits)
    : normalizeProductAdditionalBarcodes(current.additionalBarcodes, multiUnits);
  const barcode = input.barcode !== undefined ? input.barcode.trim() : current.barcode;
  validateProductSku(
    database,
    id,
    input.sku !== undefined ? input.sku : current.sku
  );
  validateProductBarcodes(database, id, barcode, multiUnits, additionalBarcodes);
  const now = new Date().toISOString();

  database.run('BEGIN TRANSACTION');
  try {
    database.run(
      `UPDATE products
       SET sku = ?, barcode = ?, name = ?, name_ar = ?, category = ?, cost_price = ?, retail_price = ?, tax_rate = ?, stock = ?, reorder_level = ?, unit = ?, updated_at = ?, brand = ?, image_data = ?, image_path = ?, multi_units = ?
       WHERE id = ?`,
      [
        input.sku !== undefined ? input.sku.trim() : current.sku,
        barcode,
        input.name !== undefined ? input.name.trim() : current.name,
        input.nameAr !== undefined ? input.nameAr.trim() : (current.nameAr || ''),
        input.category !== undefined ? input.category : current.category,
        input.costPrice !== undefined ? Number(input.costPrice) : current.costPrice,
        input.retailPrice !== undefined ? Number(input.retailPrice) : current.retailPrice,
        input.taxRate !== undefined
          ? Number(input.taxRate)
          : (current.taxRate ?? getDefaultInventoryTaxRate(database)),
        input.stock !== undefined ? Number(input.stock) : current.stock,
        input.reorderLevel !== undefined ? Number(input.reorderLevel) : current.reorderLevel,
        input.unit !== undefined ? input.unit.trim() : current.unit,
        now,
        input.brand !== undefined ? input.brand.trim() : (current.brand || ''),
        input.imageData !== undefined ? normalizeProductImageData(input.imageData) : current.imageData || '',
        input.imagePath !== undefined ? normalizeProductImagePath(input.imagePath) : current.imagePath || '',
        JSON.stringify(multiUnits),
        id,
      ]
    );
    syncProductBarcodes(database, id, multiUnits, additionalBarcodes);
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

  saveDatabase();

  const updatedRes = database.exec(
    `SELECT id, sku, barcode, name, name_ar, category, cost_price, retail_price, stock, reorder_level, unit, updated_at, tax_rate, brand, image_data, image_path, multi_units
     FROM products WHERE id = ?`,
    [id]
  );
  return {
    ...mapProductRow(updatedRes[0].values[0]),
    additionalBarcodes: loadProductAdditionalBarcodes(database, id),
  };
}

export async function adjustProductStock(
  id: number,
  delta: number
): Promise<Product | null> {
  const database = await getDb();
  const existingRes = database.exec(
    `SELECT id, sku, barcode, name, name_ar, category, cost_price, retail_price, stock, reorder_level, unit, updated_at, tax_rate, brand, image_data
     FROM products WHERE id = ?`,
    [id]
  );
  if (!existingRes[0]?.values[0]) return null;

  const current = mapProductRow(existingRes[0].values[0]);
  const nextStock = Math.max(0, current.stock + delta);
  return updateProduct(id, { stock: nextStock });
}

export async function deleteProduct(id: number): Promise<boolean> {
  const database = await getDb();
  if (!Number.isInteger(id) || id <= 0) return false;

  const productRes = database.exec('SELECT 1 FROM products WHERE id = ?', [id]);
  if (!productRes[0]?.values.length) return false;

  const transactionRes = database.exec(
    `SELECT 1 FROM sale_items WHERE product_id = ?
     UNION ALL
     SELECT 1 FROM purchase_items WHERE product_id = ?
     LIMIT 1`,
    [id, id]
  );
  if (transactionRes[0]?.values.length) {
    throw new Error('Cannot delete a product with transaction history.');
  }

  database.run('BEGIN TRANSACTION');
  try {
    database.run('DELETE FROM product_barcodes WHERE product_id = ?', [id]);
    database.run('DELETE FROM products WHERE id = ?', [id]);
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
  saveDatabase();
  return true;
}

export async function getSettings(): Promise<StoreSettings> {
  const database = await getDb();
  const res = database.exec('SELECT key, value FROM settings');
  const map: Record<string, string> = {};
  if (res[0]) {
    for (const row of res[0].values) {
      map[String(row[0])] = String(row[1]);
    }
  }

  const parsedPaymentMethods: unknown = map.paymentMethods
    ? JSON.parse(map.paymentMethods)
    : undefined;
  const configuredPaymentMethods = Array.isArray(parsedPaymentMethods)
    ? parsedPaymentMethods.filter(
        (method): method is string => typeof method === 'string' && method.trim().length > 0
      )
    : [];
  const parsedDisabledComponents: unknown = map.disabledAppComponents
    ? JSON.parse(map.disabledAppComponents)
    : [];
  const disabledAppComponents: AppComponentId[] = Array.isArray(parsedDisabledComponents)
    ? parsedDisabledComponents.filter((component): component is AppComponentId =>
        typeof component === 'string' &&
        APP_COMPONENTS.some((knownComponent) => knownComponent.id === component)
      )
    : [];
  const parsedVersionComponentPolicies: unknown = map.versionComponentPolicies
    ? JSON.parse(map.versionComponentPolicies)
    : {};
  const versionComponentPolicies =
    parseVersionComponentPolicies(parsedVersionComponentPolicies) || {};
  const appVersion =
      APP_VERSIONS.find((version) => version === map.appVersion) || 'Standard';
  const paymentMethods: string[] = [];
  const seenPaymentMethods = new Set<string>();
  for (const method of ['Cash', 'Card', 'Split', ...configuredPaymentMethods]) {
    const name = method.trim();
    const key = name.toLowerCase();
    if (!seenPaymentMethods.has(key)) {
      paymentMethods.push(name);
      seenPaymentMethods.add(key);
    }
  }

  return {
    storeName: map.storeName || 'aptPOS Retail',
    storeNameAr: map.storeNameAr || 'ابت بوس للتجزئة',
    crNumber: map.crNumber || '1010123456',
    address: map.address || 'King Fahd Road, Al Olaya, Riyadh, Saudi Arabia',
    buildingNo: map.buildingNo || '1234',
    streetName: map.streetName || 'King Fahd Rd',
    district: map.district || 'Al Olaya',
    city: map.city || 'Riyadh',
    postalCode: map.postalCode || '12211',
    country: map.country || 'Saudi Arabia',
    phone: map.phone || '+966 11 234 5678',
    taxId: map.taxId || '310123456700003',
    taxRate: Number(map.taxRate ?? 15.0),
    taxType: (map.taxType === 'exclusive' ? 'exclusive' : 'inclusive') as 'inclusive' | 'exclusive',
    currencySymbol: map.currencySymbol || 'SAR',
    receiptFooter: map.receiptFooter || 'Thank you for your business!',
    receiptFooterAr: map.receiptFooterAr || 'شكراً لتسوقكم معنا!',
    paperWidth: (map.paperWidth === 'A4' ? 'A4' : map.paperWidth === '58mm' ? '58mm' : '80mm') as any,
    printerOnline: map.printerOnline !== 'false',
    cashierName: map.cashierName || 'Cashier / الكاشير',
    posScreenLayout: map.posScreenLayout === 'rpos' ? 'rpos' : 'pos',
    barcodeScanBeep: map.barcodeScanBeep !== 'false',
    allowNegativeStock: map.allowNegativeStock === 'true',
    roundTotalToFiveCents: map.roundTotalToFiveCents === 'true',
    autoPrintReceiptOnSale: map.autoPrintReceiptOnSale !== 'false',
    defaultReceiptAction: (map.defaultReceiptAction === 'done' ? 'done' : 'print') as 'print' | 'done',
    decimalPoints: map.decimalPoints !== undefined ? Number(map.decimalPoints) : 2,
    receiptBarcodeEnabled: map.receiptBarcodeEnabled !== 'false',
    enableStockAlertsOnCheckout: map.enableStockAlertsOnCheckout !== 'false',
    defaultCustomer: map.defaultCustomer || 'Walk-in Customer / عميل نقدي',
    paymentMethods,
    kotPrinter: map.kotPrinter || '',
    enableKot: map.enableKot === 'true',
    appLanguage: (map.appLanguage === 'ar' ? 'ar' : 'en') as 'en' | 'ar',
    defaultPrinter: map.defaultPrinter || 'System Default / افتراضي النظام',
    invoiceShowProductName: map.invoiceShowProductName !== 'false',
    invoiceShowProductNameAr: map.invoiceShowProductNameAr !== 'false',
    invoiceShowBarcode: map.invoiceShowBarcode === 'true',
    invoiceShowCustomerInfo: map.invoiceShowCustomerInfo !== 'false',
    invoiceShowCashierName: map.invoiceShowCashierName !== 'false',
    invoiceShowTaxDetails: map.invoiceShowTaxDetails !== 'false',
    invoiceShowStoreAddress: map.invoiceShowStoreAddress !== 'false',
    invoiceShowReceiptBarcode: map.invoiceShowReceiptBarcode !== 'false',
    invoiceShowFooter: map.invoiceShowFooter !== 'false',
    invoiceShowQrCode: map.invoiceShowQrCode !== 'false',
    invoiceTemplates: map.invoiceTemplates ? JSON.parse(map.invoiceTemplates) : undefined,
    appVersion,
    disabledAppComponents,
    versionComponentPolicies,
    registeredSystem: map.registeredSystem === 'true',
  };
}

export async function updateSettings(
  partial: Partial<StoreSettings>
): Promise<StoreSettings> {
  const database = await getDb();
  const stmt = database.prepare(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
  );

  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined) {
      stmt.run([k, typeof v === 'object' ? JSON.stringify(v) : String(v)]);
    }
  }
  stmt.free();
  saveDatabase();
  return getSettings();
}

export async function createInvoiceNumber(): Promise<string> {
  const database = await getDb();
  const now = new Date();
  database.run('INSERT INTO issued_invoice_numbers (created_at) VALUES (?)', [now.toISOString()]);
  const id = Number(database.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  const year = now.getFullYear();
  let sequence = 1000 + id;
  let invoiceNumber: string;
  while (true) {
    invoiceNumber = `RCP-${year}-${sequence}`;
    const existing = database.exec(
      `SELECT 1
       FROM issued_invoice_numbers
       WHERE id <> ? AND invoice_number = ?
       UNION ALL
       SELECT 1 FROM sales WHERE receipt_number = ?
       LIMIT 1`,
      [id, invoiceNumber, invoiceNumber]
    );
    if (!existing[0]?.values.length) break;
    sequence += 1;
  }
  database.run(
    'UPDATE issued_invoice_numbers SET invoice_number = ? WHERE id = ?',
    [invoiceNumber, id]
  );
  saveDatabase();
  return invoiceNumber;
}

export async function listSales(): Promise<Sale[]> {
  const database = await getDb();
  const salesRes = database.exec(
    `SELECT id, receipt_number, created_at, cashier_name, customer_name,
            subtotal, discount_type, discount_value, discount_amount,
            tax_rate, tax_amount, total, payment_method,
            amount_tendered, change_due, status, tax_type
     FROM sales ORDER BY id DESC`
  );

  if (!salesRes[0]) return [];

  const itemsRes = database.exec(
    `SELECT si.id, si.sale_id, si.product_id, si.sku, si.product_name, si.quantity,
            si.unit_price, si.line_total, si.name_ar, si.unit_id, si.unit_name,
            si.units_per_base, si.tax_rate, si.tax_amount, si.discount_amount, p.tax_rate
     FROM sale_items si
     LEFT JOIN products p ON p.id = si.product_id
     ORDER BY si.id ASC`
  );

  const itemsBySale = new Map<number, SaleItem[]>();
  if (itemsRes[0]) {
    for (const row of itemsRes[0].values) {
      const item: SaleItem = {
        id: Number(row[0]),
        saleId: Number(row[1]),
        productId: Number(row[2]),
        sku: String(row[3]),
        productName: String(row[4]),
        quantity: Number(row[5]),
        unitPrice: Number(row[6]),
        lineTotal: Number(row[7]),
        nameAr: row[8] ? String(row[8]) : undefined,
        unitId: row[9] ? String(row[9]) : undefined,
        unitName: row[10] ? String(row[10]) : undefined,
        unitsPerBase: Number(row[11] || 1),
        taxRate: row[12] !== null && row[12] !== undefined
          ? Number(row[12])
          : row[15] !== null && row[15] !== undefined
            ? Number(row[15])
            : undefined,
        taxAmount: row[13] === null || row[13] === undefined ? undefined : Number(row[13]),
        discountAmount: row[14] === null || row[14] === undefined ? undefined : Number(row[14]),
      };
      const list = itemsBySale.get(item.saleId) || [];
      list.push(item);
      itemsBySale.set(item.saleId, list);
    }
  }

  const returnedQuantitiesRes = database.exec(
    `SELECT sale_item_id, SUM(returned_quantity)
     FROM sale_return_items GROUP BY sale_item_id`
  );
  const returnedQuantities = new Map<number, number>();
  for (const row of returnedQuantitiesRes[0]?.values || []) {
    returnedQuantities.set(Number(row[0]), Number(row[1]));
  }
  for (const items of itemsBySale.values()) {
    for (const item of items) {
      item.returnedQuantity = returnedQuantities.get(item.id) || 0;
    }
  }

  const returnTotalsRes = database.exec(
    `SELECT sale_id, SUM(refund_amount), SUM(tax_refund_amount)
     FROM sale_returns GROUP BY sale_id`
  );
  const returnTotals = new Map<number, number>();
  const returnTaxTotals = new Map<number, number>();
  for (const row of returnTotalsRes[0]?.values || []) {
    returnTotals.set(Number(row[0]), Number(row[1]));
    returnTaxTotals.set(Number(row[0]), Number(row[2]));
  }

  const returnPaymentsRes = database.exec(
    `SELECT DISTINCT sale_id, payment_method FROM sale_returns`
  );
  const returnPaymentMethods = new Map<number, PaymentMethod[]>();
  for (const row of returnPaymentsRes[0]?.values || []) {
    const saleId = Number(row[0]);
    const method = String(row[1] || '').trim();
    if (!method) continue;
    const methods = returnPaymentMethods.get(saleId) || [];
    methods.push(method);
    returnPaymentMethods.set(saleId, methods);
  }

  return salesRes[0].values.map((row) => {
    const id = Number(row[0]);
    const items = itemsBySale.get(id) || [];
    const returnedQuantity = items.reduce((sum, item) => sum + (item.returnedQuantity || 0), 0);
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    return {
      id,
      receiptNumber: String(row[1]),
      createdAt: String(row[2]),
      cashierName: String(row[3]),
      customerName: String(row[4]),
      subtotal: Number(row[5]),
      discountType: String(row[6]) === 'percent' ? 'percent' : 'fixed',
      discountValue: Number(row[7]),
      discountAmount: Number(row[8]),
      taxRate: Number(row[9]),
      taxType: row[16] === 'inclusive' || row[16] === 'exclusive'
        ? String(row[16]) as 'inclusive' | 'exclusive'
        : undefined,
      taxAmount: Number(row[10]),
      total: Number(row[11]),
      paymentMethod: String(row[12]) as PaymentMethod,
      amountTendered: Number(row[13]),
      changeDue: Number(row[14]),
      status: String(row[15]) === 'VOIDED' ? 'VOIDED' : 'COMPLETED',
      kotNumber: getKotNumberFromInvoice(String(row[1])),
      returnStatus:
        returnedQuantity === 0
          ? undefined
          : returnedQuantity >= totalQuantity
            ? 'FULL'
            : 'PARTIAL',
      returnedTotal: returnTotals.get(id) || 0,
      returnedTaxAmount: returnTaxTotals.get(id) || 0,
      returnPaymentMethods: returnPaymentMethods.get(id) || [],
      items,
    };
  });
}

export interface CreateSaleInput {
  customerName?: string;
  invoiceNumber?: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
  paymentMethod: PaymentMethod;
  amountTendered: number;
  items: Array<{
    productId: number;
    quantity: number;
    unitId?: string;
    unitPrice?: number;
  }>;
}

export async function createSale(input: CreateSaleInput): Promise<{
  sale: Sale;
  queuedOfflinePrint: boolean;
}> {
  const database = await getDb();
  const settings = await getSettings();

  if (!input.items || input.items.length === 0) {
    throw new Error('Cart cannot be empty.');
  }

  const resolvedItems: Array<{
    product: Product;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    unitId: string;
    unitName: string;
    unitsPerBase: number;
    taxRate: number;
  }> = [];

  for (const reqItem of input.items) {
    const prodRes = database.exec(
      `SELECT id, sku, barcode, name, name_ar, category, cost_price, retail_price, stock, reorder_level, unit, updated_at, tax_rate, brand, image_data, image_path, multi_units
       FROM products WHERE id = ?`,
      [reqItem.productId]
    );
    if (!prodRes[0]?.values[0]) {
      throw new Error(`Product #${reqItem.productId} not found.`);
    }
    const product = mapProductRow(prodRes[0].values[0]);
    if (!Number.isFinite(reqItem.quantity) || reqItem.quantity <= 0) {
      throw new Error(`Invalid quantity for ${product.name}.`);
    }
    const multiUnit = reqItem.unitId
      ? product.multiUnits?.find((unit) => unit.id === reqItem.unitId)
      : undefined;
    if (reqItem.unitId && !multiUnit) {
      throw new Error(`The selected unit is not configured for ${product.name}.`);
    }
    if (multiUnit && !Number.isInteger(reqItem.quantity)) {
      throw new Error(`Quantity for ${multiUnit.name} must be a whole number.`);
    }
    const unitsPerBase = multiUnit?.unitsPerBase ?? 1;
    const defaultUnitPrice = multiUnit
      ? multiUnit.price ?? product.retailPrice * unitsPerBase
      : product.retailPrice;
    const unitPrice =
      reqItem.unitPrice !== undefined && reqItem.unitPrice >= 0
        ? Number(reqItem.unitPrice)
        : defaultUnitPrice;
    const lineTotal = Number((unitPrice * reqItem.quantity).toFixed(2));
    resolvedItems.push({
      product,
      quantity: reqItem.quantity,
      unitPrice,
      lineTotal,
      unitId: multiUnit?.id || '',
      unitName: multiUnit?.name || product.unit,
      unitsPerBase,
      taxRate: product.taxRate ?? getDefaultInventoryTaxRate(database),
    });
  }

  const grossTotal = Number(
    resolvedItems.reduce((acc, item) => acc + item.lineTotal, 0).toFixed(2)
  );

  let discountAmount = 0;
  if (input.discountValue > 0) {
    if (input.discountType === 'percent') {
      discountAmount = Number(
        ((grossTotal * Math.min(100, input.discountValue)) / 100).toFixed(2)
      );
    } else {
      discountAmount = Number(Math.min(grossTotal, input.discountValue).toFixed(2));
    }
  }

  const taxBreakdown = calculateSalesTax(
    resolvedItems.map((item) => ({ amount: item.lineTotal, taxRate: item.taxRate })),
    discountAmount,
    settings.taxType
  );
  const { subtotal, taxAmount } = taxBreakdown;
  const totalTaxRates = [...new Set(resolvedItems.map((item) => item.taxRate))];
  const saleTaxRate = totalTaxRates.length === 1 ? totalTaxRates[0] : 0;
  let total = taxBreakdown.total;

  if (settings.roundTotalToFiveCents) {
    total = Number((Math.round(total * 20) / 20).toFixed(2));
  }

  const amountTendered =
    input.paymentMethod === 'Cash'
      ? Math.max(total, Number(input.amountTendered || total))
      : total;
  const changeDue =
    input.paymentMethod === 'Cash'
      ? Number(Math.max(0, amountTendered - total).toFixed(2))
      : 0;

  const now = new Date().toISOString();
  const requestedInvoiceNumber =
    typeof input.invoiceNumber === 'string' ? input.invoiceNumber.trim() : '';
  const customerName = (input.customerName || '').trim() || 'Walk-in Customer';
  const discountValue = Number(input.discountValue || 0);
  let receiptNumber = requestedInvoiceNumber;
  if (receiptNumber) {
    const issuedNumber = database.exec(
      'SELECT id FROM issued_invoice_numbers WHERE invoice_number = ?',
      [receiptNumber]
    );
    if (!issuedNumber[0]?.values[0]) {
      throw new Error('The invoice number is invalid or has not been issued.');
    }
    const existingSale = database.exec(
      `SELECT id, customer_name, subtotal, discount_type, discount_value, discount_amount,
              tax_rate, tax_amount, total, payment_method, amount_tendered, change_due, status, tax_type
       FROM sales WHERE receipt_number = ?`,
      [receiptNumber]
    );
    if (existingSale[0]?.values[0]) {
      const row = existingSale[0].values[0];
      const saleId = Number(row[0]);
      const existingItems = database.exec(
        'SELECT product_id, quantity, unit_price, unit_id, units_per_base, tax_rate FROM sale_items WHERE sale_id = ? ORDER BY id ASC',
        [saleId]
      )[0]?.values || [];
      const sameItems =
        existingItems.length === resolvedItems.length &&
        resolvedItems.every((item, index) => {
          const existingItem = existingItems[index];
          return (
            Number(existingItem[0]) === item.product.id &&
            Number(existingItem[1]) === item.quantity &&
            Math.abs(Number(existingItem[2]) - item.unitPrice) < 0.005 &&
            String(existingItem[3] || '') === item.unitId &&
            Number(existingItem[4] || 1) === item.unitsPerBase &&
            Number(existingItem[5]) === item.taxRate
          );
        });
      const sameRequest =
        String(row[1]) === customerName &&
        Number(row[2]) === subtotal &&
        String(row[3]) === input.discountType &&
        Number(row[4]) === discountValue &&
        Number(row[5]) === discountAmount &&
        Number(row[6]) === saleTaxRate &&
        Number(row[7]) === taxAmount &&
        Number(row[8]) === total &&
        String(row[9]) === input.paymentMethod &&
        Number(row[10]) === amountTendered &&
        Number(row[11]) === changeDue &&
        String(row[12]) === 'COMPLETED' &&
        String(row[13]) === settings.taxType &&
        sameItems;
      if (sameRequest) {
        const sale = (await listSales()).find((entry) => entry.id === saleId);
        if (!sale) {
          throw new Error(`Invoice ${receiptNumber} was saved, but could not be loaded.`);
        }
        return { sale, queuedOfflinePrint: false };
      }
      throw new Error('This invoice number has already been used. Please issue a new invoice number and try again.');
    }
  }

  if (!settings.allowNegativeStock) {
    const requestedBaseUnits = new Map<number, number>();
    for (const item of resolvedItems) {
      requestedBaseUnits.set(
        item.product.id,
        (requestedBaseUnits.get(item.product.id) || 0) + item.quantity * item.unitsPerBase
      );
    }
    for (const [productId, requestedUnits] of requestedBaseUnits) {
      const product = resolvedItems.find((item) => item.product.id === productId)?.product;
      if (product && product.stock < requestedUnits) {
        throw new Error(
          `Insufficient stock for ${product.name} (${product.stock} base units available).`
        );
      }
    }
  }

  if (!receiptNumber) receiptNumber = await createInvoiceNumber();
  const kotNumber = getKotNumberFromInvoice(receiptNumber);

  database.run(
    `INSERT INTO sales (
      receipt_number, created_at, cashier_name, customer_name,
      subtotal, discount_type, discount_value, discount_amount,
      tax_rate, tax_type, tax_amount, total, payment_method,
      amount_tendered, change_due, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED')`,
    [
      receiptNumber,
      now,
      settings.cashierName,
      customerName,
      subtotal,
      input.discountType,
      discountValue,
      discountAmount,
      saleTaxRate,
      settings.taxType,
      taxAmount,
      total,
      input.paymentMethod,
      amountTendered,
      changeDue,
    ]
  );

  const idRes = database.exec('SELECT last_insert_rowid()');
  const saleId = Number(idRes[0].values[0][0]);

  const saleItems: SaleItem[] = [];
  for (const [itemIndex, item] of resolvedItems.entries()) {
    const taxLine = taxBreakdown.lines[itemIndex];
    database.run(
      `INSERT INTO sale_items (
         sale_id, product_id, sku, product_name, quantity, unit_price, line_total, name_ar,
         unit_id, unit_name, units_per_base, tax_rate, tax_amount, discount_amount
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        saleId,
        item.product.id,
        item.product.sku,
        item.product.name,
        item.quantity,
        item.unitPrice,
        item.lineTotal,
        item.product.nameAr ?? '',
        item.unitId,
        item.unitName,
        item.unitsPerBase,
        item.taxRate,
        taxLine.taxAmount,
        taxLine.discountAmount,
      ]
    );
    const itemIdRes = database.exec('SELECT last_insert_rowid()');
    saleItems.push({
      id: Number(itemIdRes[0].values[0][0]),
      saleId,
      productId: item.product.id,
      sku: item.product.sku,
      productName: item.product.name,
      nameAr: item.product.nameAr,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      unitId: item.unitId || undefined,
      unitName: item.unitName,
      unitsPerBase: item.unitsPerBase,
      taxRate: item.taxRate,
      taxAmount: taxLine.taxAmount,
      discountAmount: taxLine.discountAmount,
    });

    database.run('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?', [
      item.quantity * item.unitsPerBase,
      now,
      item.product.id,
    ]);
  }

  let queuedOfflinePrint = false;
  if (!settings.printerOnline) {
    database.run(
      `INSERT INTO print_queue (sale_id, receipt_number, created_at, total, status)
       VALUES (?, ?, ?, ?, 'QUEUED')`,
      [saleId, receiptNumber, now, total]
    );
    queuedOfflinePrint = true;
  }

  saveDatabase();

  const sale: Sale = {
    id: saleId,
    receiptNumber,
    kotNumber,
    createdAt: now,
    cashierName: settings.cashierName,
    customerName,
    subtotal,
    discountType: input.discountType,
    discountValue,
    discountAmount,
    taxType: settings.taxType,
    taxRate: saleTaxRate,
    taxAmount,
    total,
    paymentMethod: input.paymentMethod,
    amountTendered,
    changeDue,
    status: 'COMPLETED',
    items: saleItems,
  };

  return { sale, queuedOfflinePrint };
}

export async function voidSale(saleId: number): Promise<Sale | null> {
  const database = await getDb();
  const sales = await listSales();
  const target = sales.find((s) => s.id === saleId);
  if (!target) return null;
  if (target.status === 'VOIDED') return target;
  if (target.returnStatus) throw new Error('Sales with returns cannot be voided.');

  const now = new Date().toISOString();
  database.run("UPDATE sales SET status = 'VOIDED' WHERE id = ?", [saleId]);

  for (const item of target.items) {
    database.run('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?', [
      item.quantity * (item.unitsPerBase || 1),
      now,
      item.productId,
    ]);
  }

  saveDatabase();
  const updated = await listSales();
  return updated.find((s) => s.id === saleId) || null;
}

export async function listSalesReturnVouchers(): Promise<SalesReturnVoucher[]> {
  const database = await getDb();
  const vouchersRes = database.exec(
    `SELECT id, voucher_number, created_at, cashier_name, payment_method,
            refund_amount, tax_refund_amount
     FROM sales_return_vouchers ORDER BY id DESC`
  );
  if (!vouchersRes[0]) return [];

  const itemsRes = database.exec(
    `SELECT r.voucher_id, s.id, s.receipt_number, si.id, si.product_name, si.name_ar,
            si.sku, ri.returned_quantity, ri.refund_amount, si.unit_name
     FROM sale_returns r
     JOIN sales s ON s.id = r.sale_id
     JOIN sale_return_items ri ON ri.return_id = r.id
     JOIN sale_items si ON si.id = ri.sale_item_id
     ORDER BY r.id DESC, ri.id ASC`
  );
  const itemsByVoucher = new Map<number, SalesReturnVoucher['items']>();
  const invoicesByVoucher = new Map<number, string[]>();
  for (const row of itemsRes[0]?.values || []) {
    const voucherId = Number(row[0]);
    const receiptNumber = String(row[2]);
    const items = itemsByVoucher.get(voucherId) || [];
    items.push({
      saleId: Number(row[1]),
      receiptNumber,
      saleItemId: Number(row[3]),
      productName: String(row[4]),
      nameAr: row[5] ? String(row[5]) : undefined,
      sku: String(row[6]),
      quantity: Number(row[7]),
      refundAmount: Number(row[8]),
      unitName: row[9] ? String(row[9]) : undefined,
    });
    itemsByVoucher.set(voucherId, items);
    const invoices = invoicesByVoucher.get(voucherId) || [];
    if (!invoices.includes(receiptNumber)) invoices.push(receiptNumber);
    invoicesByVoucher.set(voucherId, invoices);
  }

  return vouchersRes[0].values.map((row) => ({
    id: Number(row[0]),
    voucherNumber: String(row[1]),
    createdAt: String(row[2]),
    cashierName: String(row[3]),
    paymentMethod: String(row[4]) as PaymentMethod,
    refundAmount: Number(row[5]),
    taxRefundAmount: Number(row[6]),
    sourceInvoices: invoicesByVoucher.get(Number(row[0])) || [],
    items: itemsByVoucher.get(Number(row[0])) || [],
  }));
}

interface ValidatedSalesReturn {
  sale: Sale;
  requestedItems: Array<{ saleItemId: number; quantity: number }>;
  refund: ReturnType<typeof calculateSaleReturnRefund>;
  taxRefundAmount: number;
}

function validateSalesReturnEntries(
  requestedSales: CreateSalesReturnVoucherInput['sales'],
  allSales: Sale[]
): ValidatedSalesReturn[] {
  if (!Array.isArray(requestedSales) || requestedSales.length === 0) {
    throw new Error('Add at least one sales invoice to this return voucher.');
  }

  const selectedSaleIds = new Set<number>();
  const validatedSales: ValidatedSalesReturn[] = [];

  for (const requestedSale of requestedSales) {
    if (!Number.isInteger(requestedSale.saleId) || requestedSale.saleId <= 0) {
      throw new Error('Invalid sales invoice ID.');
    }
    if (selectedSaleIds.has(requestedSale.saleId)) {
      throw new Error('Each sales invoice can only be added once to a return voucher.');
    }
    selectedSaleIds.add(requestedSale.saleId);
    const sale = allSales.find((entry) => entry.id === requestedSale.saleId);
    if (!sale) throw new Error(`Sales invoice #${requestedSale.saleId} was not found.`);
    if (sale.status !== 'COMPLETED') {
      throw new Error(`${sale.receiptNumber} is not a completed sale.`);
    }
    if (!Array.isArray(requestedSale.items) || requestedSale.items.length === 0) {
      throw new Error(`Select at least one item from ${sale.receiptNumber}.`);
    }

    const requestedByItem = new Map<number, number>();
    for (const requested of requestedSale.items) {
      if (
        !Number.isInteger(requested.saleItemId) ||
        requested.saleItemId <= 0 ||
        !Number.isInteger(requested.quantity) ||
        requested.quantity <= 0
      ) {
        throw new Error('Return quantities must be positive whole numbers.');
      }
      if (requestedByItem.has(requested.saleItemId)) {
        throw new Error('Each sale item can only be listed once per return.');
      }

      const item = sale.items.find((saleItem) => saleItem.id === requested.saleItemId);
      if (!item) throw new Error(`A selected item does not belong to ${sale.receiptNumber}.`);
      const remaining = item.quantity - (item.returnedQuantity || 0);
      if (requested.quantity > remaining) {
        throw new Error(`Only ${remaining} of ${item.productName} can still be returned.`);
      }
      requestedByItem.set(requested.saleItemId, requested.quantity);
    }

    const requestedItems = Array.from(requestedByItem, ([saleItemId, quantity]) => ({
      saleItemId,
      quantity,
    }));
    const refund = calculateSaleReturnRefund(sale, requestedItems, sale.returnedTotal || 0);
    const completesSale = sale.items.every((item) => {
      const requestedQuantity = requestedByItem.get(item.id) || 0;
      return (item.returnedQuantity || 0) + requestedQuantity >= item.quantity;
    });
    const remainingTax = Math.max(0, sale.taxAmount - (sale.returnedTaxAmount || 0));
    const hasItemTaxBreakdown = requestedItems.every((requested) =>
      sale.items.find((item) => item.id === requested.saleItemId)?.taxAmount !== undefined
    );
    const estimatedTaxRefund = hasItemTaxBreakdown
      ? Number(requestedItems.reduce((sum, requested) => {
          const item = sale.items.find((entry) => entry.id === requested.saleItemId);
          return sum + (item && item.quantity > 0
            ? (item.taxAmount! * requested.quantity) / item.quantity
            : 0);
        }, 0).toFixed(2))
      : sale.total > 0
        ? Number(((sale.taxAmount * refund.total) / sale.total).toFixed(2))
        : 0;
    const taxRefundAmount = Number(
      Math.min(remainingTax, completesSale ? remainingTax : estimatedTaxRefund).toFixed(2)
    );
    validatedSales.push({ sale, requestedItems, refund, taxRefundAmount });
  }

  return validatedSales;
}

export async function createSalesReturnVoucher(
  input: CreateSalesReturnVoucherInput
): Promise<{ voucher: SalesReturnVoucher; sales: Sale[] } | null> {
  if (!input || typeof input !== 'object') throw new Error('Return details are required.');
  if (typeof input.cashierName !== 'string' || !input.cashierName.trim()) {
    throw new Error('Cashier name is required.');
  }
  const settings = await getSettings();
  const allowedPaymentMethods = settings.paymentMethods || ['Cash', 'Card', 'Split'];
  if (!allowedPaymentMethods.includes(input.paymentMethod)) {
    throw new Error('Invalid refund payment method.');
  }

  const database = await getDb();
  const allSales = await listSales();
  const validatedSales = validateSalesReturnEntries(input.sales, allSales);
  const now = new Date().toISOString();
  const totalRefund = Number(
    validatedSales.reduce((sum, entry) => sum + entry.refund.total, 0).toFixed(2)
  );
  const totalTaxRefund = Number(
    validatedSales.reduce((sum, entry) => sum + entry.taxRefundAmount, 0).toFixed(2)
  );
  const year = new Date(now).getFullYear();
  const voucherPrefix = 'SR-';
  let voucherNumber = '';

  database.run('BEGIN');
  try {
    database.run(
      `INSERT INTO sales_return_vouchers
         (voucher_number, created_at, cashier_name, payment_method, refund_amount, tax_refund_amount)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [`${voucherPrefix}${year}-${Date.now()}`, now, input.cashierName.trim(), input.paymentMethod, totalRefund, totalTaxRefund]
    );
    const voucherId = Number(database.exec('SELECT last_insert_rowid()')[0].values[0][0]);
    voucherNumber = `${voucherPrefix}${year}-${String(voucherId).padStart(6, '0')}`;
    database.run('UPDATE sales_return_vouchers SET voucher_number = ? WHERE id = ?', [
      voucherNumber,
      voucherId,
    ]);

    for (const entry of validatedSales) {
      database.run(
        `INSERT INTO sale_returns
           (sale_id, voucher_id, created_at, cashier_name, refund_amount, tax_refund_amount, payment_method)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.sale.id,
          voucherId,
          now,
          input.cashierName.trim(),
          entry.refund.total,
          entry.taxRefundAmount,
          input.paymentMethod,
        ]
      );
      const returnId = Number(database.exec('SELECT last_insert_rowid()')[0].values[0][0]);
      const allocationByItem = new Map(
        entry.refund.allocations.map((allocation) => [allocation.saleItemId, allocation])
      );

      for (const requested of entry.requestedItems) {
        const item = entry.sale.items.find((saleItem) => saleItem.id === requested.saleItemId);
        const allocation = allocationByItem.get(requested.saleItemId);
        if (!item || !allocation) throw new Error('Could not calculate the item refund.');

        database.run(
          `INSERT INTO sale_return_items
             (return_id, sale_item_id, product_id, returned_quantity, refund_amount)
           VALUES (?, ?, ?, ?, ?)`,
          [returnId, item.id, item.productId, requested.quantity, allocation.refundAmount]
        );
        database.run('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?', [
          requested.quantity * (item.unitsPerBase || 1),
          now,
          item.productId,
        ]);
      }
    }
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

  saveDatabase();
  const voucher = (await listSalesReturnVouchers()).find((entry) => entry.voucherNumber === voucherNumber);
  if (!voucher) throw new Error('Return voucher was saved, but could not be loaded.');
  const updatedSales = await listSales();
  return { voucher, sales: updatedSales };
}

export async function updateSalesReturnVoucher(
  voucherId: number,
  input: Pick<CreateSalesReturnVoucherInput, 'paymentMethod' | 'sales'>
): Promise<{ voucher: SalesReturnVoucher; sales: Sale[] } | null> {
  if (!Number.isInteger(voucherId) || voucherId <= 0) {
    throw new Error('Invalid return voucher ID.');
  }
  if (!input) {
    throw new Error('Invalid refund payment method.');
  }
  const allowedPaymentMethods = (await getSettings()).paymentMethods || ['Cash', 'Card', 'Split'];
  if (!allowedPaymentMethods.includes(input.paymentMethod)) {
    throw new Error('Invalid refund payment method.');
  }

  const database = await getDb();
  const existingVoucher = (await listSalesReturnVouchers()).find((voucher) => voucher.id === voucherId);
  if (!existingVoucher) return null;

  const returnRows = database.exec(
    `SELECT sale_id, refund_amount, tax_refund_amount
     FROM sale_returns WHERE voucher_id = ?`,
    [voucherId]
  )[0]?.values || [];
  const refundBySale = new Map<number, number>();
  const taxRefundBySale = new Map<number, number>();
  for (const row of returnRows) {
    const saleId = Number(row[0]);
    refundBySale.set(saleId, (refundBySale.get(saleId) || 0) + Number(row[1]));
    taxRefundBySale.set(saleId, (taxRefundBySale.get(saleId) || 0) + Number(row[2]));
  }

  const quantitiesByItem = new Map<number, number>();
  for (const item of existingVoucher.items) {
    quantitiesByItem.set(
      item.saleItemId,
      (quantitiesByItem.get(item.saleItemId) || 0) + item.quantity
    );
  }

  const allSales = await listSales();
  const salesWithoutVoucher = allSales.map((sale) => ({
    ...sale,
    returnedTotal: Math.max(0, (sale.returnedTotal || 0) - (refundBySale.get(sale.id) || 0)),
    returnedTaxAmount: Math.max(
      0,
      (sale.returnedTaxAmount || 0) - (taxRefundBySale.get(sale.id) || 0)
    ),
    items: sale.items.map((item) => ({
      ...item,
      returnedQuantity: Math.max(
        0,
        (item.returnedQuantity || 0) - (quantitiesByItem.get(item.id) || 0)
      ),
    })),
  }));
  const validatedSales = validateSalesReturnEntries(input.sales, salesWithoutVoucher);

  const saleItemsById = new Map(
    allSales.flatMap((sale) => sale.items.map((item) => [item.id, item] as const))
  );
  const stockChanges = new Map<number, number>();
  const previousStockRows = database.exec(
    `SELECT ri.product_id, SUM(ri.returned_quantity * si.units_per_base)
     FROM sale_return_items ri
     JOIN sale_items si ON si.id = ri.sale_item_id
     WHERE ri.return_id IN (SELECT id FROM sale_returns WHERE voucher_id = ?)
     GROUP BY ri.product_id`,
    [voucherId]
  )[0]?.values || [];
  for (const row of previousStockRows) {
    const productId = Number(row[0]);
    stockChanges.set(
      productId,
      (stockChanges.get(productId) || 0) - Number(row[1])
    );
  }
  for (const entry of validatedSales) {
    for (const requested of entry.requestedItems) {
      const saleItem = saleItemsById.get(requested.saleItemId);
      if (!saleItem) throw new Error(`Could not find returned item ${requested.saleItemId}.`);
      stockChanges.set(
        saleItem.productId,
        (stockChanges.get(saleItem.productId) || 0) +
          requested.quantity * (saleItem.unitsPerBase || 1)
      );
    }
  }

  const now = new Date().toISOString();
  for (const [productId, delta] of stockChanges) {
    if (delta === 0) continue;
    const productRes = database.exec('SELECT stock FROM products WHERE id = ?', [productId]);
    const stock = productRes[0]?.values[0] ? Number(productRes[0].values[0][0]) : null;
    if (stock === null) throw new Error('A returned product no longer exists.');
    if (delta < 0 && stock + delta < 0) {
      throw new Error('Cannot reduce this return because some returned stock is no longer available.');
    }
  }

  const totalRefund = Number(
    validatedSales.reduce((sum, entry) => sum + entry.refund.total, 0).toFixed(2)
  );
  const totalTaxRefund = Number(
    validatedSales.reduce((sum, entry) => sum + entry.taxRefundAmount, 0).toFixed(2)
  );

  database.run('BEGIN');
  try {
    database.run(
      'DELETE FROM sale_return_items WHERE return_id IN (SELECT id FROM sale_returns WHERE voucher_id = ?)',
      [voucherId]
    );
    database.run('DELETE FROM sale_returns WHERE voucher_id = ?', [voucherId]);

    for (const entry of validatedSales) {
      database.run(
        `INSERT INTO sale_returns
           (sale_id, voucher_id, created_at, cashier_name, refund_amount, tax_refund_amount, payment_method)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.sale.id,
          voucherId,
          existingVoucher.createdAt,
          existingVoucher.cashierName,
          entry.refund.total,
          entry.taxRefundAmount,
          input.paymentMethod,
        ]
      );
      const returnId = Number(database.exec('SELECT last_insert_rowid()')[0].values[0][0]);
      const allocationByItem = new Map(
        entry.refund.allocations.map((allocation) => [allocation.saleItemId, allocation])
      );
      for (const requested of entry.requestedItems) {
        const saleItem = entry.sale.items.find((item) => item.id === requested.saleItemId);
        const allocation = allocationByItem.get(requested.saleItemId);
        if (!saleItem || !allocation) throw new Error('Could not calculate the item refund.');
        database.run(
          `INSERT INTO sale_return_items
             (return_id, sale_item_id, product_id, returned_quantity, refund_amount)
           VALUES (?, ?, ?, ?, ?)`,
          [
            returnId,
            saleItem.id,
            saleItem.productId,
            requested.quantity,
            allocation.refundAmount,
          ]
        );
      }
    }

    for (const [productId, delta] of stockChanges) {
      if (delta !== 0) {
        database.run('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?', [
          delta,
          now,
          productId,
        ]);
      }
    }
    database.run(
      `UPDATE sales_return_vouchers
       SET payment_method = ?, refund_amount = ?, tax_refund_amount = ?
       WHERE id = ?`,
      [input.paymentMethod, totalRefund, totalTaxRefund, voucherId]
    );
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

  saveDatabase();
  const voucher = (await listSalesReturnVouchers()).find((entry) => entry.id === voucherId);
  if (!voucher) throw new Error('Return voucher was updated, but could not be loaded.');
  return { voucher, sales: await listSales() };
}

export async function deleteSalesReturnVoucher(voucherId: number): Promise<boolean> {
  if (!Number.isInteger(voucherId) || voucherId <= 0) {
    throw new Error('Invalid return voucher ID.');
  }

  const database = await getDb();
  const voucherRes = database.exec('SELECT id FROM sales_return_vouchers WHERE id = ?', [voucherId]);
  if (!voucherRes[0]?.values[0]) return false;

  const returnedItems = database.exec(
    `SELECT ri.product_id, SUM(ri.returned_quantity * si.units_per_base)
     FROM sale_return_items ri
     JOIN sale_items si ON si.id = ri.sale_item_id
     WHERE ri.return_id IN (SELECT id FROM sale_returns WHERE voucher_id = ?)
     GROUP BY ri.product_id`,
    [voucherId]
  )[0]?.values || [];
  const now = new Date().toISOString();

  database.run('BEGIN');
  try {
    for (const row of returnedItems) {
      const productId = Number(row[0]);
      const quantity = Number(row[1]);
      const productRes = database.exec('SELECT stock FROM products WHERE id = ?', [productId]);
      const stock = productRes[0]?.values[0] ? Number(productRes[0].values[0][0]) : null;
      if (stock === null) throw new Error('A returned product no longer exists.');
      if (stock < quantity) {
        throw new Error('Cannot delete this return because some returned stock is no longer available.');
      }
      database.run('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?', [
        quantity,
        now,
        productId,
      ]);
    }
    database.run(
      'DELETE FROM sale_return_items WHERE return_id IN (SELECT id FROM sale_returns WHERE voucher_id = ?)',
      [voucherId]
    );
    database.run('DELETE FROM sale_returns WHERE voucher_id = ?', [voucherId]);
    database.run('DELETE FROM sales_return_vouchers WHERE id = ?', [voucherId]);
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

  saveDatabase();
  return true;
}

export async function createSaleReturn(
  saleId: number,
  input: CreateSaleReturnInput
): Promise<{ sale: Sale; refundAmount: number } | null> {
  if (!Number.isInteger(saleId) || saleId <= 0) throw new Error('Invalid sale ID.');
  const result = await createSalesReturnVoucher({
    cashierName: input.cashierName,
    paymentMethod: input.paymentMethod,
    sales: [{ saleId, items: input.items }],
  });
  if (!result) return null;
  const sale = result.sales.find((entry) => entry.id === saleId);
  if (!sale) throw new Error('Return was saved, but the updated sale could not be loaded.');
  return { sale, refundAmount: result.voucher.refundAmount };
}

function isValidCashbookDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export async function getCashbookData(): Promise<{
  entries: CashbookEntry[];
  openingBalance: CashbookOpeningBalance | null;
}> {
  const database = await getDb();
  const entriesRes = database.exec(
    `SELECT id, entry_date, direction, category, payment_type, account_name, description, amount, reference, created_by, created_at
     FROM cashbook_entries ORDER BY entry_date DESC, id DESC`
  );
  const openingRes = database.exec(
    'SELECT entry_date, amount FROM cashbook_opening_balance WHERE id = 1'
  );
  return {
    entries: (entriesRes[0]?.values || []).map((row) => ({
      id: Number(row[0]),
      entryDate: String(row[1]),
      direction: String(row[2]) as 'IN' | 'OUT',
      category: String(row[3]),
      paymentType: row[4] ? String(row[4]).toUpperCase() as 'CASH' | 'BANK' : undefined,
      accountName: row[5] ? String(row[5]) : undefined,
      description: String(row[6]),
      amount: Number(row[7]),
      reference: String(row[8]),
      createdBy: String(row[9]),
      createdAt: String(row[10]),
    })),
    openingBalance: openingRes[0]?.values[0]
      ? {
          entryDate: String(openingRes[0].values[0][0]),
          amount: Number(openingRes[0].values[0][1]),
        }
      : null,
  };
}

export async function createCashbookEntry(
  input: CreateCashbookEntryInput
): Promise<CashbookEntry> {
  if (!input || !isValidCashbookDate(input.entryDate)) {
    throw new Error('A valid cashbook entry date is required.');
  }
  if (input.direction !== 'IN' && input.direction !== 'OUT') {
    throw new Error('Cashbook entry direction must be IN or OUT.');
  }
  if (typeof input.category !== 'string' || !input.category.trim()) {
    throw new Error('Cashbook category is required.');
  }
  if (typeof input.description !== 'string' || !input.description.trim()) {
    throw new Error('Cashbook description is required.');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Cashbook amount must be greater than zero.');
  }
  const amount = Number(input.amount.toFixed(2));
  if (amount <= 0) {
    throw new Error('Cashbook amount must be at least 0.01.');
  }
  if (input.reference !== undefined && typeof input.reference !== 'string') {
    throw new Error('Cashbook reference must be text.');
  }
  if (typeof input.createdBy !== 'string' || !input.createdBy.trim()) {
    throw new Error('Cashbook user is required.');
  }

  const database = await getDb();
  const createdAt = new Date().toISOString();
  database.run(
    `INSERT INTO cashbook_entries
       (entry_date, direction, category, payment_type, account_name, description, amount, reference, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.entryDate,
      input.direction,
      input.category.trim(),
      input.paymentType || null,
      input.accountName || null,
      input.description.trim(),
      amount,
      (input.reference || '').trim(),
      input.createdBy.trim(),
      createdAt,
    ]
  );
  const id = Number(database.exec('SELECT last_insert_rowid()')[0].values[0][0]);
  saveDatabase();
  return {
    id,
    entryDate: input.entryDate,
    direction: input.direction,
    category: input.category.trim(),
    paymentType: input.paymentType,
    accountName: input.accountName,
    description: input.description.trim(),
    amount,
    reference: (input.reference || '').trim(),
    createdBy: input.createdBy.trim(),
    createdAt,
  };
}

export async function setCashbookOpeningBalance(
  openingBalance: CashbookOpeningBalance
): Promise<CashbookOpeningBalance> {
  if (!openingBalance || !isValidCashbookDate(openingBalance.entryDate)) {
    throw new Error('A valid opening balance date is required.');
  }
  if (!Number.isFinite(openingBalance.amount) || openingBalance.amount < 0) {
    throw new Error('Opening balance cannot be negative.');
  }

  const database = await getDb();
  const amount = Number(openingBalance.amount.toFixed(2));
  database.run(
    `INSERT INTO cashbook_opening_balance (id, entry_date, amount)
     VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET entry_date = excluded.entry_date, amount = excluded.amount`,
    [openingBalance.entryDate, amount]
  );
  saveDatabase();
  return { entryDate: openingBalance.entryDate, amount };
}

function mapCashierShift(row: unknown[]): CashierShift {
  return {
    id: Number(row[0]),
    cashierUsername: String(row[1]),
    cashierName: String(row[2]),
    openedAt: String(row[3]),
    openingCash: Number(row[4]),
    closedAt: row[5] === null ? null : String(row[5]),
    closingCash: row[6] === null ? null : Number(row[6]),
  };
}

export async function listCashierShifts(
  cashierUsername: unknown
): Promise<{ active: CashierShift | null; history: CashierShift[] }> {
  if (typeof cashierUsername !== 'string' || !cashierUsername.trim()) {
    throw new Error('Cashier username is required.');
  }
  const username = cashierUsername.trim();
  const database = await getDb();
  const result = database.exec(
    `SELECT id, cashier_username, cashier_name, opened_at, opening_cash, closed_at, closing_cash
     FROM cashier_shifts
     WHERE cashier_username = ?
     ORDER BY id DESC
     LIMIT 21`,
    [username]
  );
  const shifts = (result[0]?.values || []).map(mapCashierShift);
  const active = shifts.find((shift) => shift.closedAt === null) || null;
  return {
    active,
    history: shifts.filter((shift) => shift.closedAt !== null).slice(0, 20),
  };
}

export async function openCashierShift(input: {
  cashierUsername: unknown;
  cashierName: unknown;
  openingCash: unknown;
}): Promise<CashierShift> {
  if (!input || typeof input.cashierUsername !== 'string' || !input.cashierUsername.trim()) {
    throw new Error('Cashier username is required.');
  }
  if (typeof input.cashierName !== 'string' || !input.cashierName.trim()) {
    throw new Error('Cashier name is required.');
  }
  if (
    typeof input.openingCash !== 'number' ||
    !Number.isFinite(input.openingCash) ||
    input.openingCash < 0
  ) {
    throw new Error('Opening cash must be a non-negative amount.');
  }
  const cashierUsername = input.cashierUsername.trim();
  const cashierName = input.cashierName.trim();
  const openingCash = Number(input.openingCash.toFixed(2));
  const openedAt = new Date().toISOString();
  const database = await getDb();

  database.run('BEGIN IMMEDIATE');
  let id: number;
  try {
    const active = database.exec(
      'SELECT id FROM cashier_shifts WHERE cashier_username = ? AND closed_at IS NULL',
      [cashierUsername]
    )[0]?.values[0];
    if (active) throw new Error('This cashier already has an open shift.');
    database.run(
      `INSERT INTO cashier_shifts (cashier_username, cashier_name, opened_at, opening_cash)
       VALUES (?, ?, ?, ?)`,
      [cashierUsername, cashierName, openedAt, openingCash]
    );
    id = Number(database.exec('SELECT last_insert_rowid()')[0].values[0][0]);
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
  saveDatabase();
  return {
    id,
    cashierUsername,
    cashierName,
    openedAt,
    openingCash,
    closedAt: null,
    closingCash: null,
  };
}

export async function closeCashierShift(input: {
  id: unknown;
  cashierUsername: unknown;
  closingCash: unknown;
}): Promise<CashierShift> {
  if (
    !input ||
    typeof input.id !== 'number' ||
    !Number.isInteger(input.id) ||
    input.id <= 0
  ) {
    throw new Error('A valid shift is required.');
  }
  if (typeof input.cashierUsername !== 'string' || !input.cashierUsername.trim()) {
    throw new Error('Cashier username is required.');
  }
  if (
    typeof input.closingCash !== 'number' ||
    !Number.isFinite(input.closingCash) ||
    input.closingCash < 0
  ) {
    throw new Error('Closing cash must be a non-negative amount.');
  }
  const database = await getDb();
  const result = database.exec(
    `SELECT id, cashier_username, cashier_name, opened_at, opening_cash, closed_at, closing_cash
     FROM cashier_shifts WHERE id = ?`,
    [Number(input.id)]
  );
  const row = result[0]?.values[0];
  if (!row) throw new Error('Shift not found.');
  if (String(row[1]).toLowerCase() !== input.cashierUsername.trim().toLowerCase()) {
    throw new Error('This shift belongs to another cashier.');
  }
  if (row[5] !== null) throw new Error('This shift is already closed.');

  const closedAt = new Date().toISOString();
  const closingCash = Number(input.closingCash.toFixed(2));
  database.run(
    'UPDATE cashier_shifts SET closed_at = ?, closing_cash = ? WHERE id = ? AND closed_at IS NULL',
    [closedAt, closingCash, Number(input.id)]
  );
  saveDatabase();
  return mapCashierShift([
    row[0],
    row[1],
    row[2],
    row[3],
    row[4],
    closedAt,
    closingCash,
  ]);
}

export async function listPrintQueue(): Promise<PrintJob[]> {
  const database = await getDb();
  const res = database.exec(
    `SELECT id, sale_id, receipt_number, created_at, total, status
     FROM print_queue WHERE status = 'QUEUED' ORDER BY id ASC`
  );
  if (!res[0]) return [];
  return res[0].values.map((row) => ({
    id: Number(row[0]),
    saleId: Number(row[1]),
    receiptNumber: String(row[2]),
    createdAt: String(row[3]),
    total: Number(row[4]),
    status: String(row[5]) as 'QUEUED' | 'PRINTED',
  }));
}

export async function flushPrintQueue(): Promise<void> {
  const database = await getDb();
  database.run("UPDATE print_queue SET status = 'PRINTED' WHERE status = 'QUEUED'");
  saveDatabase();
}

function getSystemCode(database: Database): string {
  if (!cachedHardwareSystemIdentity) {
    if (process.platform !== 'win32') {
      throw new Error('Hardware-based system codes are supported on Windows only.');
    }

    let hardwareUuid = '';
    try {
      hardwareUuid = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID',
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000, windowsHide: true }
      ).trim().toUpperCase();
    } catch {
      throw new Error("Could not read this computer's hardware UUID to create a system code.");
    }

    if (
      !/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(hardwareUuid) ||
      hardwareUuid === '00000000-0000-0000-0000-000000000000' ||
      hardwareUuid === 'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF'
    ) {
      throw new Error('This computer did not provide a valid hardware UUID for its system code.');
    }

    const fingerprint = createHash('sha256')
      .update('aptPOS-registration-system-v1:')
      .update(hardwareUuid)
      .digest('hex');
    const systemCode = (
      BigInt(`0x${fingerprint.slice(0, 16)}`) % 10_000_000_000n
    ).toString().padStart(10, '0');
    cachedHardwareSystemIdentity = {
      fingerprint,
      systemCode,
    };
  }

  const { fingerprint, systemCode } = cachedHardwareSystemIdentity;
  const existing = database.exec(
    'SELECT system_code, hardware_fingerprint FROM app_installation WHERE id = 1'
  );
  const current = existing[0]?.values[0];

  if (
    current &&
    String(current[1]) === fingerprint &&
    String(current[0]) === systemCode
  ) {
    return systemCode;
  }
  if (current) {
    database.run(
      'UPDATE app_installation SET system_code = ?, hardware_fingerprint = ? WHERE id = 1',
      [systemCode, fingerprint]
    );
  } else {
    database.run(
      'INSERT INTO app_installation (id, system_code, hardware_fingerprint) VALUES (1, ?, ?)',
      [systemCode, fingerprint]
    );
  }
  saveDatabase();
  return systemCode;
}

function mapRegistrationRequest(row: unknown[]): RegistrationRequest {
  return {
    id: Number(row[0]),
    requestType: String(row[1]) as RegistrationRequestType,
    systemCode: String(row[2]),
    submittedKey: String(row[3]),
    requestedBy: String(row[4]),
    status: String(row[5]) as RegistrationRequestStatus,
    createdAt: String(row[6]),
    reviewedAt: row[7] === null ? null : String(row[7]),
    reviewedBy: row[8] === null ? null : String(row[8]),
  };
}

export async function getRegistrationSystemCode(): Promise<string> {
  return getSystemCode(await getDb());
}

export async function getDemoAccess(): Promise<{
  status: 'never' | 'active' | 'expired';
  expiresAt: string | null;
}> {
  const database = await getDb();
  const result = database.exec(
    'SELECT system_code, expires_at FROM demo_access WHERE id = 1'
  );
  const row = result[0]?.values[0];
  if (!row || String(row[0]) !== getSystemCode(database)) {
    return { status: 'never', expiresAt: null };
  }

  const expiresAt = String(row[1]);
  const expirationTime = Date.parse(expiresAt);
  if (!Number.isFinite(expirationTime)) {
    throw new Error('The saved demo expiration date is invalid.');
  }

  return {
    status: expirationTime > Date.now() ? 'active' : 'expired',
    expiresAt,
  };
}

export async function saveDemoAccess(expiresAt: string): Promise<void> {
  const expirationTime = Date.parse(expiresAt);
  if (!Number.isFinite(expirationTime) || expirationTime <= Date.now()) {
    throw new Error('The demo activation service returned an invalid or expired date.');
  }

  const database = await getDb();
  const systemCode = getSystemCode(database);
  database.run(
    `INSERT INTO demo_access (id, system_code, expires_at, activated_at, offline_grace_started_at)
     VALUES (1, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       system_code = excluded.system_code,
       expires_at = excluded.expires_at,
       activated_at = excluded.activated_at,
       offline_grace_started_at = NULL`,
    [systemCode, new Date(expirationTime).toISOString(), new Date().toISOString()]
  );
  saveDatabase();
}

export async function syncDemoAccessStatus(expiresAt: string): Promise<void> {
  const expirationTime = Date.parse(expiresAt);
  if (!Number.isFinite(expirationTime)) {
    throw new Error('The demo status service returned an invalid expiration date.');
  }

  const database = await getDb();
  database.run(
    `INSERT INTO demo_access (id, system_code, expires_at, activated_at, offline_grace_started_at)
     VALUES (1, ?, ?, ?, NULL)
     ON CONFLICT(id) DO UPDATE SET
       system_code = excluded.system_code,
       expires_at = excluded.expires_at,
       offline_grace_started_at = NULL`,
    [
      getSystemCode(database),
      new Date(expirationTime).toISOString(),
      new Date().toISOString(),
    ]
  );
  saveDatabase();
}

export async function clearDemoAccess(): Promise<void> {
  const database = await getDb();
  database.run('DELETE FROM demo_access WHERE id = 1');
  saveDatabase();
}

export async function beginDemoOfflineGrace(): Promise<string> {
  const database = await getDb();
  const result = database.exec(
    'SELECT offline_grace_started_at FROM demo_access WHERE id = 1'
  );
  const storedValue = result[0]?.values[0]?.[0];
  if (typeof storedValue === 'string' && storedValue) {
    if (!Number.isFinite(Date.parse(storedValue))) {
      throw new Error('The saved demo offline-grace timestamp is invalid.');
    }
    return storedValue;
  }

  const startedAt = new Date().toISOString();
  database.run(
    'UPDATE demo_access SET offline_grace_started_at = ? WHERE id = 1',
    [startedAt]
  );
  saveDatabase();
  return startedAt;
}

function storedDemoAccess(database: Database): {
  expiresAt: string;
  activatedAt: string;
  offlineGraceStartedAt: string | null;
} | null {
  const result = database.exec(
    'SELECT expires_at, activated_at, offline_grace_started_at FROM demo_access WHERE id = 1'
  );
  const row = result[0]?.values[0];
  if (!row) return null;
  return {
    expiresAt: String(row[0]),
    activatedAt: String(row[1]),
    offlineGraceStartedAt: row[2] == null ? null : String(row[2]),
  };
}

function restoreDemoAccess(database: Database, access: {
  expiresAt: string;
  activatedAt: string;
  offlineGraceStartedAt: string | null;
} | null, systemCode: string): void {
  if (!access) return;
  const expirationTime = Date.parse(access.expiresAt);
  const activatedTime = Date.parse(access.activatedAt);
  const offlineGraceStartedTime = access.offlineGraceStartedAt === null
    ? null
    : Date.parse(access.offlineGraceStartedAt);
  if (
    !Number.isFinite(expirationTime) ||
    !Number.isFinite(activatedTime) ||
    (offlineGraceStartedTime !== null && !Number.isFinite(offlineGraceStartedTime))
  ) {
    throw new Error('The saved demo activation record is invalid.');
  }
  database.run(
    `INSERT OR REPLACE INTO demo_access
       (id, system_code, expires_at, activated_at, offline_grace_started_at)
     VALUES (1, ?, ?, ?, ?)`,
    [
      systemCode,
      new Date(expirationTime).toISOString(),
      new Date(activatedTime).toISOString(),
      offlineGraceStartedTime === null ? null : new Date(offlineGraceStartedTime).toISOString(),
    ]
  );
}

export async function createRegistrationRequest(input: {
  requestType: RegistrationRequestType;
  systemCode: string;
  submittedKey: string;
  requestedBy: string;
}): Promise<RegistrationRequest> {
  const database = await getDb();
  const systemCode = input.systemCode.trim().toUpperCase();
  const submittedKey = input.submittedKey.trim();
  const requestedBy = input.requestedBy.trim();

  if (input.requestType !== 'demo' && input.requestType !== 'license') {
    throw new Error('Choose a valid registration request type.');
  }
  if (systemCode !== getSystemCode(database)) {
    throw new Error('The system code does not match this aptPOS installation.');
  }
  if (!submittedKey || submittedKey.length > 256) {
    throw new Error('Enter a valid activation key.');
  }
  if (!requestedBy || requestedBy.length > 100) {
    throw new Error('The signed-in username is invalid.');
  }

  const pendingRequest = database.exec(
    `SELECT id FROM registration_requests
     WHERE request_type = ? AND system_code = ? AND status = 'pending'
     LIMIT 1`,
    [input.requestType, systemCode]
  );
  if (pendingRequest[0]?.values[0]) {
    throw new Error('A request of this type is already pending for this system.');
  }

  database.run(
    `INSERT INTO registration_requests (
      request_type, system_code, submitted_key, requested_by, status, created_at
    ) VALUES (?, ?, ?, ?, 'pending', ?)`,
    [input.requestType, systemCode, submittedKey, requestedBy, new Date().toISOString()]
  );
  const idResult = database.exec('SELECT last_insert_rowid()');
  const id = Number(idResult[0]?.values[0]?.[0]);
  saveDatabase();

  const created = database.exec(
    `SELECT id, request_type, system_code, submitted_key, requested_by, status,
            created_at, reviewed_at, reviewed_by
     FROM registration_requests WHERE id = ?`,
    [id]
  );
  if (!created[0]?.values[0]) throw new Error('The registration request could not be saved.');
  return mapRegistrationRequest(created[0].values[0]);
}

export async function listRegistrationRequests(): Promise<RegistrationRequest[]> {
  const database = await getDb();
  const result = database.exec(
    `SELECT id, request_type, system_code, submitted_key, requested_by, status,
            created_at, reviewed_at, reviewed_by
     FROM registration_requests
     ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC`
  );
  return result[0]?.values.map(mapRegistrationRequest) ?? [];
}

export async function reviewRegistrationRequest(
  id: number,
  status: Exclude<RegistrationRequestStatus, 'pending'>
): Promise<RegistrationRequest | null> {
  const database = await getDb();
  database.run(
    `UPDATE registration_requests
     SET status = ?, reviewed_at = ?, reviewed_by = 'aptadmin'
     WHERE id = ? AND status = 'pending'`,
    [status, new Date().toISOString(), id]
  );
  const updatedRows = Number(database.exec('SELECT changes()')[0]?.values[0]?.[0] ?? 0);
  if (updatedRows === 0) return null;
  saveDatabase();

  const result = database.exec(
    `SELECT id, request_type, system_code, submitted_key, requested_by, status,
            created_at, reviewed_at, reviewed_by
     FROM registration_requests WHERE id = ?`,
    [id]
  );
  return result[0]?.values[0] ? mapRegistrationRequest(result[0].values[0]) : null;
}

export async function authenticateUser(
  username: string,
  password: string
): Promise<UserSession | null> {
  const database = await getDb();
  const trimmed = username.trim();
  const res = database.exec(
    'SELECT id, username, password, role, display_name, permissions FROM users WHERE username = ?',
    [trimmed]
  );

  if (!res[0] || !res[0].values[0]) {
    return null;
  }

  const row = res[0].values[0];
  const storedPassword = String(row[2]);
  if (storedPassword !== password) {
    return null;
  }

  const role = String(row[3]) as 'admin' | 'cashier' | 'custom';
  const permissions = row[5]
    ? String(row[5]).split(',').filter(Boolean)
    : (role === 'admin'
        ? ['register', 'inventory', 'purchases', 'customers', 'vendors', 'accounts', 'reports', 'sales', 'edit-sales', 'sales-return', 'manage-sales-returns', 'delete-sales', 'settings']
        : ['register', 'sales']);

  return {
    id: Number(row[0]),
    username: String(row[1]),
    role,
    displayName: String(row[4]),
    permissions,
  };
}

export async function listUsers(): Promise<UserAccount[]> {
  const database = await getDb();
  const res = database.exec(
    'SELECT id, username, role, display_name, permissions FROM users ORDER BY id ASC'
  );
  if (!res[0]) return [];

  return res[0].values.map((row) => {
    const role = String(row[2]) as 'admin' | 'cashier' | 'custom';
    const permissions = row[4]
      ? String(row[4]).split(',').filter(Boolean)
      : (role === 'admin'
          ? ['register', 'inventory', 'purchases', 'customers', 'vendors', 'accounts', 'reports', 'sales', 'edit-sales', 'sales-return', 'manage-sales-returns', 'delete-sales', 'settings']
          : ['register', 'sales']);

    return {
      id: Number(row[0]),
      username: String(row[1]),
      role,
      displayName: String(row[3]),
      permissions,
    };
  });
}

export async function createUser(input: {
  username: string;
  password: string;
  role?: 'admin' | 'cashier' | 'custom';
  displayName?: string;
  permissions?: string[];
}): Promise<UserAccount> {
  const database = await getDb();
  const username = input.username.trim();
  if (!username || !input.password) {
    throw new Error('Username and password are required.');
  }

  const existing = database.exec('SELECT id FROM users WHERE username = ?', [username]);
  if (existing[0]?.values[0]) {
    throw new Error(`Username "${username}" already exists.`);
  }

  const role = input.role || 'cashier';
  const displayName = input.displayName?.trim() || username;
  const permissions = input.permissions && input.permissions.length > 0
    ? input.permissions
    : (role === 'admin'
        ? ['register', 'inventory', 'purchases', 'customers', 'vendors', 'accounts', 'reports', 'sales', 'edit-sales', 'sales-return', 'manage-sales-returns', 'delete-sales', 'settings']
        : ['register', 'sales']);

  const permsStr = permissions.join(',');

  database.run(
    'INSERT INTO users (username, password, role, display_name, permissions) VALUES (?, ?, ?, ?, ?)',
    [username, input.password, role, displayName, permsStr]
  );
  saveDatabase();

  const idRes = database.exec('SELECT last_insert_rowid()');
  const id = Number(idRes[0].values[0][0]);

  return {
    id,
    username,
    role,
    displayName,
    permissions,
  };
}

export async function updateUser(
  id: number,
  input: {
    username?: string;
    password?: string;
    role?: 'admin' | 'cashier' | 'custom';
    displayName?: string;
    permissions?: string[];
  }
): Promise<UserAccount | null> {
  const database = await getDb();
  const existingRes = database.exec(
    'SELECT id, username, password, role, display_name, permissions FROM users WHERE id = ?',
    [id]
  );
  if (!existingRes[0]?.values[0]) return null;
  const current = existingRes[0].values[0];
  if (String(current[1]).toLowerCase() === 'aptadmin') {
    throw new Error('The primary company admin account cannot be edited.');
  }

  const username = input.username !== undefined ? input.username.trim() : String(current[1]);
  if (input.username !== undefined) {
    const dupCheck = database.exec('SELECT id FROM users WHERE username = ? AND id != ?', [username, id]);
    if (dupCheck[0]?.values[0]) {
      throw new Error(`Username "${username}" is already taken by another account.`);
    }
  }

  const password = input.password && input.password.trim() !== '' ? input.password : String(current[2]);
  const role = (input.role !== undefined ? input.role : String(current[3])) as 'admin' | 'cashier' | 'custom';
  const displayName = input.displayName !== undefined ? input.displayName.trim() : String(current[4]);

  const permissions = input.permissions !== undefined
    ? input.permissions
    : (current[5]
        ? String(current[5]).split(',').filter(Boolean)
        : (role === 'admin'
            ? ['register', 'inventory', 'purchases', 'customers', 'vendors', 'accounts', 'reports', 'sales', 'edit-sales', 'sales-return', 'manage-sales-returns', 'delete-sales', 'settings']
            : ['register', 'sales']));

  const permsStr = permissions.join(',');

  database.run(
    'UPDATE users SET username = ?, password = ?, role = ?, display_name = ?, permissions = ? WHERE id = ?',
    [username, password, role, displayName, permsStr, id]
  );
  saveDatabase();

  return {
    id,
    username,
    role,
    displayName,
    permissions,
  };
}

export async function deleteUser(id: number): Promise<boolean> {
  const database = await getDb();
  const res = database.exec('SELECT username, role FROM users WHERE id = ?', [id]);
  if (res[0]?.values[0]) {
    const username = String(res[0].values[0][0]);
    const role = String(res[0].values[0][1]);
    const countRes = database.exec('SELECT COUNT(*) FROM users WHERE role = "admin"');
    const adminCount = Number(countRes[0]?.values[0]?.[0] ?? 0);

    if (username.toLowerCase() === 'aptadmin') {
      throw new Error('Cannot delete primary company admin account "aptadmin".');
    }
    if (adminCount <= 1 && role === 'admin') {
      throw new Error('Cannot delete the only remaining admin account.');
    }
  }

  database.run('DELETE FROM users WHERE id = ?', [id]);
  saveDatabase();
  return true;
}

// ----------------- CUSTOMERS -----------------
export async function listCustomers(search?: string): Promise<Customer[]> {
  const database = await getDb();
  const res = database.exec(
    `SELECT id, name, name_ar, phone, email, address, building_no, street_name, district, city, postal_code, country, vat_number, cr_number, notes, created_at FROM customers ORDER BY name ASC`
  );
  if (!res[0]) return [];

  // Calculate total spent and orders count from sales table
  const salesRes = database.exec(
    `SELECT customer_name, total FROM sales WHERE status = 'COMPLETED'`
  );
  const spendingByCustomer = new Map<string, { total: number; count: number }>();
  if (salesRes[0]) {
    for (const r of salesRes[0].values) {
      const cName = String(r[0]);
      const tot = Number(r[1]);
      const cur = spendingByCustomer.get(cName) || { total: 0, count: 0 };
      spendingByCustomer.set(cName, { total: cur.total + tot, count: cur.count + 1 });
    }
  }

  let customers: Customer[] = res[0].values.map((r) => {
    const name = String(r[1]);
    const spentInfo = spendingByCustomer.get(name) || { total: 0, count: 0 };
    return {
      id: Number(r[0]),
      name,
      nameAr: String(r[2] || ''),
      phone: String(r[3] || ''),
      email: String(r[4] || ''),
      address: String(r[5] || ''),
      buildingNo: String(r[6] || ''),
      streetName: String(r[7] || ''),
      district: String(r[8] || ''),
      city: String(r[9] || ''),
      postalCode: String(r[10] || ''),
      country: String(r[11] || 'Saudi Arabia'),
      vatNumber: String(r[12] || ''),
      crNumber: String(r[13] || ''),
      notes: String(r[14] || ''),
      createdAt: String(r[15]),
      totalSpent: Number(spentInfo.total.toFixed(2)),
      ordersCount: spentInfo.count,
    };
  });

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    customers = customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.nameAr && c.nameAr.toLowerCase().includes(q)) ||
        c.phone.toLowerCase().includes(q) ||
        (c.vatNumber && c.vatNumber.toLowerCase().includes(q)) ||
        (c.crNumber && c.crNumber.toLowerCase().includes(q)) ||
        c.email.toLowerCase().includes(q)
    );
  }

  return customers;
}

export async function createCustomer(input: {
  name: string;
  nameAr?: string;
  phone?: string;
  email?: string;
  address?: string;
  buildingNo?: string;
  streetName?: string;
  district?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  vatNumber?: string;
  crNumber?: string;
  notes?: string;
}): Promise<Customer> {
  const database = await getDb();
  const now = new Date().toISOString();
  database.run(
    `INSERT INTO customers (
      name, name_ar, phone, email, address,
      building_no, street_name, district, city, postal_code, country,
      vat_number, cr_number, notes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name.trim(),
      (input.nameAr || '').trim(),
      (input.phone || '').trim(),
      (input.email || '').trim(),
      (input.address || '').trim(),
      (input.buildingNo || '').trim(),
      (input.streetName || '').trim(),
      (input.district || '').trim(),
      (input.city || '').trim(),
      (input.postalCode || '').trim(),
      (input.country || 'Saudi Arabia').trim(),
      (input.vatNumber || '').trim(),
      (input.crNumber || '').trim(),
      (input.notes || '').trim(),
      now,
    ]
  );
  const idRes = database.exec('SELECT last_insert_rowid()');
  const id = Number(idRes[0].values[0][0]);
  saveDatabase();
  return {
    id,
    name: input.name.trim(),
    nameAr: (input.nameAr || '').trim(),
    phone: (input.phone || '').trim(),
    email: (input.email || '').trim(),
    address: (input.address || '').trim(),
    buildingNo: (input.buildingNo || '').trim(),
    streetName: (input.streetName || '').trim(),
    district: (input.district || '').trim(),
    city: (input.city || '').trim(),
    postalCode: (input.postalCode || '').trim(),
    country: (input.country || 'Saudi Arabia').trim(),
    vatNumber: (input.vatNumber || '').trim(),
    crNumber: (input.crNumber || '').trim(),
    notes: (input.notes || '').trim(),
    createdAt: now,
    totalSpent: 0,
    ordersCount: 0,
  };
}

export async function updateCustomer(
  id: number,
  input: {
    name?: string;
    nameAr?: string;
    phone?: string;
    email?: string;
    address?: string;
    buildingNo?: string;
    streetName?: string;
    district?: string;
    city?: string;
    postalCode?: string;
    country?: string;
    vatNumber?: string;
    crNumber?: string;
    notes?: string;
  }
): Promise<Customer | null> {
  const database = await getDb();
  const existingRes = database.exec(
    `SELECT id, name, name_ar, phone, email, address, building_no, street_name, district, city, postal_code, country, vat_number, cr_number, notes, created_at FROM customers WHERE id = ?`,
    [id]
  );
  if (!existingRes[0]?.values[0]) return null;
  const current = existingRes[0].values[0];

  database.run(
    `UPDATE customers
     SET name = ?, name_ar = ?, phone = ?, email = ?, address = ?,
         building_no = ?, street_name = ?, district = ?, city = ?, postal_code = ?, country = ?,
         vat_number = ?, cr_number = ?, notes = ?
     WHERE id = ?`,
    [
      input.name !== undefined ? input.name.trim() : String(current[1]),
      input.nameAr !== undefined ? input.nameAr.trim() : String(current[2] || ''),
      input.phone !== undefined ? input.phone.trim() : String(current[3] || ''),
      input.email !== undefined ? input.email.trim() : String(current[4] || ''),
      input.address !== undefined ? input.address.trim() : String(current[5] || ''),
      input.buildingNo !== undefined ? input.buildingNo.trim() : String(current[6] || ''),
      input.streetName !== undefined ? input.streetName.trim() : String(current[7] || ''),
      input.district !== undefined ? input.district.trim() : String(current[8] || ''),
      input.city !== undefined ? input.city.trim() : String(current[9] || ''),
      input.postalCode !== undefined ? input.postalCode.trim() : String(current[10] || ''),
      input.country !== undefined ? input.country.trim() : String(current[11] || 'Saudi Arabia'),
      input.vatNumber !== undefined ? input.vatNumber.trim() : String(current[12] || ''),
      input.crNumber !== undefined ? input.crNumber.trim() : String(current[13] || ''),
      input.notes !== undefined ? input.notes.trim() : String(current[14] || ''),
      id,
    ]
  );
  saveDatabase();
  const all = await listCustomers();
  return all.find((c) => c.id === id) || null;
}

export async function deleteCustomer(id: number): Promise<boolean> {
  const database = await getDb();
  database.run('DELETE FROM customers WHERE id = ?', [id]);
  saveDatabase();
  return true;
}

// ----------------- VENDORS -----------------
export async function listVendors(search?: string): Promise<Vendor[]> {
  const database = await getDb();
  const res = database.exec(
    `SELECT id, name, name_ar, contact_person, phone, email, address, building_no, street_name, district, city, postal_code, country, tax_number, cr_number, created_at FROM vendors ORDER BY name ASC`
  );
  if (!res[0]) return [];

  // Aggregate purchases
  const purchRes = database.exec(`SELECT id, vendor_id, total FROM purchases`);
  const purchaseReturnRes = database.exec(
    'SELECT purchase_id, SUM(total) FROM purchase_return_vouchers GROUP BY purchase_id'
  );
  const purchaseReturnsByPurchase = new Map<number, number>();
  for (const row of purchaseReturnRes[0]?.values || []) {
    purchaseReturnsByPurchase.set(Number(row[0]), Number(row[1]));
  }
  const purchasesByVendor = new Map<number, { total: number; count: number }>();
  if (purchRes[0]) {
    for (const r of purchRes[0].values) {
      const purchaseId = Number(r[0]);
      const vId = Number(r[1]);
      const tot = Math.max(0, Number(r[2]) - (purchaseReturnsByPurchase.get(purchaseId) || 0));
      const cur = purchasesByVendor.get(vId) || { total: 0, count: 0 };
      purchasesByVendor.set(vId, { total: cur.total + tot, count: cur.count + 1 });
    }
  }

  let vendors: Vendor[] = res[0].values.map((r) => {
    const id = Number(r[0]);
    const purchInfo = purchasesByVendor.get(id) || { total: 0, count: 0 };
    return {
      id,
      name: String(r[1]),
      nameAr: String(r[2] || ''),
      contactPerson: String(r[3] || ''),
      phone: String(r[4] || ''),
      email: String(r[5] || ''),
      address: String(r[6] || ''),
      buildingNo: String(r[7] || ''),
      streetName: String(r[8] || ''),
      district: String(r[9] || ''),
      city: String(r[10] || ''),
      postalCode: String(r[11] || ''),
      country: String(r[12] || 'Saudi Arabia'),
      taxNumber: String(r[13] || ''),
      crNumber: String(r[14] || ''),
      createdAt: String(r[15]),
      totalPurchased: Number(purchInfo.total.toFixed(2)),
      purchasesCount: purchInfo.count,
    };
  });

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    vendors = vendors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        (v.nameAr && v.nameAr.toLowerCase().includes(q)) ||
        v.contactPerson.toLowerCase().includes(q) ||
        v.phone.toLowerCase().includes(q) ||
        (v.taxNumber && v.taxNumber.toLowerCase().includes(q)) ||
        (v.crNumber && v.crNumber.toLowerCase().includes(q)) ||
        v.email.toLowerCase().includes(q)
    );
  }

  return vendors;
}

export async function createVendor(input: {
  name: string;
  nameAr?: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  address?: string;
  buildingNo?: string;
  streetName?: string;
  district?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  taxNumber?: string;
  crNumber?: string;
}): Promise<Vendor> {
  const database = await getDb();
  const now = new Date().toISOString();
  database.run(
    `INSERT INTO vendors (
      name, name_ar, contact_person, phone, email, address,
      building_no, street_name, district, city, postal_code, country,
      tax_number, cr_number, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name.trim(),
      (input.nameAr || '').trim(),
      (input.contactPerson || '').trim(),
      (input.phone || '').trim(),
      (input.email || '').trim(),
      (input.address || '').trim(),
      (input.buildingNo || '').trim(),
      (input.streetName || '').trim(),
      (input.district || '').trim(),
      (input.city || '').trim(),
      (input.postalCode || '').trim(),
      (input.country || 'Saudi Arabia').trim(),
      (input.taxNumber || '').trim(),
      (input.crNumber || '').trim(),
      now,
    ]
  );
  const idRes = database.exec('SELECT last_insert_rowid()');
  const id = Number(idRes[0].values[0][0]);
  saveDatabase();
  return {
    id,
    name: input.name.trim(),
    nameAr: (input.nameAr || '').trim(),
    contactPerson: (input.contactPerson || '').trim(),
    phone: (input.phone || '').trim(),
    email: (input.email || '').trim(),
    address: (input.address || '').trim(),
    buildingNo: (input.buildingNo || '').trim(),
    streetName: (input.streetName || '').trim(),
    district: (input.district || '').trim(),
    city: (input.city || '').trim(),
    postalCode: (input.postalCode || '').trim(),
    country: (input.country || 'Saudi Arabia').trim(),
    taxNumber: (input.taxNumber || '').trim(),
    crNumber: (input.crNumber || '').trim(),
    createdAt: now,
    totalPurchased: 0,
    purchasesCount: 0,
  };
}

export async function updateVendor(
  id: number,
  input: {
    name?: string;
    nameAr?: string;
    contactPerson?: string;
    phone?: string;
    email?: string;
    address?: string;
    buildingNo?: string;
    streetName?: string;
    district?: string;
    city?: string;
    postalCode?: string;
    country?: string;
    taxNumber?: string;
    crNumber?: string;
  }
): Promise<Vendor | null> {
  const database = await getDb();
  const existingRes = database.exec(
    `SELECT id, name, name_ar, contact_person, phone, email, address, building_no, street_name, district, city, postal_code, country, tax_number, cr_number, created_at FROM vendors WHERE id = ?`,
    [id]
  );
  if (!existingRes[0]?.values[0]) return null;
  const current = existingRes[0].values[0];

  database.run(
    `UPDATE vendors
     SET name = ?, name_ar = ?, contact_person = ?, phone = ?, email = ?, address = ?,
         building_no = ?, street_name = ?, district = ?, city = ?, postal_code = ?, country = ?,
         tax_number = ?, cr_number = ?
     WHERE id = ?`,
    [
      input.name !== undefined ? input.name.trim() : String(current[1]),
      input.nameAr !== undefined ? input.nameAr.trim() : String(current[2] || ''),
      input.contactPerson !== undefined ? input.contactPerson.trim() : String(current[3] || ''),
      input.phone !== undefined ? input.phone.trim() : String(current[4] || ''),
      input.email !== undefined ? input.email.trim() : String(current[5] || ''),
      input.address !== undefined ? input.address.trim() : String(current[6] || ''),
      input.buildingNo !== undefined ? input.buildingNo.trim() : String(current[7] || ''),
      input.streetName !== undefined ? input.streetName.trim() : String(current[8] || ''),
      input.district !== undefined ? input.district.trim() : String(current[9] || ''),
      input.city !== undefined ? input.city.trim() : String(current[10] || ''),
      input.postalCode !== undefined ? input.postalCode.trim() : String(current[11] || ''),
      input.country !== undefined ? input.country.trim() : String(current[12] || 'Saudi Arabia'),
      input.taxNumber !== undefined ? input.taxNumber.trim() : String(current[13] || ''),
      input.crNumber !== undefined ? input.crNumber.trim() : String(current[14] || ''),
      id,
    ]
  );
  saveDatabase();
  const all = await listVendors();
  return all.find((v) => v.id === id) || null;
}

export async function deleteVendor(id: number): Promise<boolean> {
  const database = await getDb();
  database.run('DELETE FROM vendors WHERE id = ?', [id]);
  saveDatabase();
  return true;
}

// ----------------- PURCHASE ENTRY -----------------
export async function listPurchases(): Promise<PurchaseEntry[]> {
  const database = await getDb();
  const res = database.exec(
    `SELECT id, invoice_number, vendor_id, vendor_name, created_at, received_date, subtotal, tax_amount, shipping_cost, total, payment_status, notes, paid_amount
     FROM purchases ORDER BY id DESC`
  );
  if (!res[0]) return [];

  const itemsRes = database.exec(
    `SELECT id, purchase_id, product_id, sku, product_name, quantity, unit_cost, line_total
     FROM purchase_items ORDER BY id ASC`
  );
  const itemsByPurchase = new Map<number, PurchaseItem[]>();
  if (itemsRes[0]) {
    for (const row of itemsRes[0].values) {
      const item: PurchaseItem = {
        id: Number(row[0]),
        purchaseId: Number(row[1]),
        productId: Number(row[2]),
        sku: String(row[3]),
        productName: String(row[4]),
        quantity: Number(row[5]),
        unitCost: Number(row[6]),
        lineTotal: Number(row[7]),
      };
      const list = itemsByPurchase.get(item.purchaseId) || [];
      list.push(item);
      itemsByPurchase.set(item.purchaseId, list);
    }
  }

  return res[0].values.map((row) => {
    const id = Number(row[0]);
    return {
      id,
      invoiceNumber: String(row[1]),
      vendorId: Number(row[2]),
      vendorName: String(row[3]),
      createdAt: String(row[4]),
      receivedDate: String(row[5]),
      subtotal: Number(row[6]),
      taxAmount: Number(row[7]),
      shippingCost: Number(row[8]),
      total: Number(row[9]),
      paymentStatus: String(row[10]) as 'PAID' | 'PENDING' | 'PARTIAL',
      notes: String(row[11] || ''),
      paidAmount: Number(row[12] ?? (String(row[10]) === 'PAID' ? row[9] : 0)),
      items: itemsByPurchase.get(id) || [],
    };
  });
}

export interface CreatePurchaseInput {
  invoiceNumber: string;
  vendorId: number;
  receivedDate?: string;
  taxAmount?: number;
  shippingCost?: number;
  paymentStatus?: 'PAID' | 'PENDING' | 'PARTIAL';
  paidAmount?: number;
  notes?: string;
  updateCostPrices?: boolean;
  items: Array<{
    productId: number;
    quantity: number;
    unitCost: number;
  }>;
}

function getPurchasePaymentStatus(
  paidAmount: number,
  total: number,
  preferredStatus?: 'PAID' | 'PENDING' | 'PARTIAL'
): 'PAID' | 'PENDING' | 'PARTIAL' {
  if ((total > 0 && paidAmount >= total) || (total === 0 && preferredStatus === 'PAID')) {
    return 'PAID';
  }
  if (paidAmount > 0 || preferredStatus === 'PARTIAL') return 'PARTIAL';
  return 'PENDING';
}

export async function createPurchaseEntry(
  input: CreatePurchaseInput
): Promise<PurchaseEntry> {
  const database = await getDb();
  if (!input.items || input.items.length === 0) {
    throw new Error('Purchase entry must contain at least one item.');
  }

  // Look up vendor
  const vendorRes = database.exec('SELECT id, name FROM vendors WHERE id = ?', [
    input.vendorId,
  ]);
  if (!vendorRes[0]?.values[0]) {
    throw new Error('Vendor not found.');
  }
  const vendorName = String(vendorRes[0].values[0][1]);

  const resolvedItems: Array<{
    productId: number;
    sku: string;
    productName: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
  }> = [];

  for (const item of input.items) {
    const prodRes = database.exec(
      'SELECT id, sku, name, cost_price FROM products WHERE id = ?',
      [item.productId]
    );
    if (!prodRes[0]?.values[0]) {
      throw new Error(`Product #${item.productId} not found.`);
    }
    const sku = String(prodRes[0].values[0][1]);
    const name = String(prodRes[0].values[0][2]);
    const qty = Number(item.quantity);
    const cost = Number(item.unitCost);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error('Purchase item quantity must be greater than zero.');
    }
    if (!Number.isFinite(cost) || cost < 0) {
      throw new Error('Purchase item cost must be zero or greater.');
    }
    const lineTotal = Number((qty * cost).toFixed(2));
    resolvedItems.push({
      productId: item.productId,
      sku,
      productName: name,
      quantity: qty,
      unitCost: cost,
      lineTotal,
    });
  }

  const subtotal = Number(
    resolvedItems.reduce((acc, it) => acc + it.lineTotal, 0).toFixed(2)
  );
  const tax = Number(Number(input.taxAmount || 0).toFixed(2));
  const shipping = Number(Number(input.shippingCost || 0).toFixed(2));
  const total = Number((subtotal + tax + shipping).toFixed(2));
  const paidAmount = input.paidAmount === undefined
    ? (input.paymentStatus === undefined || input.paymentStatus === 'PAID' ? total : 0)
    : Number(input.paidAmount);
  if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > total) {
    throw new Error('Paid amount must be between zero and the purchase total.');
  }
  const paymentStatus = input.paidAmount === undefined
    ? (input.paymentStatus || 'PAID')
    : getPurchasePaymentStatus(paidAmount, total, input.paymentStatus);
  const now = new Date().toISOString();
  const receivedDate = input.receivedDate || now.slice(0, 10);

  database.run(
    `INSERT INTO purchases (
      invoice_number, vendor_id, vendor_name, created_at, received_date,
      subtotal, tax_amount, shipping_cost, total, payment_status, notes, paid_amount
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.invoiceNumber.trim(),
      input.vendorId,
      vendorName,
      now,
      receivedDate,
      subtotal,
      tax,
      shipping,
      total,
      paymentStatus,
      (input.notes || '').trim(),
      paidAmount,
    ]
  );

  const purchIdRes = database.exec('SELECT last_insert_rowid()');
  const purchaseId = Number(purchIdRes[0].values[0][0]);

  const purchaseItems: PurchaseItem[] = [];
  for (const it of resolvedItems) {
    database.run(
      `INSERT INTO purchase_items (purchase_id, product_id, sku, product_name, quantity, unit_cost, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [purchaseId, it.productId, it.sku, it.productName, it.quantity, it.unitCost, it.lineTotal]
    );
    const itemIdRes = database.exec('SELECT last_insert_rowid()');
    purchaseItems.push({
      id: Number(itemIdRes[0].values[0][0]),
      purchaseId,
      productId: it.productId,
      sku: it.sku,
      productName: it.productName,
      quantity: it.quantity,
      unitCost: it.unitCost,
      lineTotal: it.lineTotal,
    });

    // Automatically increase inventory stock on hand!
    if (input.updateCostPrices) {
      database.run(
        'UPDATE products SET stock = stock + ?, cost_price = ?, updated_at = ? WHERE id = ?',
        [it.quantity, it.unitCost, now, it.productId]
      );
    } else {
      database.run(
        'UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?',
        [it.quantity, now, it.productId]
      );
    }
  }

  saveDatabase();

  return {
    id: purchaseId,
    invoiceNumber: input.invoiceNumber.trim(),
    vendorId: input.vendorId,
    vendorName,
    createdAt: now,
    receivedDate,
    subtotal,
    taxAmount: tax,
    shippingCost: shipping,
    total,
    paymentStatus,
    paidAmount,
    notes: (input.notes || '').trim(),
    items: purchaseItems,
  };
}

export async function listPurchaseReturnVouchers(): Promise<PurchaseReturnVoucher[]> {
  const database = await getDb();
  const vouchersRes = database.exec(
    `SELECT id, voucher_number, purchase_id, invoice_number, vendor_id, vendor_name,
            created_at, subtotal, tax_amount, total, notes
     FROM purchase_return_vouchers ORDER BY id DESC`
  );
  if (!vouchersRes[0]) return [];

  const itemsRes = database.exec(
    `SELECT id, voucher_id, purchase_item_id, product_id, sku, product_name,
            quantity, unit_cost, line_total
     FROM purchase_return_items ORDER BY id ASC`
  );
  const itemsByVoucher = new Map<number, PurchaseReturnItem[]>();
  for (const row of itemsRes[0]?.values || []) {
    const item: PurchaseReturnItem = {
      id: Number(row[0]),
      voucherId: Number(row[1]),
      purchaseItemId: Number(row[2]),
      productId: Number(row[3]),
      sku: String(row[4]),
      productName: String(row[5]),
      quantity: Number(row[6]),
      unitCost: Number(row[7]),
      lineTotal: Number(row[8]),
    };
    const items = itemsByVoucher.get(item.voucherId) || [];
    items.push(item);
    itemsByVoucher.set(item.voucherId, items);
  }

  return vouchersRes[0].values.map((row) => {
    const id = Number(row[0]);
    return {
      id,
      voucherNumber: String(row[1]),
      purchaseId: Number(row[2]),
      invoiceNumber: String(row[3]),
      vendorId: Number(row[4]),
      vendorName: String(row[5]),
      createdAt: String(row[6]),
      subtotal: Number(row[7]),
      taxAmount: Number(row[8]),
      total: Number(row[9]),
      notes: String(row[10] || ''),
      items: itemsByVoucher.get(id) || [],
    };
  });
}

export async function createPurchaseReturnVoucher(
  input: CreatePurchaseReturnInput
): Promise<PurchaseReturnVoucher> {
  const purchaseId = Number(input.purchaseId);
  if (!Number.isInteger(purchaseId) || purchaseId <= 0) {
    throw new Error('A valid purchase invoice is required.');
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Purchase return must contain at least one item.');
  }

  const database = await getDb();
  const now = new Date().toISOString();
  const year = now.slice(0, 4);
  const requestedItems = new Map<number, number>();
  for (const item of input.items) {
    const purchaseItemId = Number(item.purchaseItemId);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(purchaseItemId) || purchaseItemId <= 0) {
      throw new Error('Purchase return contains an invalid purchase item.');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Return quantity must be greater than zero.');
    }
    if (requestedItems.has(purchaseItemId)) {
      throw new Error('Purchase return contains the same item more than once.');
    }
    requestedItems.set(purchaseItemId, quantity);
  }

  let voucherId = 0;
  database.run('BEGIN IMMEDIATE');
  try {
    const purchaseRes = database.exec(
      `SELECT id, invoice_number, vendor_id, vendor_name, subtotal, tax_amount
       FROM purchases WHERE id = ?`,
      [purchaseId]
    );
    const purchaseRow = purchaseRes[0]?.values[0];
    if (!purchaseRow) throw new Error('Purchase invoice not found.');

    const purchaseItemsRes = database.exec(
      `SELECT id, product_id, sku, product_name, quantity, unit_cost
       FROM purchase_items WHERE purchase_id = ?`,
      [purchaseId]
    );
    const sourceItems = new Map<number, {
      productId: number;
      sku: string;
      productName: string;
      quantity: number;
      unitCost: number;
    }>();
    for (const row of purchaseItemsRes[0]?.values || []) {
      sourceItems.set(Number(row[0]), {
        productId: Number(row[1]),
        sku: String(row[2]),
        productName: String(row[3]),
        quantity: Number(row[4]),
        unitCost: Number(row[5]),
      });
    }
    const previouslyReturned = new Map<number, number>();
    const returnedRes = database.exec(
      `SELECT purchase_return_items.purchase_item_id, SUM(purchase_return_items.quantity)
       FROM purchase_return_items
       JOIN purchase_return_vouchers
         ON purchase_return_vouchers.id = purchase_return_items.voucher_id
       WHERE purchase_return_vouchers.purchase_id = ?
       GROUP BY purchase_return_items.purchase_item_id`,
      [purchaseId]
    );
    for (const row of returnedRes[0]?.values || []) {
      previouslyReturned.set(Number(row[0]), Number(row[1]));
    }

    const resolvedItems: Array<PurchaseReturnItem & { productId: number }> = [];
    for (const [purchaseItemId, quantity] of requestedItems) {
      const sourceItem = sourceItems.get(purchaseItemId);
      if (!sourceItem) throw new Error('A returned item does not belong to this purchase invoice.');
      const remaining = sourceItem.quantity - (previouslyReturned.get(purchaseItemId) || 0);
      if (quantity > remaining + 0.000001) {
        throw new Error(`Return quantity exceeds the remaining quantity for ${sourceItem.productName}.`);
      }
      const productRes = database.exec('SELECT stock FROM products WHERE id = ?', [
        sourceItem.productId,
      ]);
      const stock = productRes[0]?.values[0] ? Number(productRes[0].values[0][0]) : null;
      if (stock === null) throw new Error(`Product #${sourceItem.productId} no longer exists.`);
      if (stock + 0.000001 < quantity) {
        throw new Error(`Cannot return ${sourceItem.productName}; there is not enough stock on hand.`);
      }
      resolvedItems.push({
        id: 0,
        voucherId: 0,
        purchaseItemId,
        productId: sourceItem.productId,
        sku: sourceItem.sku,
        productName: sourceItem.productName,
        quantity,
        unitCost: sourceItem.unitCost,
        lineTotal: Number((quantity * sourceItem.unitCost).toFixed(2)),
      });
    }

    const subtotal = Number(
      resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2)
    );
    const sourceSubtotal = Number(purchaseRow[4]);
    const sourceTax = Number(purchaseRow[5]);
    const previousTaxRes = database.exec(
      'SELECT COALESCE(SUM(tax_amount), 0) FROM purchase_return_vouchers WHERE purchase_id = ?',
      [purchaseId]
    );
    const remainingTax = Math.max(
      0,
      sourceTax - Number(previousTaxRes[0]?.values[0]?.[0] || 0)
    );
    const taxAmount = sourceSubtotal > 0
      ? Math.min(remainingTax, Number((sourceTax * subtotal / sourceSubtotal).toFixed(2)))
      : 0;
    const total = Number((subtotal + taxAmount).toFixed(2));
    const voucherNumberSeed = `PR-${year}-${Date.now()}`;
    database.run(
      `INSERT INTO purchase_return_vouchers (
        voucher_number, purchase_id, invoice_number, vendor_id, vendor_name,
        created_at, subtotal, tax_amount, total, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        voucherNumberSeed,
        purchaseId,
        String(purchaseRow[1]),
        Number(purchaseRow[2]),
        String(purchaseRow[3]),
        now,
        subtotal,
        taxAmount,
        total,
        (input.notes || '').trim(),
      ]
    );
    voucherId = Number(database.exec('SELECT last_insert_rowid()')[0].values[0][0]);
    const voucherNumber = `PR-${year}-${String(voucherId).padStart(6, '0')}`;
    database.run('UPDATE purchase_return_vouchers SET voucher_number = ? WHERE id = ?', [
      voucherNumber,
      voucherId,
    ]);

    for (const item of resolvedItems) {
      database.run(
        `INSERT INTO purchase_return_items (
          voucher_id, purchase_item_id, product_id, sku, product_name,
          quantity, unit_cost, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          voucherId,
          item.purchaseItemId,
          item.productId,
          item.sku,
          item.productName,
          item.quantity,
          item.unitCost,
          item.lineTotal,
        ]
      );
      database.run(
        'UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?',
        [item.quantity, now, item.productId]
      );
    }
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

  saveDatabase();
  const voucher = (await listPurchaseReturnVouchers()).find((entry) => entry.id === voucherId);
  if (!voucher) throw new Error('Purchase return was saved, but could not be loaded.');
  return voucher;
}

export async function deletePurchaseReturnVoucher(voucherId: number): Promise<boolean> {
  if (!Number.isInteger(voucherId) || voucherId <= 0) {
    throw new Error('Invalid purchase return voucher ID.');
  }
  const database = await getDb();
  const voucherRes = database.exec(
    'SELECT id FROM purchase_return_vouchers WHERE id = ?',
    [voucherId]
  );
  if (!voucherRes[0]?.values[0]) return false;
  const now = new Date().toISOString();

  database.run('BEGIN IMMEDIATE');
  try {
    const returnedItems = database.exec(
      `SELECT product_id, SUM(quantity)
       FROM purchase_return_items WHERE voucher_id = ? GROUP BY product_id`,
      [voucherId]
    )[0]?.values || [];
    for (const row of returnedItems) {
      const productId = Number(row[0]);
      const quantity = Number(row[1]);
      const productRes = database.exec('SELECT id FROM products WHERE id = ?', [productId]);
      if (!productRes[0]?.values[0]) throw new Error('A returned product no longer exists.');
      database.run('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?', [
        quantity,
        now,
        productId,
      ]);
    }
    database.run('DELETE FROM purchase_return_items WHERE voucher_id = ?', [voucherId]);
    database.run('DELETE FROM purchase_return_vouchers WHERE id = ?', [voucherId]);
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

  saveDatabase();
  return true;
}

export async function deleteSale(saleId: number): Promise<boolean> {
  const database = await getDb();
  const sales = await listSales();
  const target = sales.find((s) => s.id === saleId);
  if (!target) return false;
  const returnRes = database.exec(
    'SELECT 1 FROM sale_returns WHERE sale_id = ? LIMIT 1',
    [saleId]
  );
  if (returnRes[0]?.values.length) {
    throw new Error('Sales with returns cannot be deleted.');
  }

  const affectedVouchers = database.exec(
    'SELECT DISTINCT voucher_id FROM sale_returns WHERE sale_id = ? AND voucher_id IS NOT NULL',
    [saleId]
  )[0]?.values.map((row) => Number(row[0])) || [];
  const now = new Date().toISOString();

  database.run('BEGIN');
  try {
    if (target.status === 'COMPLETED') {
      for (const item of target.items) {
        const remainingQuantity = item.quantity - (item.returnedQuantity || 0);
        if (remainingQuantity <= 0) continue;
        database.run(
          'UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?',
          [remainingQuantity * (item.unitsPerBase || 1), now, item.productId]
        );
      }
    }

    database.run(
      'DELETE FROM sale_return_items WHERE return_id IN (SELECT id FROM sale_returns WHERE sale_id = ?)',
      [saleId]
    );
    database.run('DELETE FROM sale_returns WHERE sale_id = ?', [saleId]);
    for (const voucherId of affectedVouchers) {
      database.run(
        `UPDATE sales_return_vouchers
         SET refund_amount = (
               SELECT COALESCE(SUM(refund_amount), 0) FROM sale_returns WHERE voucher_id = ?
             ),
             tax_refund_amount = (
               SELECT COALESCE(SUM(tax_refund_amount), 0) FROM sale_returns WHERE voucher_id = ?
             )
         WHERE id = ?`,
        [voucherId, voucherId, voucherId]
      );
    }
    database.run(
      `DELETE FROM sales_return_vouchers
       WHERE NOT EXISTS (SELECT 1 FROM sale_returns WHERE voucher_id = sales_return_vouchers.id)`
    );
    database.run('DELETE FROM sale_items WHERE sale_id = ?', [saleId]);
    database.run('DELETE FROM print_queue WHERE sale_id = ?', [saleId]);
    database.run('DELETE FROM sales WHERE id = ?', [saleId]);
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

  saveDatabase();
  return true;
}

export async function updateSale(
  saleId: number,
  input: {
    customerName?: string;
    customerId?: number | null;
    cashierName?: string;
    paymentMethod?: PaymentMethod;
    status?: 'COMPLETED' | 'VOIDED';
  }
): Promise<Sale | null> {
  const database = await getDb();
  const sales = await listSales();
  const target = sales.find((s) => s.id === saleId);
  if (!target) return null;
  if (target.returnStatus && input.status === 'VOIDED') {
    throw new Error('Sales with returns cannot be voided.');
  }

  const newCustomerName = input.customerName !== undefined ? input.customerName : target.customerName;
  const newCashierName = input.cashierName !== undefined ? input.cashierName : target.cashierName;
  const newPaymentMethod = input.paymentMethod !== undefined ? input.paymentMethod : target.paymentMethod;
  const newStatus = input.status !== undefined ? input.status : target.status;

  // If status is transitioning from COMPLETED to VOIDED or vice versa, handle inventory
  if (target.status === 'COMPLETED' && newStatus === 'VOIDED') {
    const now = new Date().toISOString();
    for (const item of target.items) {
      database.run(
        'UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?',
        [item.quantity * (item.unitsPerBase || 1), now, item.productId]
      );
    }
  } else if (target.status === 'VOIDED' && newStatus === 'COMPLETED') {
    const now = new Date().toISOString();
    for (const item of target.items) {
      database.run(
        'UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?',
        [item.quantity * (item.unitsPerBase || 1), now, item.productId]
      );
    }
  }

  database.run(
    `UPDATE sales SET customer_name = ?, cashier_name = ?, payment_method = ?, status = ? WHERE id = ?`,
    [newCustomerName, newCashierName, newPaymentMethod, newStatus, saleId]
  );

  saveDatabase();
  const updatedSales = await listSales();
  return updatedSales.find((s) => s.id === saleId) || null;
}

export async function updateSaleInvoice(
  saleId: number,
  input: CreateSaleInput
): Promise<{ sale: Sale; queuedOfflinePrint: boolean } | null> {
  const database = await getDb();
  const target = (await listSales()).find((sale) => sale.id === saleId);
  if (!target) return null;
  if (target.status === 'VOIDED') throw new Error('Voided invoices cannot be edited.');
  if (target.returnStatus) throw new Error('Invoices with returns cannot be edited.');
  if (!input.items?.length) throw new Error('Invoice cannot be empty.');

  const settings = await getSettings();
  const previousQuantities = new Map<number, number>();
  for (const item of target.items) {
    previousQuantities.set(
      item.productId,
      (previousQuantities.get(item.productId) || 0) +
        item.quantity * (item.unitsPerBase || 1)
    );
  }

  const resolvedItems: Array<{
    product: Product;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    unitId: string;
    unitName: string;
    unitsPerBase: number;
    taxRate: number;
  }> = [];
  const requestedQuantities = new Map<number, number>();
  const availableStocks = new Map<number, number>();

  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error('Invoice item quantities must be positive whole numbers.');
    }

    const productResult = database.exec(
      `SELECT id, sku, barcode, name, name_ar, category, cost_price, retail_price, stock, reorder_level, unit, updated_at, tax_rate, brand, image_data, image_path, multi_units
       FROM products WHERE id = ?`,
      [item.productId]
    );
    if (!productResult[0]?.values[0]) {
      throw new Error(`Product #${item.productId} not found.`);
    }

    const product = mapProductRow(productResult[0].values[0]);
    const multiUnit = item.unitId
      ? product.multiUnits?.find((unit) => unit.id === item.unitId)
      : undefined;
    if (item.unitId && !multiUnit) {
      throw new Error(`The selected unit is not configured for ${product.name}.`);
    }
    const unitsPerBase = multiUnit?.unitsPerBase ?? 1;
    const defaultUnitPrice = multiUnit
      ? multiUnit.price ?? product.retailPrice * unitsPerBase
      : product.retailPrice;
    const unitPrice =
      item.unitPrice !== undefined && Number.isFinite(item.unitPrice) && item.unitPrice >= 0
        ? Number(item.unitPrice)
        : defaultUnitPrice;
    resolvedItems.push({
      product,
      quantity: item.quantity,
      unitPrice,
      lineTotal: Number((unitPrice * item.quantity).toFixed(2)),
      unitId: multiUnit?.id || '',
      unitName: multiUnit?.name || product.unit,
      unitsPerBase,
      taxRate: product.taxRate ?? getDefaultInventoryTaxRate(database),
    });
    requestedQuantities.set(
      product.id,
      (requestedQuantities.get(product.id) || 0) + item.quantity * unitsPerBase
    );
    availableStocks.set(
      product.id,
      product.stock + (previousQuantities.get(product.id) || 0)
    );
  }

  if (!settings.allowNegativeStock) {
    for (const [productId, requestedQuantity] of requestedQuantities) {
      const availableStock = availableStocks.get(productId) || 0;
      if (requestedQuantity > availableStock) {
        const product = resolvedItems.find((item) => item.product.id === productId)?.product;
        throw new Error(
          `Insufficient stock for ${product?.name || `Product #${productId}`} (${availableStock} base units available).`
        );
      }
    }
  }

  const grossTotal = Number(
    resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2)
  );
  const discountValue = Math.max(0, Number(input.discountValue) || 0);
  const discountAmount = discountValue > 0
    ? input.discountType === 'percent'
      ? Number(((grossTotal * Math.min(100, discountValue)) / 100).toFixed(2))
      : Number(Math.min(grossTotal, discountValue).toFixed(2))
    : 0;
  const taxBreakdown = calculateSalesTax(
    resolvedItems.map((item) => ({ amount: item.lineTotal, taxRate: item.taxRate })),
    discountAmount,
    settings.taxType
  );
  const { subtotal, taxAmount } = taxBreakdown;
  const totalTaxRates = [...new Set(resolvedItems.map((item) => item.taxRate))];
  const saleTaxRate = totalTaxRates.length === 1 ? totalTaxRates[0] : 0;
  let total = taxBreakdown.total;
  if (settings.roundTotalToFiveCents) {
    total = Number((Math.round(total * 20) / 20).toFixed(2));
  }

  const amountTendered = input.paymentMethod === 'Cash'
    ? Math.max(total, Number(input.amountTendered || total))
    : total;
  const changeDue = input.paymentMethod === 'Cash'
    ? Number(Math.max(0, amountTendered - total).toFixed(2))
    : 0;
  const now = new Date().toISOString();
  let queuedOfflinePrint = false;

  database.run('BEGIN TRANSACTION');
  try {
    for (const item of target.items) {
      database.run('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?', [
        item.quantity * (item.unitsPerBase || 1),
        now,
        item.productId,
      ]);
    }
    for (const item of resolvedItems) {
      database.run('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?', [
        item.quantity * item.unitsPerBase,
        now,
        item.product.id,
      ]);
    }

    database.run('DELETE FROM sale_items WHERE sale_id = ?', [saleId]);
    for (const [itemIndex, item] of resolvedItems.entries()) {
      const taxLine = taxBreakdown.lines[itemIndex];
      database.run(
        `INSERT INTO sale_items (
           sale_id, product_id, sku, product_name, quantity, unit_price, line_total, name_ar,
           unit_id, unit_name, units_per_base, tax_rate, tax_amount, discount_amount
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId,
          item.product.id,
          item.product.sku,
          item.product.name,
          item.quantity,
          item.unitPrice,
          item.lineTotal,
          item.product.nameAr || '',
          item.unitId,
          item.unitName,
          item.unitsPerBase,
          item.taxRate,
          taxLine.taxAmount,
          taxLine.discountAmount,
        ]
      );
    }

    database.run(
      `UPDATE sales
       SET cashier_name = ?, customer_name = ?, subtotal = ?, discount_type = ?, discount_value = ?,
           discount_amount = ?, tax_rate = ?, tax_type = ?, tax_amount = ?, total = ?, payment_method = ?,
           amount_tendered = ?, change_due = ?, status = 'COMPLETED'
       WHERE id = ?`,
      [
        target.cashierName,
        (input.customerName || '').trim() || 'Walk-in Customer',
        subtotal,
        input.discountType,
        discountValue,
        discountAmount,
        saleTaxRate,
        settings.taxType,
        taxAmount,
        total,
        input.paymentMethod,
        amountTendered,
        changeDue,
        saleId,
      ]
    );

    const pendingPrints = database.exec(
      `SELECT id FROM print_queue WHERE sale_id = ? AND status = 'QUEUED'`,
      [saleId]
    );
    if (pendingPrints[0]?.values.length) {
      database.run(
        `UPDATE print_queue SET created_at = ?, total = ? WHERE sale_id = ? AND status = 'QUEUED'`,
        [now, total, saleId]
      );
      queuedOfflinePrint = true;
    } else if (!settings.printerOnline) {
      database.run(
        `INSERT INTO print_queue (sale_id, receipt_number, created_at, total, status)
         VALUES (?, ?, ?, ?, 'QUEUED')`,
        [saleId, target.receiptNumber, now, total]
      );
      queuedOfflinePrint = true;
    }
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

  saveDatabase();
  const updatedSale = (await listSales()).find((sale) => sale.id === saleId);
  if (!updatedSale) throw new Error(`Updated invoice ${target.receiptNumber} could not be loaded.`);
  return { sale: updatedSale, queuedOfflinePrint };
}

export async function deletePurchase(purchaseId: number): Promise<boolean> {
  const database = await getDb();
  const purchases = await listPurchases();
  const target = purchases.find((p) => p.id === purchaseId);
  if (!target) return false;
  const returnRes = database.exec(
    'SELECT 1 FROM purchase_return_vouchers WHERE purchase_id = ? LIMIT 1',
    [purchaseId]
  );
  if (returnRes[0]?.values.length) {
    throw new Error('Purchase invoices with returns cannot be deleted.');
  }

  const now = new Date().toISOString();
  // Reverse inventory increase: subtract quantities received
  for (const item of target.items) {
    database.run(
      'UPDATE products SET stock = MAX(0, stock - ?), updated_at = ? WHERE id = ?',
      [item.quantity, now, item.productId]
    );
  }

  database.run('DELETE FROM purchase_items WHERE purchase_id = ?', [purchaseId]);
  database.run('DELETE FROM purchases WHERE id = ?', [purchaseId]);

  saveDatabase();
  return true;
}

export async function updatePurchase(
  purchaseId: number,
  input: {
    invoiceNumber?: string;
    vendorId?: number;
    receivedDate?: string;
    paymentStatus?: 'PAID' | 'PENDING' | 'PARTIAL';
    paidAmount?: number;
    notes?: string;
    taxAmount?: number;
    shippingCost?: number;
    updateCostPrices?: boolean;
    items?: Array<{
      productId: number;
      quantity: number;
      unitCost: number;
    }>;
  }
): Promise<PurchaseEntry | null> {
  const database = await getDb();
  const purchases = await listPurchases();
  const target = purchases.find((p) => p.id === purchaseId);
  if (!target) return null;
  const returnRes = database.exec(
    'SELECT 1 FROM purchase_return_vouchers WHERE purchase_id = ? LIMIT 1',
    [purchaseId]
  );
  if (returnRes[0]?.values.length) {
    throw new Error('Purchase invoices with returns cannot be edited.');
  }

  const vendorId = input.vendorId === undefined ? target.vendorId : Number(input.vendorId);
  const vendorRes = database.exec('SELECT name FROM vendors WHERE id = ?', [vendorId]);
  if (!vendorRes[0]?.values[0]) {
    throw new Error('Vendor not found.');
  }
  const vendorName = String(vendorRes[0].values[0][0]);

  const invoiceNumber = input.invoiceNumber !== undefined ? input.invoiceNumber.trim() : target.invoiceNumber;
  const receivedDate = input.receivedDate !== undefined ? input.receivedDate : target.receivedDate;
  const requestedPaymentStatus =
    input.paymentStatus !== undefined ? input.paymentStatus : target.paymentStatus;
  const notes = input.notes !== undefined ? input.notes.trim() : target.notes;
  if (!invoiceNumber) throw new Error('Invoice number is required.');

  const resolvedItems: Array<{
    productId: number;
    sku: string;
    productName: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
  }> | undefined = input.items?.map((item) => {
    const productId = Number(item.productId);
    const quantity = Number(item.quantity);
    const unitCost = Number(item.unitCost);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw new Error('Purchase item has an invalid product.');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Purchase item quantity must be greater than zero.');
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      throw new Error('Purchase item cost must be zero or greater.');
    }
    const productRes = database.exec(
      'SELECT sku, name FROM products WHERE id = ?',
      [productId]
    );
    if (!productRes[0]?.values[0]) {
      throw new Error(`Product #${productId} not found.`);
    }
    return {
      productId,
      sku: String(productRes[0].values[0][0]),
      productName: String(productRes[0].values[0][1]),
      quantity,
      unitCost,
      lineTotal: Number((quantity * unitCost).toFixed(2)),
    };
  });
  if (resolvedItems && resolvedItems.length === 0) {
    throw new Error('Purchase entry must contain at least one item.');
  }

  const subtotal = resolvedItems
    ? Number(resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2))
    : target.subtotal;
  const taxAmount = input.taxAmount === undefined ? target.taxAmount : Number(input.taxAmount);
  const shippingCost = input.shippingCost === undefined ? target.shippingCost : Number(input.shippingCost);
  if (!Number.isFinite(taxAmount) || taxAmount < 0) {
    throw new Error('Tax amount must be zero or greater.');
  }
  if (!Number.isFinite(shippingCost) || shippingCost < 0) {
    throw new Error('Shipping cost must be zero or greater.');
  }
  const total = Number((subtotal + taxAmount + shippingCost).toFixed(2));
  const paidAmount = input.paidAmount !== undefined
    ? Number(input.paidAmount)
    : requestedPaymentStatus === 'PAID'
      ? total
      : requestedPaymentStatus === 'PENDING'
        ? 0
        : target.paymentStatus === 'PARTIAL'
          ? Math.min(target.paidAmount, total)
          : 0;
  if (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > total) {
    throw new Error('Paid amount must be between zero and the purchase total.');
  }
  const paymentStatus = input.paidAmount === undefined
    ? requestedPaymentStatus
    : getPurchasePaymentStatus(paidAmount, total, input.paymentStatus);

  const now = new Date().toISOString();
  database.run('BEGIN IMMEDIATE');
  try {
    if (resolvedItems) {
      const stockDeltas = new Map<number, number>();
      const latestCosts = new Map<number, number>();
      for (const item of target.items) {
        stockDeltas.set(
          item.productId,
          (stockDeltas.get(item.productId) || 0) - item.quantity
        );
      }
      for (const item of resolvedItems) {
        stockDeltas.set(
          item.productId,
          (stockDeltas.get(item.productId) || 0) + item.quantity
        );
        latestCosts.set(item.productId, item.unitCost);
      }

      for (const [productId, delta] of stockDeltas) {
        const productRes = database.exec('SELECT stock FROM products WHERE id = ?', [productId]);
        if (!productRes[0]?.values[0]) {
          throw new Error(`Product #${productId} not found.`);
        }
        const stock = Number(productRes[0].values[0][0]);
        const nextStock = stock + delta;
        if (nextStock < -0.000001) {
          throw new Error(`Cannot reduce product #${productId} stock below zero while editing this purchase.`);
        }
        const safeStock = Math.max(0, nextStock);
        const nextCost = latestCosts.get(productId);
        if (input.updateCostPrices && nextCost !== undefined) {
          database.run(
            'UPDATE products SET stock = ?, cost_price = ?, updated_at = ? WHERE id = ?',
            [safeStock, nextCost, now, productId]
          );
        } else {
          database.run(
            'UPDATE products SET stock = ?, updated_at = ? WHERE id = ?',
            [safeStock, now, productId]
          );
        }
      }

      database.run('DELETE FROM purchase_items WHERE purchase_id = ?', [purchaseId]);
      for (const item of resolvedItems) {
        database.run(
          `INSERT INTO purchase_items (purchase_id, product_id, sku, product_name, quantity, unit_cost, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            purchaseId,
            item.productId,
            item.sku,
            item.productName,
            item.quantity,
            item.unitCost,
            item.lineTotal,
          ]
        );
      }
    }

    database.run(
      `UPDATE purchases
       SET invoice_number = ?, vendor_id = ?, vendor_name = ?, received_date = ?,
           subtotal = ?, tax_amount = ?, shipping_cost = ?, total = ?, payment_status = ?, notes = ?, paid_amount = ?
       WHERE id = ?`,
      [
        invoiceNumber,
        vendorId,
        vendorName,
        receivedDate,
        subtotal,
        taxAmount,
        shippingCost,
        total,
        paymentStatus,
        notes,
        paidAmount,
        purchaseId,
      ]
    );
    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }

  saveDatabase();
  const updatedPurchases = await listPurchases();
  return updatedPurchases.find((p) => p.id === purchaseId) || null;
}

export async function resetDatabase(): Promise<boolean> {
  const database = await getDb();
  const demoAccess = storedDemoAccess(database);
  const systemCode = getSystemCode(database);

  database.run('PRAGMA foreign_keys = OFF');
  let transactionStarted = false;
  try {
    database.run('BEGIN IMMEDIATE');
    transactionStarted = true;
    const objects = database.exec(
      `SELECT type, name FROM sqlite_master
       WHERE type IN ('table', 'view', 'trigger')
         AND name NOT LIKE 'sqlite_%'`
    )[0]?.values ?? [];
    const quotedName = (name: unknown) =>
      `"${String(name).replace(/"/g, '""')}"`;

    for (const [type, name] of objects) {
      if (type === 'trigger' || type === 'view') {
        database.run(`DROP ${String(type).toUpperCase()} IF EXISTS ${quotedName(name)}`);
      }
    }
    for (const [type, name] of objects) {
      if (type === 'table') {
        database.run(`DROP TABLE IF EXISTS ${quotedName(name)}`);
      }
    }

    initSchema(database);
    seedInitialData(database);
    seedInventoryOptions(database);
    restoreDemoAccess(database, demoAccess, systemCode);
    database.run('DELETE FROM sqlite_sequence');
    database.run('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) database.run('ROLLBACK');
    throw error;
  } finally {
    database.run('PRAGMA foreign_keys = ON');
  }

  saveDatabase();

  return true;
}

export async function backupDatabase(): Promise<Buffer> {
  const database = await getDb();
  const data = database.export();
  return Buffer.from(data);
}

export async function restoreDatabase(fileBuffer: Buffer): Promise<boolean> {
  // Validate that the buffer is at least 16 bytes and starts with 'SQLite format 3\0'
  if (fileBuffer.length < 16) {
    throw new Error('Invalid SQLite file: file is too small.');
  }

  const header = fileBuffer.subarray(0, 16).toString('utf-8');
  if (!header.startsWith('SQLite format 3')) {
    throw new Error('Invalid SQLite file format. Must be a valid SQLite database.');
  }

  const database = await getDb();
  const demoAccess = storedDemoAccess(database);
  const SQL = await initSqlJs();
  const newDb = new SQL.Database(fileBuffer);
  
  // Verify basic tables exist or init schema if needed
  initSchema(newDb);
  
  // Replace active database in memory
  db = newDb;
  const systemCode = getSystemCode(newDb);
  restoreDemoAccess(newDb, demoAccess, systemCode);
  saveDatabase();

  return true;
}

export interface ImportProductRow {
  sku: string;
  barcode?: string;
  name: string;
  nameAr?: string;
  name_ar?: string;
  category: ProductCategory;
  costPrice: number;
  retailPrice: number;
  taxRate?: number;
  stock: number;
  reorderLevel?: number;
  unit?: string;
}

export async function importProducts(
  rows: ImportProductRow[]
): Promise<{ imported: number; updated: number; errors: string[] }> {
  const database = await getDb();
  const now = new Date().toISOString();
  let imported = 0;
  let updated = 0;
  const errors: string[] = [];

  const existingProducts = await listProducts();
  const skuMap = new Map(existingProducts.map((p) => [p.sku.toLowerCase(), p]));
  const barcodeMap = new Map(
    existingProducts.flatMap((product) => [
      [product.barcode.toLowerCase(), product] as const,
      ...(product.multiUnits || [])
        .filter((unit) => unit.barcode)
        .map((unit) => [unit.barcode.toLowerCase(), product] as const),
      ...(product.additionalBarcodes || [])
        .map((entry) => [entry.barcode.toLowerCase(), product] as const),
    ])
  );

  database.run('BEGIN TRANSACTION');
  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const sku = (row.sku || '').trim();
        let name = (row.name || '').trim();
        const nameAr = (row.nameAr || row.name_ar || '').trim();
        if (!name && nameAr) {
          name = nameAr;
        }
        if (!sku || !name) {
          errors.push(`Row ${i + 1}: SKU and Name are required.`);
          continue;
        }
        const barcode = (row.barcode || '').trim();
        const category = (row.category || '').trim() as ProductCategory;
        const costPrice = Math.max(0, Number(row.costPrice) || 0);
        const retailPrice = Math.max(0, Number(row.retailPrice) || 0);
        const hasTaxRate = row.taxRate !== undefined && row.taxRate !== null &&
          String(row.taxRate).trim() !== '';
        const taxRate = hasTaxRate ? Number(row.taxRate) : getDefaultInventoryTaxRate(database);
        if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
          throw new Error('Tax rate must be a number between 0 and 100.');
        }
        const stock = Number(row.stock) || 0;
        const reorderLevel = Math.max(0, Number(row.reorderLevel ?? 5));
        const unit = (row.unit || 'ea').trim();

        const existing =
          skuMap.get(sku.toLowerCase()) || (barcode ? barcodeMap.get(barcode.toLowerCase()) : undefined);
        validateProductSku(database, existing?.id ?? null, sku);
        validateProductBarcodes(
          database,
          existing?.id ?? null,
          barcode,
          existing?.multiUnits || [],
          existing?.additionalBarcodes || []
        );
        if (existing) {
          // Update existing product (update Arabic name, prices, tax rate, and details)
          database.run(
            `UPDATE products SET name = ?, name_ar = ?, category = ?, cost_price = ?, retail_price = ?, tax_rate = ?, stock = ?, reorder_level = ?, unit = ?, barcode = ?, updated_at = ? WHERE id = ?`,
            [
              name,
              nameAr || existing.nameAr || '',
              category,
              costPrice,
              retailPrice,
              taxRate,
              stock,
              reorderLevel,
              unit,
              barcode,
              now,
              existing.id,
            ]
          );
          updated++;
        } else {
          // Insert new product
          database.run(
            `INSERT INTO products (sku, barcode, name, name_ar, category, cost_price, retail_price, tax_rate, stock, reorder_level, unit, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [sku, barcode, name, nameAr, category, costPrice, retailPrice, taxRate, stock, reorderLevel, unit, now]
          );
          imported++;
        }
        database.run(
          'INSERT OR IGNORE INTO inventory_options (type, value) VALUES (?, ?)',
          ['taxRate', String(taxRate)]
        );
      } catch (err) {
        errors.push(`Row ${i + 1} (${row.sku || 'Unknown'}): ${(err as Error).message}`);
      }
    }
    database.run('COMMIT');
  } catch (err) {
    database.run('ROLLBACK');
    throw err;
  }

  saveDatabase();
  return { imported, updated, errors };
}
