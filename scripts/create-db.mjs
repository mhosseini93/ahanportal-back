// Usage: npm run db:create
// Creates the ahan_app role and ahanportal database (scripts/create-db.sql) as the
// postgres superuser; psql asks for the postgres password. The app password comes
// from DATABASE_URL in .env, so the two always match.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

try {
  process.loadEnvFile();
} catch {
  // No .env file: rely on the environment
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (copy .env.example to .env first)');
  process.exit(1);
}
const url = new URL(process.env.DATABASE_URL);

const dirs = [process.env.PG_BIN, 'C:/Program Files/PostgreSQL/18/bin'].filter(Boolean);
const exe = process.platform === 'win32' ? 'psql.exe' : 'psql';
const psql = dirs.map((dir) => join(dir, exe)).find((path) => existsSync(path)) ?? 'psql';

const result = spawnSync(
  psql,
  [
    '--host', url.hostname,
    '--port', url.port || '5432',
    '--username', 'postgres',
    '--dbname', 'postgres',
    '--set', 'ON_ERROR_STOP=1',
    '--set', `app_password=${decodeURIComponent(url.password)}`,
    '--file', join(import.meta.dirname, 'create-db.sql'),
  ],
  { stdio: 'inherit' },
);
if (result.error) {
  console.error(`Could not run psql: ${result.error.message}. Set PG_BIN in .env.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
