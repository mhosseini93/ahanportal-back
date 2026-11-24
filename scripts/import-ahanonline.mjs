// Usage: npm run import:ahanonline -- "<path to database_ahaonline_latest.dump(.gz)>"
//
// One-off import of the product catalog structure (product types and products with
// their attributes) from a plain-SQL pg_dump of the old ahanonline database.
// Only the COPY sections of product_type and product are read; nothing else in the
// dump (users, quotes, ...) is touched. Descriptions, SEO texts and prices are not
// imported. Safe to run again: rows are matched by their old id (legacy_id).
// Run the backend once first so the migrations have created the tables.
import { createReadStream, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import pg from 'pg';

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the environment
}

const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('Usage: npm run import:ahanonline -- "<path to dump(.gz)>"');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (copy .env.example to .env first)');
  process.exit(1);
}

// Product columns that become attribute values (keys of the attributes table)
const ATTRIBUTE_KEYS = [
  'brand', 'size', 'thickness', 'standard', 'state', 'stock', 'sch', 'color', 'weight', 'od', 'color_code',
];
const STATUSES = new Set(['publish', 'draft']);

// --- Reading the dump --------------------------------------------------------

// COPY text format escapes
function decode(value) {
  if (value === '\\N') return null;
  return value.replace(/\\(.)/g, (_, c) => ({ t: '\t', n: '\n', r: '\r', b: '\b', f: '\f', v: '\v' })[c] ?? c);
}

async function readTables(path, wanted) {
  let input = createReadStream(path);
  if (path.endsWith('.gz')) input = input.pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  const tables = {};
  let current = null;
  for await (const line of lines) {
    if (!current) {
      if (!line.startsWith('COPY ')) continue;
      const name = line.split(' ')[1];
      if (!wanted.includes(name)) continue;
      const columns = line
        .slice(line.indexOf('(') + 1, line.indexOf(')'))
        .split(', ')
        .map((c) => c.replace(/"/g, ''));
      current = { name, columns, rows: [] };
      continue;
    }
    if (line === '\\.') {
      tables[current.name] = current.rows;
      current = null;
      if (Object.keys(tables).length === wanted.length) break;
      continue;
    }
    const values = line.split('\t');
    const row = {};
    current.columns.forEach((column, i) => (row[column] = decode(values[i])));
    current.rows.push(row);
  }
  lines.close();
  input.destroy();
  for (const name of wanted) if (!tables[name]) throw new Error(`Table ${name} not found in the dump`);
  return tables;
}

// --- Cleaning ----------------------------------------------------------------

// Arabic letters to Persian, single spaces, trimmed; empty → null
function clean(value) {
  if (value == null) return null;
  const text = String(value)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' || text === '-' ? null : text;
}

const UNIT_ALIASES = { 'متر مربع': 'مترمربع' };
const cleanUnit = (value) => {
  const unit = clean(value);
  return unit ? (UNIT_ALIASES[unit] ?? unit) : '';
};

// Same rules as SLUG_PATTERN in src/content.ts
function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[\s‌_/.]+/g, '-')
    .replace(/[^a-z0-9؀-ۿ-]/g, '')
    .replace(/[،؛؟٪-٭]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 150)
    .replace(/-$/, '');
}

// Unique slug: the cleaned slug, else the name; suffixed with the old id on clashes
function uniqueSlug(used, preferred, fallback, id) {
  let slug = slugify(preferred) || slugify(fallback) || `item-${id}`;
  if (used.has(slug)) slug = `${slug}-${id}`;
  used.add(slug);
  return slug;
}

// Unique CRM id or null (a few old rows share one)
function uniqueCrm(used, value) {
  const crm = clean(value);
  if (!crm || used.has(crm)) return null;
  used.add(crm);
  return crm;
}

