# ParUp — Live V1

Bar inventory, Toast sales mapping, weekly pars, ordering intelligence and weekly reporting for **MIK Restaurant & Lounge**. Designed & developed by **KNW Creative & Consulting**.

## What is live in V1
- Persistent D1 inventory database
- Add/edit/remove bar items and counts
- Persistent admin settings
- CSV/XLSX Toast upload in the browser
- Remembered Toast-to-inventory mapping
- Explicit Whole Bottle mapping (never inferred from price)
- Weekly report based on latest import + current inventory
- Order suggestions and estimated order cost
- Large-format watch list
- MIK client branding + KNW developer credit

## First Cloudflare setup
1. Create a D1 database named `parup-db`.
2. Copy its database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.
3. In D1 Console, run `schema.sql`, then run `seed.sql` once.
4. Deploy the GitHub repository as a Worker. Build command can be left blank; deploy command: `npx wrangler deploy`.
5. Cloudflare will install the `wrangler` devDependency from `package.json` during build.

## Local development (optional)
```bash
npm install
npm run db:local
npm run db:seed:local
npm run dev
```

## Important V1 notes
- The Excel reader is loaded from the SheetJS CDN in `public/index.html`. CSV works through the same parser.
- Toast exports vary. ParUp auto-detects common item/quantity/net-sales column names; always review the preview before importing.
- Inventory depletion from sales is **theoretical usage**. Physical counts remain the source of truth.
- ParUp never changes pars automatically.
- Distributor costs should be updated as Southern's clean catalog/cost list becomes available.
- Seed data is starter operational data, not a substitute for the first physical count.
