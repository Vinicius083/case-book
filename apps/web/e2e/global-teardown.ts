import { createDb } from '@casebook/db';

import { E2E_EMAIL_DOMAIN } from './fixtures';

/** Apaga os usuários que os testes criaram (sessões e reservas vão em cascata). */
export default async function globalTeardown(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) return;

  const { $client: pool } = createDb(url, { max: 1 });
  try {
    const pattern = `%@${E2E_EMAIL_DOMAIN}`;
    await pool.query(
      'DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)',
      [pattern],
    );
    await pool.query('DELETE FROM users WHERE email LIKE $1', [pattern]);
  } finally {
    await pool.end();
  }
}