// properties: [{ key, text, type }] → [{ key, label, inTable }] for known attribute keys
function typeAttributes(json) {
  let list = [];
  try {
    list = JSON.parse(json ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const key = item?.key;
    if (!ATTRIBUTE_KEYS.includes(key) || seen.has(key)) continue;
    seen.add(key);
    result.push({ key, label: clean(item.text) ?? key, inTable: true });
  }
  return result;
}

function typeGroupBy(json, attributes) {
  try {
    const column = JSON.parse(json ?? 'null')?.column;
    return attributes.some((a) => a.key === column) ? column : null;
  } catch {
    return null;
  }
}

// --- Import ------------------------------------------------------------------

console.log(`Reading ${file} ...`);
const tables = await readTables(file, ['public.product_type', 'public.product']);

const liveTypes = tables['public.product_type'].filter((t) => !t.deletedAt && !t.redirectType && clean(t.name));
const typesById = new Map(liveTypes.map((t) => [t.id, t]));

// Parents first; a parent that was not imported (deleted or a redirect) makes the type a root
const depth = (t, seen = 0) =>
  !t.parentId || !typesById.has(t.parentId) || seen > 10 ? 0 : 1 + depth(typesById.get(t.parentId), seen + 1);
liveTypes.sort((a, b) => depth(a) - depth(b) || Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.id - b.id);

const products = tables['public.product'].filter(
  (p) => !p.deletedAt && !p.redirectType && STATUSES.has(p.status) && clean(p.name) && typesById.has(p.productTypeId),
);
const skippedProducts = tables['public.product'].filter((p) => !p.deletedAt).length - products.length;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('BEGIN');

  // Attributes come from the seed migration; make sure they exist anyway
  const { rows: attrRows } = await client.query('SELECT key FROM attributes');
  const known = new Set(attrRows.map((r) => r.key));
  const missing = ATTRIBUTE_KEYS.filter((k) => !known.has(k));
  if (missing.length) throw new Error(`Missing attributes ${missing.join(', ')}; start the backend once to run migrations`);

  // Slugs/CRM ids already used by rows that are not part of this import
  const usedTypeSlugs = new Set(
    (await client.query('SELECT slug FROM product_types WHERE legacy_id IS NULL')).rows.map((r) => r.slug),
  );
  const usedTypeCrm = new Set(
    (await client.query('SELECT crm_id FROM product_types WHERE legacy_id IS NULL AND crm_id IS NOT NULL')).rows.map((r) => r.crm_id),
  );

  const typeIds = new Map(); // old id → new id
  for (const t of liveTypes) {
    const attributes = typeAttributes(t.properties);
    const { rows } = await client.query(
      `INSERT INTO product_types (legacy_id, parent_id, crm_id, name, slug, attributes, group_by, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (legacy_id) DO UPDATE SET
         parent_id = EXCLUDED.parent_id, crm_id = EXCLUDED.crm_id, name = EXCLUDED.name, slug = EXCLUDED.slug,
         attributes = EXCLUDED.attributes, group_by = EXCLUDED.group_by, position = EXCLUDED.position,
         updated_at = now()
       RETURNING id`,
      [
        Number(t.id),
        typeIds.get(t.parentId) ?? null,
        uniqueCrm(usedTypeCrm, t.crmId),
        clean(t.name),
        uniqueSlug(usedTypeSlugs, t.slug, t.name, t.id),
        JSON.stringify(attributes),
        typeGroupBy(t.split, attributes),
        Math.max(0, Number(t.sortOrder ?? 0) || 0),
      ],
    );
    typeIds.set(t.id, rows[0].id);
  }
  console.log(`Product types: ${typeIds.size}`);

  // Product slugs are locked once created (products_slug_locked trigger): rows
  // already imported keep theirs; new ones get name + CRM id (else code), the
  // same rule as src/catalog/product-slug.ts
  const { rows: slugRows } = await client.query('SELECT legacy_id, slug FROM products');
  const usedSlugs = new Set(slugRows.map((r) => r.slug));
  const slugByLegacy = new Map(slugRows.filter((r) => r.legacy_id !== null).map((r) => [Number(r.legacy_id), r.slug]));
  const productSlug = (p, name) => {
    const existing = slugByLegacy.get(Number(p.id));
    if (existing) return existing;
    const base = slugify(`${name} ${clean(p.crmId) ?? clean(p.code) ?? ''}`) || `item-${p.id}`;
    let slug = base;
    for (let n = 2; usedSlugs.has(slug); n++) slug = `${base}-${n}`;
    usedSlugs.add(slug);
    return slug;
  };
  const usedCrm = new Set(
    (await client.query('SELECT crm_id FROM products WHERE legacy_id IS NULL AND crm_id IS NOT NULL')).rows.map((r) => r.crm_id),
  );

  const BATCH = 500;
  for (let start = 0; start < products.length; start += BATCH) {
    const batch = products.slice(start, start + BATCH);
    const values = [];
    const params = [];
    for (const p of batch) {
      const attrs = {};
      for (const key of ATTRIBUTE_KEYS) {
        const value = clean(p[key]);
        if (value) attrs[key] = value;
      }
      const name = clean(p.name);
      const row = [
        Number(p.id),
        typeIds.get(p.productTypeId),
        uniqueCrm(usedCrm, p.crmId),
        clean(p.code),
        name,
        productSlug(p, name),
        JSON.stringify(attrs),
        cleanUnit(p.unit),
        p.status,
        Math.max(0, Number(p.sortOrder ?? 0) || 0),
      ];
      values.push(`(${row.map((_, i) => `$${params.length + i + 1}`).join(', ')})`);
      params.push(...row);
    }
    await client.query(
      `INSERT INTO products (legacy_id, product_type_id, crm_id, code, name, slug, attributes, unit, status, position)
       VALUES ${values.join(', ')}
       ON CONFLICT (legacy_id) DO UPDATE SET
         product_type_id = EXCLUDED.product_type_id, crm_id = EXCLUDED.crm_id, code = EXCLUDED.code,
         name = EXCLUDED.name, attributes = EXCLUDED.attributes, unit = EXCLUDED.unit,
         status = EXCLUDED.status, position = EXCLUDED.position, updated_at = now()`,
      params,
    );
  }
  console.log(`Products: ${products.length} (skipped ${skippedProducts}: redirects, "other" status, no name or no product type)`);

  await client.query('COMMIT');
  console.log('Import finished.');
} catch (error) {
  await client.query('ROLLBACK');
  console.error('Import failed, nothing was saved:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
