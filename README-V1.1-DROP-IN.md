# ParUp V1.1 — Barcode + Supplier Pricing Drop-In

This update is designed to be uploaded **on top of the existing live ParUp repository**.

## What this adds

- Phone-camera barcode scanning with manual UPC fallback.
- UPC/barcode saved to the ParUp inventory item.
- Scan → item lookup → receive stock workflow.
- If a barcode is unknown, ParUp checks imported supplier price books and suggests the product; you can correct it before saving.
- Supplier price-book imports for **FWGS**, **Southern Glazer**, or Other from CSV/XLS/XLSX.
- Price types including:
  - FWGS Licensee
  - FWGS Sale
  - Southern Regular
  - Southern Promo/Special
  - Other / Manual
- Effective-from pricing (optional effective-through date).
- Price-book matching by barcode first, then exact product name + size; uncertain matches wait for review.
- Price dropdown when receiving stock, based on the purchase date.
- Purchase history stores an immutable snapshot of supplier, price type, unit price, quantity, and date.
- Receiving stock increases sealed/on-hand inventory and updates the item's latest actual cost.

## Historical price rule

Supplier imports are **append-only price history**. They do not edit old purchase records.

When ParUp needs a price for a purchase date, it selects the latest imported price whose `effective_from` is on or before that date (and whose optional `effective_through` has not passed). A purchase then stores the selected unit price as its own snapshot. Later imports cannot change it.

## Files to upload to GitHub

Upload the contents of this package over the existing repository:

- `public/index.html` → replaces the current frontend.
- `src/index.js` → replaces the current Worker/API.
- `schema.sql` → replaces the reference schema for future installs.
- `migrations/002_barcode_supplier_pricing.sql` → new reference migration.

**Do not replace your existing `wrangler.jsonc`.** Your live file already contains the real D1 database ID and `workers_dev` setting.

## Database migration

No manual D1 step is required for this update. The Worker runs idempotent `CREATE TABLE IF NOT EXISTS` statements on the first API request after deployment.

The SQL migration is included as a backup/reference and is safe to run more than once if you ever want to initialize the tables manually.

## Supplier-file expectations

V1.1 reads CSV/XLS/XLSX. It auto-detects common product/description, UPC/barcode, size, SKU, licensee, sale, promo/special, regular, bottle price, and unit-price columns.

ParUp intentionally does **not** automatically treat a case-only price as a bottle/unit price because that could create bad purchasing math. A PDF-only or image-only supplier packet is not automatically parsed in this build; use an exported spreadsheet/CSV when available.

## Quick test after Cloudflare deploys

1. Open ParUp and confirm **LIVE V1.1 · KNW** appears in the header.
2. Inventory → edit one item → add its UPC → save.
3. Scan & Receive → scan/type that UPC → confirm the item appears.
4. Supplier Pricing → import a small FWGS/Southern spreadsheet with an effective date.
5. Scan & Receive → select the item → confirm current price options appear.
6. Receive 1 test unit using a price option → verify Sealed/On Hand increases by 1 and the purchase appears in Recent Purchases.
7. Import a newer supplier price effective tomorrow; the prior test purchase should retain its original price.
