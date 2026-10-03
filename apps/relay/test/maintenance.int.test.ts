import { randomBytes, randomUUID } from 'node:crypto';

import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, handleReservations, mediaAssets, users } from '@casebook/db';
import { isNoSuchUpload, Storage, storageKeys } from '@casebook/storage';

import { relayEnvSchema } from '../src/env.js';
import { gcHandleReservations } from '../src/maintenance/handle-reservations-gc.js';
import { runMaintenanceJob } from '../src/maintenance/maintenance.js';
import { gcPendingUploads } from '../src/maintenance/pending-uploads-gc.js';

// Integração: Postgres e MinIO do compose (pnpm infra:up).
describe('jobs de manutenção', () => {
  const env = relayEnvSchema.parse(process.env);
  const db = createDb(env.DATABASE_URL, { max: 2 });
  const storage = new Storage(env);
  const runId = randomBytes(6).toString('hex');
  let userId: string;

  beforeAll(async () => {
    const [user] = await db
      .insert(users)
      .values({
        email: `relay-${runId}@${runId}.test.local`,
        passwordHash: 'x',
        handle: `r-${runId}`,
      })
      .returning({ id: users.id });
    if (!user) throw new Error('usuário não criado');
    userId = user.id;
  });

  afterAll(async () => {
    await db.delete(users).where(like(users.email, `%@${runId}.test.local`));
    await db.$client.end();
    storage.destroy();
  });

  /** Asset `pending` com multipart real aberto no MinIO e `created_at` no passado. */
  async function pendingUpload(ageHours: number) {
    const id = randomUUID();
    const key = storageKeys.original(userId, id);
    const uploadId = await storage.createMultipartUpload(
      storage.buckets.originals,
      key,
      'image/jpeg',
    );
    await db.insert(mediaAssets).values({
      id,
      userId,
      kind: 'image',
      originalKey: key,
      originalBytes: 10,
      sha256: randomBytes(32),
      mime: 'image/jpeg',
      filename: 'abandonado.jpg',
      uploadId,
      createdAt: new Date(Date.now() - ageHours * 60 * 60 * 1000),
    });
    return { id, key, uploadId };
  }

  const exists = async (id: string) =>
    (await db.select().from(mediaAssets).where(eq(mediaAssets.id, id))).length === 1;

  const multipartAlive = (key: string, uploadId: string) =>
    storage.listParts(storage.buckets.originals, key, uploadId).then(
      () => true,
      (err: unknown) => {
        if (isNoSuchUpload(err)) return false;
        throw err;
      },
    );

  it('GC de upload abandonado: pending há mais de 24h perde o multipart e a linha', async () => {
    const stale = await pendingUpload(25);
    const fresh = await pendingUpload(23);

    const result = await gcPendingUploads(db, storage);
    expect(result.removed).toContain(stale.id);
    expect(result.removed).not.toContain(fresh.id);

    expect(await exists(stale.id)).toBe(false);
    expect(await multipartAlive(stale.key, stale.uploadId)).toBe(false);
    expect(await exists(fresh.id)).toBe(true);
    expect(await multipartAlive(fresh.key, fresh.uploadId)).toBe(true);

    await storage.abortMultipartUpload(storage.buckets.originals, fresh.key, fresh.uploadId);
  });

  it('GC não toca asset antigo que já saiu de pending', async () => {
    const old = await pendingUpload(48);
    await db
      .update(mediaAssets)
      .set({ state: 'uploaded', uploadId: null })
      .where(eq(mediaAssets.id, old.id));

    const result = await runMaintenanceJob('media.pending-gc', { db, storage, logger: silent });
    expect(result).toMatchObject({ failed: [] });
    expect(await exists(old.id)).toBe(true);
    await storage.abortMultipartUpload(storage.buckets.originals, old.key, old.uploadId);
  });

  it('reservas de handle vencidas são apagadas; as vigentes ficam', async () => {
    const expired = `x-${runId}`;
    const active = `y-${runId}`;
    await db.insert(handleReservations).values([
      { handle: expired, userId, expiresAt: new Date(Date.now() - 1000) },
      { handle: active, userId, expiresAt: new Date(Date.now() + 60_000) },
    ]);

    expect(await gcHandleReservations(db)).toBeGreaterThanOrEqual(1);
    const left = await db
      .select({ handle: handleReservations.handle })
      .from(handleReservations)
      .where(inArray(handleReservations.handle, [expired, active]));
    expect(left.map((row) => row.handle)).toEqual([active]);
  });
});

const silent = { log: () => undefined, error: () => undefined };
