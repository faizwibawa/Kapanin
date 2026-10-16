import { createReadStream, readFileSync, appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const envPath = resolve(root, '.env');
const dataDir = resolve(root, 'data/store_1');
const demoEmail = 'kapanin-demo-store1@example.com';
const asOfDate = '2026-10-01';
const batchSize = 500;
const apply = process.argv.includes('--apply');
if (process.argv.some(arg => arg.startsWith('--') && arg !== '--apply')) {
  throw new Error('Usage: node scripts/import-demo.mjs [--apply]');
}

function readEnv() {
  let source = '';
  try { source = readFileSync(envPath, 'utf8'); } catch { /* process.env may provide all keys */ }
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*([A-Z_]+)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return { ...values, ...process.env };
}

async function* rows(file, expectedColumns) {
  const lines = createInterface({ input: createReadStream(resolve(dataDir, file)), crlfDelay: Infinity });
  let header;
  for await (const line of lines) {
    if (!header) {
      header = line.split(',');
      if (header.join(',') !== expectedColumns.join(',')) throw new Error(`${file}: unexpected CSV header`);
      continue;
    }
    if (line.includes('"')) throw new Error(`${file}: quoted CSV requires a full parser`);
    const cells = line.split(',');
    if (cells.length !== header.length) throw new Error(`${file}: malformed CSV row`);
    yield Object.fromEntries(header.map((key, index) => [key, cells[index]]));
  }
}

function uuid(kind, sourceId, ownerId) {
  const bytes = createHash('sha1').update(`kapanin:store1:${ownerId}:${kind}:${sourceId}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function money(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label}`);
  return number;
}

function date(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function count(value, label, allowZero = true) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1)) throw new Error(`Invalid ${label}`);
  return number;
}

async function upsert(client, table, batch) {
  if (!batch.length) return;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const { error } = await client.from(table).upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
    if (!error) return;
    if (attempt === 4 || !/fetch|timeout|429|502|503|504/i.test(error.message)) {
      throw new Error(`${table} import failed: ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
  }
}

async function findOrCreateOwner(client) {
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Cannot list demo users: ${error.message}`);
    const existing = data.users.find(user => user.email === demoEmail);
    if (existing) return existing.id;
    if (data.users.length < 1000) break;
  }
  const { data, error } = await client.auth.admin.createUser({
    email: demoEmail,
    password: randomBytes(32).toString('base64url'),
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Cannot create demo owner: ${error?.message ?? 'missing user'}`);
  return data.user.id;
}

async function main() {
  const productIds = new Set();
  const products = [];
  let stockUnits = 0;
  for await (const row of rows('products.csv', [
    'product_id','store_id','sku','product_name','category','brand','unit_cost','list_price',
    'stock_on_hand','stock_as_of_date','stock_received_date','expiry_date','is_seasonal',
  ])) {
    if (row.store_id !== '1' || !/^P\d+$/.test(row.product_id) || productIds.has(row.product_id)) {
      throw new Error('Invalid or duplicate product id/store');
    }
    productIds.add(row.product_id);
    if (row.stock_as_of_date !== asOfDate) throw new Error('Unexpected stock snapshot date');
    const quantity = count(row.stock_on_hand, 'stock_on_hand');
    stockUnits += quantity;
    products.push({ ...row, quantity, cost: money(row.unit_cost, 'unit_cost'),
      price: money(row.list_price, 'list_price'), stockSince: date(row.stock_received_date, 'stock_received_date') });
  }

  let salesCount = 0;
  let discountedCount = 0;
  const saleIds = new Set();
  for await (const row of rows('transactions.csv', [
    'transaction_id','store_id','product_id','transaction_date','quantity','unit_list_price',
    'unit_sale_price','discount_rate','promotion_type','event_name','data_origin',
  ])) {
    if (row.store_id !== '1' || !/^TRX\d+$/.test(row.transaction_id) || saleIds.has(row.transaction_id)
      || !productIds.has(row.product_id)) throw new Error('Invalid/duplicate sale or missing product');
    saleIds.add(row.transaction_id);
    date(row.transaction_date, 'transaction_date');
    count(row.quantity, 'quantity', false);
    const regular = money(row.unit_list_price, 'unit_list_price');
    const sold = money(row.unit_sale_price, 'unit_sale_price');
    if (sold > regular) throw new Error('Sale price exceeds regular price');
    if (sold < regular) discountedCount++;
    salesCount++;
  }
  console.log(`CSV validated: ${products.length} products, ${stockUnits} stock units, ${salesCount} sales, ${discountedCount} discounted sales.`);
  if (!apply) {
    console.log('Dry run only. Use --apply to import into the configured Supabase project.');
    return;
  }

  const env = readEnv();
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ownerId = await findOrCreateOwner(client);
  if (env.DEMO_OWNER_ID && env.DEMO_OWNER_ID !== ownerId) throw new Error('DEMO_OWNER_ID does not match the demo user');
  const productMap = new Map(products.map(row => [row.product_id, row]));
  for (let i = 0; i < products.length; i += batchSize) {
    const slice = products.slice(i, i + batchSize);
    await upsert(client, 'products', slice.map(row => ({
      id: uuid('product', row.product_id, ownerId), owner_id: ownerId,
      name: row.product_name, category: row.category, cost: row.cost, price: row.price,
    })));
    await upsert(client, 'stock', slice.map(row => ({
      id: uuid('stock', row.product_id, ownerId), owner_id: ownerId,
      product_id: uuid('product', row.product_id, ownerId), quantity: row.quantity,
      stock_since: row.stockSince,
    })));
  }
  console.log(`Imported products and stock: ${products.length}/${products.length}`);

  let batch = [];
  let processed = 0;
  for await (const row of rows('transactions.csv', [
    'transaction_id','store_id','product_id','transaction_date','quantity','unit_list_price',
    'unit_sale_price','discount_rate','promotion_type','event_name','data_origin',
  ])) {
    batch.push({
      id: uuid('sale', row.transaction_id, ownerId), owner_id: ownerId,
      product_id: uuid('product', row.product_id, ownerId),
      sold_on: row.transaction_date, quantity: Number(row.quantity),
      price_sold: Number(row.unit_sale_price), regular_price_at_sale: Number(row.unit_list_price),
      unit_cost_at_sale: productMap.get(row.product_id).cost,
      discount_id: null,
    });
    if (batch.length === batchSize) {
      await upsert(client, 'sales', batch);
      processed += batch.length;
      batch = [];
      if (processed % 10000 === 0) console.log(`Imported sales: ${processed}/${salesCount}`);
    }
  }
  await upsert(client, 'sales', batch);
  processed += batch.length;

  const additions = [];
  if (!env.DEMO_OWNER_ID) additions.push(`DEMO_OWNER_ID=${ownerId}`);
  if (!env.DEMO_AS_OF_DATE) additions.push(`DEMO_AS_OF_DATE=${asOfDate}`);
  if (additions.length) appendFileSync(envPath, `\n${additions.join('\n')}\n`, { mode: 0o600 });
  console.log(`Import complete: ${products.length} products, ${products.length} stock rows, ${processed} sales. Demo owner: ${ownerId}`);
  console.log('DEMO_OWNER_ID and DEMO_AS_OF_DATE are set in the git-ignored root .env.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
