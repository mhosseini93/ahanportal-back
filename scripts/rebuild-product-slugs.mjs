// Usage: npm run slugs:rebuild            (dry run: prints counts and samples)
//        npm run slugs:rebuild -- --apply (writes)
//
// One-off: rebuilds every product slug with the rule of src/catalog/product-slug.ts
// (name + CRM id, else code; clashes get -2, -3, ... in id order). Product slugs
// are locked (products_slug_locked trigger), so this is the only thing that may
// change them: the trigger is switched off just inside this transaction. Old URLs
// are not redirected; only for use before the site is live.
import { writeFileSync } from 'node:fs';
import pg from 'pg';

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the environment
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const apply = process.argv.includes('--apply');

// Same as slugify in src/price-sync/source-mapping.ts
function slugify(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[\s‌_/.]+/g, '-')
    .replace(/[^a-z0-9؀-ۿ-]/g, '')
    .replace(/[،؛؟٪-٭]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 150)
    .replace(/-$/, '');
}
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query('SELECT id, name, crm_id, code, slug FROM products ORDER BY id');
  const used = new Set();
  const changes = [];
  for (const p of rows) {
    const base = slugify(`${p.name} ${clean(p.crm_id) ?? clean(p.code) ?? ''}`) || `item-${p.id}`;
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    if (slug !== p.slug) changes.push({ id: p.id, from: p.slug, to: slug });
  }
  console.log(`Products: ${rows.length}, slugs to change: ${changes.length}`);
  for (const c of changes.slice(0, 8)) console.log(`  ${c.id}: ${c.from} → ${c.to}`);
  if (!apply) {
    console.log('Dry run; pass --apply to write.');
  } else if (changes.length) {
    const backup = `product-slugs-backup-${Date.now()}.json`;
    writeFileSync(backup, JSON.stringify(rows.map(({ id, slug }) => ({ id, slug }))));
    console.log(`Old slugs saved to ${backup}`);

    await client.query('BEGIN');
    await client.query('ALTER TABLE products DISABLE TRIGGER products_slug_locked');
    // Two steps so a new slug never clashes with another row's old one mid-update
    await client.query(`UPDATE products SET slug = 'rebuild-' || id WHERE id = ANY($1::int[])`, [changes.map((c) => c.id)]);
    await client.query(
      `UPDATE products p SET slug = v.slug
       FROM unnest($1::int[], $2::text[]) AS v(id, slug) WHERE p.id = v.id`,
      [changes.map((c) => c.id), changes.map((c) => c.to)],
    );
    await client.query('ALTER TABLE products ENABLE TRIGGER products_slug_locked');
    await client.query('COMMIT');
    console.log('Slugs rebuilt.');
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
