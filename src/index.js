const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json;charset=UTF-8' }
});
const body = async r => { try { return await r.json(); } catch { return {}; } };
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const cleanBarcode = v => String(v || '').replace(/[^0-9A-Za-z]/g, '').trim();
const norm = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
const isoDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : new Date().toISOString().slice(0, 10);

async function all(db, sql, bind = []) { return (await db.prepare(sql).bind(...bind).all()).results || []; }
async function one(db, sql, bind = []) { return await db.prepare(sql).bind(...bind).first(); }
function itemLabel(i) { return [i.brand, i.expression, i.size].filter(Boolean).join(' '); }

let enhancementReady = null;
async function ensureEnhancements(db) {
  if (enhancementReady) return enhancementReady;
  enhancementReady = (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS inventory_barcodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        inventory_id INTEGER NOT NULL,
        barcode TEXT NOT NULL UNIQUE,
        is_primary INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(inventory_id) REFERENCES inventory(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_inventory_barcodes_inventory ON inventory_barcodes(inventory_id)`,
      `CREATE TABLE IF NOT EXISTS supplier_price_imports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        supplier TEXT NOT NULL,
        file_name TEXT DEFAULT '',
        effective_from TEXT NOT NULL,
        effective_through TEXT,
        row_count INTEGER DEFAULT 0,
        matched_count INTEGER DEFAULT 0,
        imported_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS supplier_prices (
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_supplier_prices_inventory_date ON supplier_prices(inventory_id,effective_from)`,
      `CREATE INDEX IF NOT EXISTS idx_supplier_prices_barcode ON supplier_prices(barcode)`,
      `CREATE INDEX IF NOT EXISTS idx_supplier_prices_import ON supplier_prices(import_id)`,
      `CREATE TABLE IF NOT EXISTS purchases (
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
      )`,
      `CREATE INDEX IF NOT EXISTS idx_purchases_inventory_date ON purchases(inventory_id,purchase_date)`
    ];
    for (const sql of statements) await db.prepare(sql).run();
  })().catch(err => { enhancementReady = null; throw err; });
  return enhancementReady;
}

async function inventoryRows(db) {
  return all(db, `SELECT i.*,
    (SELECT b.barcode FROM inventory_barcodes b WHERE b.inventory_id=i.id ORDER BY b.is_primary DESC,b.id LIMIT 1) barcode
    FROM inventory i WHERE i.active=1 ORDER BY i.category,i.brand,i.expression,i.size`);
}

async function savePrimaryBarcode(db, inventoryId, barcode) {
  const code = cleanBarcode(barcode);
  const existing = code ? await one(db, 'SELECT inventory_id FROM inventory_barcodes WHERE barcode=?', [code]) : null;
  if (existing && Number(existing.inventory_id) !== Number(inventoryId)) {
    throw new Error('That barcode is already attached to another inventory item.');
  }
  await db.prepare('DELETE FROM inventory_barcodes WHERE inventory_id=?').bind(inventoryId).run();
  if (code) {
    await db.prepare('INSERT INTO inventory_barcodes(inventory_id,barcode,is_primary) VALUES(?,?,1)').bind(inventoryId, code).run();
    await db.prepare('UPDATE supplier_prices SET inventory_id=? WHERE inventory_id IS NULL AND barcode=?').bind(inventoryId, code).run();
  }
}

async function priceReview(db) {
  return all(db, `SELECT MIN(sp.id) id, sp.import_id, sp.supplier, sp.barcode, sp.product_name, sp.size, sp.supplier_sku,
    GROUP_CONCAT(sp.price_type || ' · $' || printf('%.2f',sp.unit_price), ' | ') prices,
    MIN(sp.effective_from) effective_from
    FROM supplier_prices sp
    WHERE sp.inventory_id IS NULL
    GROUP BY sp.import_id,sp.supplier,sp.barcode,sp.product_name,sp.size,sp.supplier_sku
    ORDER BY MIN(sp.id) DESC LIMIT 100`);
}

async function currentPriceOptions(db, inventoryId, purchaseDate) {
  const d = isoDate(purchaseDate);
  return all(db, `SELECT * FROM (
      SELECT sp.*, ROW_NUMBER() OVER (
        PARTITION BY sp.supplier, sp.price_type
        ORDER BY sp.effective_from DESC, sp.id DESC
      ) rn
      FROM supplier_prices sp
      WHERE sp.inventory_id=?
        AND sp.effective_from<=?
        AND (sp.effective_through IS NULL OR sp.effective_through='' OR sp.effective_through>=?)
    ) x WHERE rn=1
    ORDER BY supplier,price_type`, [inventoryId, d, d]);
}

function matchInventoryForPrice(row, inventory, barcodeToId) {
  const code = cleanBarcode(row.barcode);
  if (code && barcodeToId[code]) return barcodeToId[code];
  const target = norm(`${row.product_name || ''} ${row.size || ''}`);
  if (!target) return null;
  const exact = inventory.find(i => norm(`${i.brand || ''} ${i.expression || ''} ${i.size || ''}`) === target);
  if (exact) return exact.id;
  const targetNoSize = norm(row.product_name || '');
  const exactNoSize = inventory.find(i => norm(`${i.brand || ''} ${i.expression || ''}`) === targetNoSize && (!row.size || norm(i.size) === norm(row.size)));
  return exactNoSize?.id || null;
}

export default {
  async fetch(request, env) {
    const u = new URL(request.url), p = u.pathname, m = request.method;
    try {
      if (p.startsWith('/api/')) await ensureEnhancements(env.DB);

      if (p === '/api/health') return json({ ok: true, app: 'ParUp', version: '1.1.0' });

      if (p === '/api/bootstrap' && m === 'GET') {
        const [inventory, mappings, settings, imports, priceImports, purchases, review] = await Promise.all([
          inventoryRows(env.DB),
          all(env.DB, `SELECT m.*, i.brand,i.expression,i.size FROM mappings m LEFT JOIN inventory i ON i.id=m.inventory_id ORDER BY m.toast_item`),
          all(env.DB, 'SELECT * FROM settings'),
          all(env.DB, 'SELECT * FROM imports ORDER BY imported_at DESC LIMIT 12'),
          all(env.DB, 'SELECT * FROM supplier_price_imports ORDER BY imported_at DESC LIMIT 12'),
          all(env.DB, `SELECT p.*,i.brand,i.expression,i.size FROM purchases p JOIN inventory i ON i.id=p.inventory_id ORDER BY p.purchase_date DESC,p.id DESC LIMIT 25`),
          priceReview(env.DB)
        ]);
        return json({
          inventory, mappings,
          settings: Object.fromEntries(settings.map(x => [x.key, JSON.parse(x.value)])),
          imports, priceImports, purchases, priceReview: review
        });
      }

      if (p === '/api/inventory' && m === 'POST') {
        const b = await body(request);
        const r = await env.DB.prepare(`INSERT INTO inventory(category,brand,expression,size,unit_cost,open_qty,sealed_qty,weekly_par,sold_as,distributor,item_type,large_format_eligible,notes)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING *`)
          .bind(b.category || 'Other', b.brand || 'New Item', b.expression || '', b.size || '', num(b.unit_cost), num(b.open_qty), num(b.sealed_qty), num(b.weekly_par), b.sold_as || 'Counted Item', b.distributor || 'Southern', b.item_type || 'Liquor', b.large_format_eligible ? 1 : 0, b.notes || '').first();
        await savePrimaryBarcode(env.DB, r.id, b.barcode || '');
        r.barcode = cleanBarcode(b.barcode || '');
        return json(r, 201);
      }

      const im = p.match(/^\/api\/inventory\/(\d+)$/);
      if (im && m === 'PUT') {
        const b = await body(request), id = +im[1];
        await env.DB.prepare(`UPDATE inventory SET category=?,brand=?,expression=?,size=?,unit_cost=?,open_qty=?,sealed_qty=?,weekly_par=?,sold_as=?,distributor=?,item_type=?,large_format_eligible=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(b.category, b.brand, b.expression || '', b.size || '', num(b.unit_cost), num(b.open_qty), num(b.sealed_qty), num(b.weekly_par), b.sold_as, b.distributor || 'Southern', b.item_type || 'Liquor', b.large_format_eligible ? 1 : 0, b.notes || '', id).run();
        await savePrimaryBarcode(env.DB, id, b.barcode || '');
        return json({ ok: true });
      }
      if (im && m === 'DELETE') {
        await env.DB.prepare('UPDATE inventory SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(+im[1]).run();
        return json({ ok: true });
      }

      if (p === '/api/settings' && m === 'PUT') {
        const b = await body(request);
        for (const [k, v] of Object.entries(b)) {
          await env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).bind(k, JSON.stringify(v)).run();
        }
        return json({ ok: true });
      }

      if (p === '/api/mappings' && m === 'POST') {
        const b = await body(request);
        await env.DB.prepare(`INSERT INTO mappings(toast_item,inventory_id,sale_type,usage_amount,usage_unit,status,updated_at)
          VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)
          ON CONFLICT(toast_item) DO UPDATE SET inventory_id=excluded.inventory_id,sale_type=excluded.sale_type,usage_amount=excluded.usage_amount,usage_unit=excluded.usage_unit,status=excluded.status,updated_at=CURRENT_TIMESTAMP`)
          .bind(b.toast_item, b.inventory_id || null, b.sale_type || 'Needs Review', num(b.usage_amount), b.usage_unit || 'oz', b.status || 'Mapped').run();
        return json({ ok: true });
      }

      if (p === '/api/imports' && m === 'POST') {
        const b = await body(request), rows = Array.isArray(b.rows) ? b.rows : [];
        if (!rows.length) return json({ error: 'No sales rows found.' }, 400);
        const ins = await env.DB.prepare('INSERT INTO imports(file_name,week_label,row_count) VALUES(?,?,?) RETURNING id')
          .bind(b.file_name || 'Toast export', b.week_label || '', rows.length).first();
        const stmts = rows.slice(0, 10000).map(r => env.DB.prepare('INSERT INTO sales(import_id,toast_item,quantity,net_sales,raw_json) VALUES(?,?,?,?,?)')
          .bind(ins.id, String(r.toast_item || '').trim(), num(r.quantity), num(r.net_sales), JSON.stringify(r.raw || {})));
        for (let i = 0; i < stmts.length; i += 75) await env.DB.batch(stmts.slice(i, i + 75));
        const names = [...new Set(rows.map(r => String(r.toast_item || '').trim()).filter(Boolean))];
        for (const name of names) await env.DB.prepare(`INSERT OR IGNORE INTO mappings(toast_item,sale_type,status) VALUES(?,'Needs Review','Review')`).bind(name).run();
        return json({ ok: true, import_id: ins.id, rows: rows.length, unique_items: names.length }, 201);
      }

      // Barcode scan: exact inventory match first; supplier-price suggestion second.
      const scan = p.match(/^\/api\/scan\/(.+)$/);
      if (scan && m === 'GET') {
        const code = cleanBarcode(decodeURIComponent(scan[1]));
        if (!code) return json({ error: 'No barcode supplied.' }, 400);
        const inv = await one(env.DB, `SELECT i.*,b.barcode FROM inventory_barcodes b JOIN inventory i ON i.id=b.inventory_id WHERE b.barcode=? AND i.active=1`, [code]);
        if (inv) {
          const prices = await currentPriceOptions(env.DB, inv.id, u.searchParams.get('date'));
          return json({ found: true, barcode: code, inventory: inv, prices });
        }
        const suggestions = await all(env.DB, `SELECT sp.* FROM supplier_prices sp WHERE sp.barcode=? ORDER BY sp.effective_from DESC,sp.id DESC LIMIT 12`, [code]);
        return json({ found: false, barcode: code, suggestions });
      }

      if (p === '/api/price-options' && m === 'GET') {
        const id = Number(u.searchParams.get('inventory_id'));
        if (!id) return json({ error: 'inventory_id is required.' }, 400);
        return json({ options: await currentPriceOptions(env.DB, id, u.searchParams.get('date')) });
      }

      if (p === '/api/price-imports' && m === 'POST') {
        const b = await body(request), rows = Array.isArray(b.rows) ? b.rows : [];
        if (!rows.length) return json({ error: 'No supplier price rows found.' }, 400);
        const supplier = String(b.supplier || '').trim() || 'Other';
        const effectiveFrom = isoDate(b.effective_from);
        const effectiveThrough = /^\d{4}-\d{2}-\d{2}$/.test(String(b.effective_through || '')) ? String(b.effective_through) : null;
        const inventory = await inventoryRows(env.DB);
        const barcodeRows = await all(env.DB, 'SELECT barcode,inventory_id FROM inventory_barcodes');
        const barcodeToId = Object.fromEntries(barcodeRows.map(x => [x.barcode, x.inventory_id]));
        let matchedProducts = 0, priceRecords = 0;
        const imp = await env.DB.prepare(`INSERT INTO supplier_price_imports(supplier,file_name,effective_from,effective_through,row_count,matched_count)
          VALUES(?,?,?,?,?,0) RETURNING id`).bind(supplier, b.file_name || 'Supplier price book', effectiveFrom, effectiveThrough, rows.length).first();

        const inserts = [];
        for (const row of rows) {
          const prices = Array.isArray(row.prices) ? row.prices.filter(x => num(x.unit_price) > 0) : [];
          if (!prices.length || !String(row.product_name || '').trim()) continue;
          const inventoryId = matchInventoryForPrice(row, inventory, barcodeToId);
          if (inventoryId) matchedProducts++;
          for (const pr of prices) {
            inserts.push(env.DB.prepare(`INSERT INTO supplier_prices(import_id,supplier,inventory_id,supplier_sku,barcode,product_name,size,price_type,unit_price,effective_from,effective_through,source_row_json)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
              .bind(imp.id, supplier, inventoryId || null, String(row.supplier_sku || ''), cleanBarcode(row.barcode), String(row.product_name || '').trim(), String(row.size || '').trim(), String(pr.price_type || b.default_price_type || 'Other / Manual'), num(pr.unit_price), effectiveFrom, effectiveThrough, JSON.stringify(row.raw || {})));
            priceRecords++;
          }
        }
        for (let i = 0; i < inserts.length; i += 60) await env.DB.batch(inserts.slice(i, i + 60));
        await env.DB.prepare('UPDATE supplier_price_imports SET matched_count=? WHERE id=?').bind(matchedProducts, imp.id).run();
        return json({ ok: true, import_id: imp.id, products: rows.length, matched: matchedProducts, price_records: priceRecords, review: rows.length - matchedProducts }, 201);
      }

      if (p === '/api/price-map' && m === 'POST') {
        const b = await body(request), priceId = Number(b.price_id), inventoryId = Number(b.inventory_id);
        if (!priceId || !inventoryId) return json({ error: 'price_id and inventory_id are required.' }, 400);
        const row = await one(env.DB, 'SELECT * FROM supplier_prices WHERE id=?', [priceId]);
        if (!row) return json({ error: 'Price-book row not found.' }, 404);
        await env.DB.prepare(`UPDATE supplier_prices SET inventory_id=? WHERE import_id=? AND supplier=? AND product_name=? AND size=? AND COALESCE(barcode,'')=?`)
          .bind(inventoryId, row.import_id, row.supplier, row.product_name, row.size || '', row.barcode || '').run();
        if (row.barcode) {
          const existing = await one(env.DB, 'SELECT inventory_id FROM inventory_barcodes WHERE barcode=?', [row.barcode]);
          if (!existing) await env.DB.prepare('INSERT INTO inventory_barcodes(inventory_id,barcode,is_primary) VALUES(?,?,1)').bind(inventoryId, row.barcode).run();
        }
        return json({ ok: true });
      }

      if (p === '/api/purchases' && m === 'POST') {
        const b = await body(request);
        const inventoryId = Number(b.inventory_id), quantity = num(b.quantity), unitPrice = num(b.unit_price);
        if (!inventoryId || quantity <= 0 || unitPrice < 0) return json({ error: 'Item, quantity and unit price are required.' }, 400);
        const purchaseDate = isoDate(b.purchase_date);
        const supplier = String(b.supplier || 'Other');
        const priceType = String(b.price_type || 'Other / Manual');
        const barcode = cleanBarcode(b.barcode);
        const total = quantity * unitPrice;
        const r = await env.DB.prepare(`INSERT INTO purchases(inventory_id,barcode,quantity,purchase_date,supplier,price_type,unit_price,total_cost,supplier_price_id,notes)
          VALUES(?,?,?,?,?,?,?,?,?,?) RETURNING id`).bind(inventoryId, barcode, quantity, purchaseDate, supplier, priceType, unitPrice, total, b.supplier_price_id || null, b.notes || '').first();
        // Current inventory gets the received stock and latest actual unit cost.
        // Historical purchase rows retain the price snapshot forever.
        await env.DB.prepare(`UPDATE inventory SET sealed_qty=sealed_qty+?,unit_cost=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(quantity, unitPrice, inventoryId).run();
        return json({ ok: true, id: r.id, total_cost: total }, 201);
      }

      if (p === '/api/report' && m === 'GET') {
        const imp = await one(env.DB, 'SELECT * FROM imports ORDER BY imported_at DESC LIMIT 1');
        if (!imp) return json({ hasData: false });
        const inventory = await inventoryRows(env.DB);
        const sales = await all(env.DB, `SELECT s.toast_item,SUM(s.quantity) quantity,SUM(s.net_sales) net_sales,m.inventory_id,m.sale_type,m.usage_amount,m.usage_unit,m.status
          FROM sales s LEFT JOIN mappings m ON m.toast_item=s.toast_item WHERE s.import_id=?
          GROUP BY s.toast_item,m.inventory_id,m.sale_type,m.usage_amount,m.usage_unit,m.status`, [imp.id]);
        const byId = Object.fromEntries(inventory.map(i => [i.id, { ...i, est_used: 0, whole_sold: 0, sales_qty: 0 }]));
        let full = 0, review = 0, totalActivity = 0;
        for (const s of sales) {
          totalActivity += num(s.quantity);
          if (!s.inventory_id || s.status !== 'Mapped') { review++; continue; }
          const i = byId[s.inventory_id]; if (!i) continue;
          i.sales_qty += num(s.quantity);
          if (s.sale_type === 'Whole Bottle') {
            i.whole_sold += num(s.quantity); i.est_used += num(s.quantity); full += num(s.quantity);
          } else if (['Pour', 'Double', 'Wine Glass'].includes(s.sale_type)) {
            const oz = num(s.usage_amount) * num(s.quantity), ml = parseFloat(i.size) || 750, bottleOz = ml * 0.033814;
            i.est_used += bottleOz ? oz / bottleOz : 0;
          } else if (s.sale_type === 'Counted Item') i.est_used += num(s.quantity);
        }
        const items = Object.values(byId).map(i => {
          const on = num(i.open_qty) + num(i.sealed_qty), need = Math.max(0, num(i.weekly_par) - on);
          return { ...i, on_hand: on, need_order: need, label: itemLabel(i) };
        });
        const order = items.filter(i => i.need_order > 0), top = [...items].sort((a, b) => b.est_used - a.est_used)[0];
        return json({
          hasData: true, import: imp,
          metrics: {
            salesActivity: totalActivity, fullBottles: full,
            needsOrdered: order.reduce((a, x) => a + x.need_order, 0),
            topMover: top?.label || '—', reviewItems: review,
            estimatedOrderCost: order.reduce((a, x) => a + x.need_order * num(x.unit_cost), 0)
          },
          items, order,
          largeFormat: items.filter(i => i.large_format_eligible && i.est_used > 0).sort((a, b) => b.est_used - a.est_used)
        });
      }

      if (p.startsWith('/api/')) return json({ error: 'Not found' }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: e.message || 'Server error' }, 500);
    }
  }
};
