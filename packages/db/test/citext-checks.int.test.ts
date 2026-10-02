import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Códigos de erro do Postgres (Apêndice A).
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

/**
 * Regressão da migration 0001: em colunas citext o `~` é case-insensitive, então os
 * CHECKs de formato aceitavam maiúsculas. Cada teste roda numa transação com
 * rollback — nada fica no banco.
 */
describe('CHECKs de formato sobre colunas citext', () => {
  let pool: pg.Pool;
  let client: pg.PoolClient;

  beforeAll(() => {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL não definida');
    pool = new pg.Pool({ connectionString: url, max: 1 });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  const insertUser = (handle: string, email = `${handle.toLowerCase()}@test.local`) =>
    client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, handle) VALUES ($1, 'x', $2) RETURNING id`,
      [email, handle],
    );

  const insertProject = (userId: string, slug: string) =>
    client.query(`INSERT INTO projects (user_id, slug, title) VALUES ($1, $2, 'Título')`, [
      userId,
      slug,
    ]);

  describe('users.handle (handle_format)', () => {
    it('rejeita handle com maiúsculas: Vinicius', async () => {
      await expect(insertUser('Vinicius')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'handle_format',
      });
    });

    it('aceita handle minúsculo: vinicius', async () => {
      const res = await insertUser('vinicius');
      expect(res.rowCount).toBe(1);
    });

    it('rejeita handle duplicado (unique)', async () => {
      await insertUser('vinicius', 'a@test.local');
      await expect(insertUser('vinicius', 'b@test.local')).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'users_handle_unique',
      });
    });

    it('citext continua comparando sem diferenciar caixa', async () => {
      await insertUser('vinicius');
      const res = await client.query(`SELECT 1 FROM users WHERE handle = 'VINICIUS'`);
      expect(res.rowCount).toBe(1);
    });
  });

  describe('projects.slug (slug_format)', () => {
    let userId: string;

    beforeEach(async () => {
      const res = await insertUser('vinicius');
      userId = res.rows[0]?.id ?? '';
    });

    it('rejeita slug com maiúsculas: Meu-Reel', async () => {
      await expect(insertProject(userId, 'Meu-Reel')).rejects.toMatchObject({
        code: CHECK_VIOLATION,
        constraint: 'slug_format',
      });
    });

    it('aceita slug minúsculo: meu-reel', async () => {
      const res = await insertProject(userId, 'meu-reel');
      expect(res.rowCount).toBe(1);
    });

    it('rejeita slug duplicado para o mesmo usuário (índice parcial único)', async () => {
      await insertProject(userId, 'meu-reel');
      await expect(insertProject(userId, 'meu-reel')).rejects.toMatchObject({
        code: UNIQUE_VIOLATION,
        constraint: 'project_slug_per_user',
      });
    });

    it('citext continua comparando sem diferenciar caixa', async () => {
      await insertProject(userId, 'meu-reel');
      const res = await client.query(`SELECT 1 FROM projects WHERE slug = 'MEU-REEL'`);
      expect(res.rowCount).toBe(1);
    });
  });
});
