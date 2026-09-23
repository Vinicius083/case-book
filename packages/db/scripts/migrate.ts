// Aplica as migrations de ./migrations com o migrator do Drizzle (nunca `push`).
// Rodado com `node --experimental-strip-types` — sem build, sem tsx.
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL não definida (copie .env.example para .env na raiz)');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
  console.log('migrations aplicadas');
} finally {
  await pool.end();
}
