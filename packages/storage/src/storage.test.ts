import net from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Storage, StorageTimeoutError } from './storage.js';

describe('Storage — prazo das operações', () => {
  // Aceita a conexão e nunca responde: o storage "lento" do pior caso.
  const sockets = new Set<net.Socket>();
  const blackHole = net.createServer((socket) => sockets.add(socket));
  let storage: Storage;

  beforeAll(async () => {
    await new Promise<void>((resolve) => blackHole.listen(0, '127.0.0.1', resolve));
    const { port } = blackHole.address() as net.AddressInfo;
    storage = new Storage({
      S3_ENDPOINT: `http://127.0.0.1:${String(port)}`,
      S3_REGION: 'auto',
      S3_ACCESS_KEY: 'x',
      S3_SECRET_KEY: 'y',
      S3_BUCKET_ORIGINALS: 'originals',
      S3_BUCKET_MEDIA: 'media',
      S3_FORCE_PATH_STYLE: true,
      S3_TIMEOUT_MS: 300,
      PUBLIC_MEDIA_URL: 'http://cdn.test/media',
    });
  });

  afterAll(async () => {
    storage.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) =>
      blackHole.close(() => {
        resolve();
      }),
    );
  });

  it('desiste em S3_TIMEOUT_MS com StorageTimeoutError', async () => {
    const started = Date.now();
    const error: unknown = await storage
      .listParts('originals', 'o/u/m', 'upload')
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(StorageTimeoutError);
    expect(error).toMatchObject({ operation: 'ListParts', timeoutMs: 300 });
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
