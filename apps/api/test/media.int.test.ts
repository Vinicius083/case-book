import 'reflect-metadata';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CreateUploadResponse,
  MEDIA_MAX_BYTES,
  MEDIA_PROBLEM_TYPES,
  type MediaAssetDetailResponse,
  type MediaAssetResponse,
  type MediaInUseProblem,
  type MediaListResponse,
  RAW_NOT_SUPPORTED_MESSAGE,
  UPLOAD_PART_SIZE,
  VIDEO_NOT_AVAILABLE_MESSAGE,
} from '@casebook/contracts/media';
import {
  blockMedia,
  blocks,
  mediaAssets,
  mediaDerivatives,
  outboxEvents,
  profiles,
  projects,
} from '@casebook/db';

import { AuthHarness } from './auth.helpers.js';
import {
  cleanupMedia,
  fakeFile,
  intentBody,
  putParts,
  startUpload,
  uploadFile,
} from './media.helpers.js';
import { findSpan } from './tracing.js';

// Integração: aplicação Nest real contra Postgres, Redis e MinIO (pnpm infra:up).
describe('mídia', () => {
  let t: AuthHarness;
  let bearer: string;
  let userId: string;

  beforeAll(async () => {
    t = await AuthHarness.create();
    const session = await t.signup();
    bearer = session.accessToken;
    userId = await t.userId(session.user.email);
  });

  afterAll(async () => {
    await cleanupMedia(t);
    await t.close();
  });

  const setState = (id: string, state: 'ready' | 'failed' | 'processing') =>
    t.db
      .update(mediaAssets)
      .set({ state, width: 4000, height: 2667 })
      .where(eq(mediaAssets.id, id));

  const outboxFor = (id: string) =>
    t.db.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, id));

  describe('POST /media/uploads', () => {
    it('cria o asset em pending com uma URL presigned por parte', async () => {
      const bytes = fakeFile();
      const res = await t.post('/media/uploads', { bearer, body: intentBody(bytes) });
      expect(res.statusCode).toBe(201);
      const body = res.json<CreateUploadResponse>();
      expect(body.deduplicated).toBe(false);
      expect(body.asset).toMatchObject({ state: 'pending', kind: 'image', filename: 'still.jpg' });
      expect(body.upload?.part_size).toBe(UPLOAD_PART_SIZE);
      expect(body.upload?.parts.map((p) => p.part_number)).toEqual([1]);
      // Nada interno vaza: chave, upload_id e sha256 ficam no banco.
      expect(res.body).not.toMatch(/original_key|upload_id|sha256/);

      const [row] = await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, body.asset.id));
      expect(row?.originalKey).toBe(`o/${userId}/${body.asset.id}`);
      expect(row?.uploadId).toBeTruthy();
      const expiresIn = Date.parse(body.upload?.expires_at ?? '') - Date.now();
      expect(expiresIn).toBeGreaterThan(59 * 60 * 1000);
      expect(expiresIn).toBeLessThanOrEqual(60 * 60 * 1000);
    });

    it('arquivo grande: partes de 10 MB', async () => {
      const res = await t.post('/media/uploads', {
        bearer,
        body: intentBody(fakeFile(16), { size_bytes: 25 * 1024 * 1024 }),
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<CreateUploadResponse>().upload?.parts).toHaveLength(3);
    });

    it.each([
      ['frame.dng', 'image/x-adobe-dng'],
      ['frame.CR3', ''],
      ['frame.nef', 'image/tiff'],
    ])('RAW → 422 próprio: %s', async (filename, mime) => {
      const res = await t.post('/media/uploads', {
        bearer,
        body: intentBody(fakeFile(), { filename, mime }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        type: MEDIA_PROBLEM_TYPES.rawNotSupported,
        detail: RAW_NOT_SUPPORTED_MESSAGE,
      });
    });

    it('vídeo com a flag desligada → 422 próprio', async () => {
      const res = await t.post('/media/uploads', {
        bearer,
        body: intentBody(fakeFile(), { filename: 'corte.mov', mime: 'video/quicktime' }),
      });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({
        type: MEDIA_PROBLEM_TYPES.videoNotAvailable,
        detail: VIDEO_NOT_AVAILABLE_MESSAGE,
      });
    });

    it('tipo não aceito e tamanho acima do limite → 422 no campo', async () => {
      const gif = await t.post('/media/uploads', {
        bearer,
        body: intentBody(fakeFile(), { filename: 'a.gif', mime: 'image/gif' }),
      });
      expect(gif.statusCode).toBe(422);
      expect(gif.json()).toMatchObject({ errors: [{ pointer: '/mime' }] });

      const big = await t.post('/media/uploads', {
        bearer,
        body: intentBody(fakeFile(), { size_bytes: MEDIA_MAX_BYTES.image + 1 }),
      });
      expect(big.statusCode).toBe(422);
      expect(big.json()).toMatchObject({ errors: [{ pointer: '/size_bytes' }] });
    });

    it('sem token → 401', async () => {
      const res = await t.post('/media/uploads', { body: intentBody(fakeFile()) });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('dedupe por sha256 (RF-UP-3)', () => {
    it.each(['ready', 'processing', 'uploaded', 'failed'] as const)(
      'asset em %s → 200 com o existente e sem URLs',
      async (state) => {
        const bytes = fakeFile();
        const asset = await uploadFile(t, bearer, bytes);
        if (state !== 'uploaded') await setState(asset.id, state);

        const res = await t.post('/media/uploads', {
          bearer,
          body: intentBody(bytes, { filename: 'outro-nome.jpg' }),
        });
        expect(res.statusCode).toBe(200);
        const body = res.json<CreateUploadResponse>();
        expect(body).toMatchObject({ deduplicated: true, upload: null });
        expect(body.asset).toMatchObject({ id: asset.id, state, filename: 'still.jpg' });
      },
    );

    it('asset em pending → mesmo asset, URLs novas para o mesmo upload_id', async () => {
      const bytes = fakeFile();
      const first = await t.post('/media/uploads', { bearer, body: intentBody(bytes) });
      const asset = first.json<CreateUploadResponse>().asset;
      const [before] = await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id));

      const second = await t.post('/media/uploads', { bearer, body: intentBody(bytes) });
      expect(second.statusCode).toBe(200);
      const body = second.json<CreateUploadResponse>();
      expect(body.deduplicated).toBe(false);
      expect(body.asset.id).toBe(asset.id);
      expect(body.upload?.parts[0]?.url).toContain(encodeURIComponent(before?.uploadId ?? '-'));

      // A "outra aba" consegue terminar o upload com as URLs novas.
      if (!body.upload) throw new Error('sem URLs');
      const parts = await putParts(body.upload, bytes);
      const done = await t.post(`/media/${asset.id}/complete`, { bearer, body: { parts } });
      expect(done.statusCode).toBe(200);
    });

    it('intenções simultâneas do mesmo arquivo → um asset só', async () => {
      const body = intentBody(fakeFile());
      const responses = await Promise.all(
        Array.from({ length: 5 }, () => t.post('/media/uploads', { bearer, body })),
      );
      const statuses = responses.map((res) => res.statusCode).sort();
      expect(statuses).toEqual([200, 200, 200, 200, 201]);
      const ids = new Set(responses.map((res) => res.json<CreateUploadResponse>().asset.id));
      expect(ids.size).toBe(1);
    });

    it('o mesmo arquivo em outra conta não é deduplicado', async () => {
      const other = await t.signup();
      const bytes = fakeFile();
      await uploadFile(t, bearer, bytes);
      const res = await t.post('/media/uploads', {
        bearer: other.accessToken,
        body: intentBody(bytes),
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe('POST /media/:id/complete', () => {
    it('pending → uploaded, com evento de outbox na mesma transação', async () => {
      const { asset, parts } = await startUpload(t, bearer, fakeFile(3000));
      const res = await t.post(`/media/${asset.id}/complete`, { bearer, body: { parts } });
      expect(res.statusCode).toBe(200);
      expect(res.json<MediaAssetResponse>()).toMatchObject({ state: 'uploaded', size_bytes: 3000 });

      const [row] = await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id));
      expect(row?.uploadId).toBeNull();

      const events = await outboxFor(asset.id);
      expect(events).toHaveLength(1);
      const event = events[0];
      expect(event).toMatchObject({
        aggregate: 'media_asset',
        eventType: 'media.uploaded',
        publishedAt: null,
        payload: { media_id: asset.id, kind: 'image' },
      });

      // O traceparent gravado é o do span `upload.complete`.
      const span = findSpan('upload.complete', (s) => s.attributes['media.id'] === asset.id);
      const { traceId, spanId } = span.spanContext();
      expect(event?.payload['traceparent']).toBe(`00-${traceId}-${spanId}-01`);
      expect(event?.traceId).toBe(traceId);
    });

    it('arquivo em duas partes', async () => {
      const bytes = fakeFile(UPLOAD_PART_SIZE + 1024);
      const res = await t.post('/media/uploads', { bearer, body: intentBody(bytes) });
      const { asset, upload } = res.json<CreateUploadResponse>();
      if (!upload) throw new Error('sem URLs');
      expect(upload.parts).toHaveLength(2);
      const parts = await putParts(upload, bytes);
      // Ordem trocada no corpo: a API completa na ordem do storage.
      const done = await t.post(`/media/${asset.id}/complete`, {
        bearer,
        body: { parts: parts.reverse() },
      });
      expect(done.statusCode, done.body).toBe(200);
      expect(done.json<MediaAssetResponse>().size_bytes).toBe(bytes.length);

      // Objeto final no bucket privado, com o tamanho do arquivo.
      const [row] = await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id));
      const head = await fetch(
        `${t.env.S3_ENDPOINT}/${t.env.S3_BUCKET_ORIGINALS}/${row?.originalKey ?? ''}`,
        { method: 'HEAD' },
      );
      expect(head.status).toBe(403); // privado: sem assinatura não lê
    });

    it('ETag que não confere → 422 e o asset continua pending', async () => {
      const { asset } = await startUpload(t, bearer, fakeFile());
      const res = await t.post(`/media/${asset.id}/complete`, {
        bearer,
        body: { parts: [{ part_number: 1, etag: '"nao-confere"' }] },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ type: MEDIA_PROBLEM_TYPES.uploadIncomplete });
      const [row] = await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id));
      expect(row?.state).toBe('pending');
    });

    it('arquivo maior que o declarado → 422', async () => {
      const declared = fakeFile(1000);
      const res = await t.post('/media/uploads', { bearer, body: intentBody(declared) });
      const { asset, upload } = res.json<CreateUploadResponse>();
      if (!upload) throw new Error('sem URLs');
      const parts = await putParts(upload, fakeFile(5000));
      const done = await t.post(`/media/${asset.id}/complete`, { bearer, body: { parts } });
      expect(done.statusCode).toBe(422);
      expect(done.json<{ detail: string }>().detail).toContain('5000 bytes');
    });

    it.each(['ready', 'processing', 'failed'] as const)(
      'transição inválida: complete em %s → 409',
      async (state) => {
        const asset = await uploadFile(t, bearer);
        await setState(asset.id, state);
        const res = await t.post(`/media/${asset.id}/complete`, {
          bearer,
          body: { parts: [{ part_number: 1, etag: '"x"' }] },
        });
        expect(res.statusCode).toBe(409);
        expect(res.json()).toMatchObject({
          type: MEDIA_PROBLEM_TYPES.invalidTransition,
          state,
        });
      },
    );

    it('completes simultâneos: um 200, os outros 409, um evento só', async () => {
      // Várias rodadas: a corrida (o multipart some antes do commit do vencedor)
      // depende de intercalação, e uma rodada só passaria por sorte.
      for (let round = 0; round < 5; round++) {
        const { asset, parts } = await startUpload(t, bearer, fakeFile());
        const responses = await Promise.all(
          Array.from({ length: 3 }, () =>
            t.post(`/media/${asset.id}/complete`, { bearer, body: { parts } }),
          ),
        );
        expect(responses.map((res) => res.statusCode).sort()).toEqual([200, 409, 409]);
        expect(await outboxFor(asset.id)).toHaveLength(1);
      }
    });
  });

  describe('POST /media/:id/retry', () => {
    it('failed → uploaded, com evento novo; de novo → 409', async () => {
      const asset = await uploadFile(t, bearer);
      await t.db
        .update(mediaAssets)
        .set({ state: 'failed', errorMessage: 'falhou no worker' })
        .where(eq(mediaAssets.id, asset.id));

      const res = await t.post(`/media/${asset.id}/retry`, { bearer });
      expect(res.statusCode).toBe(200);
      expect(res.json<MediaAssetResponse>()).toMatchObject({
        state: 'uploaded',
        error_message: null,
      });
      expect(await outboxFor(asset.id)).toHaveLength(2);

      const again = await t.post(`/media/${asset.id}/retry`, { bearer });
      expect(again.statusCode).toBe(409);
    });
  });

  describe('GET /media', () => {
    let lister: string;
    const names = ['Natura still.jpg', 'natura_100%.png', 'Making of.jpg', 'Natura b-roll.tif'];

    beforeAll(async () => {
      lister = (await t.signup()).accessToken;
      for (const name of names) {
        const bytes = fakeFile();
        const res = await t.post('/media/uploads', {
          bearer: lister,
          body: intentBody(bytes, { filename: name }),
        });
        expect(res.statusCode).toBe(201);
      }
    });

    const list = async (query: string) => {
      const res = await t.get(`/media?${query}`, { bearer: lister });
      expect(res.statusCode, res.body).toBe(200);
      return res.json<MediaListResponse>();
    };

    it('pagina por cursor, mais recentes primeiro, sem repetir nem pular', async () => {
      const first = await list('limit=3');
      expect(first.items).toHaveLength(3);
      expect(first.next_cursor).not.toBeNull();
      const second = await list(`limit=3&cursor=${first.next_cursor ?? ''}`);
      expect(second.items).toHaveLength(1);
      expect(second.next_cursor).toBeNull();
      expect([...first.items, ...second.items].map((item) => item.filename)).toEqual(
        [...names].reverse(),
      );
    });

    it('busca por nome, sem diferenciar caixa e com curinga escapado', async () => {
      expect((await list('q=natura')).items).toHaveLength(3);
      expect((await list('q=100%25')).items.map((i) => i.filename)).toEqual(['natura_100%.png']);
      expect((await list('q=_')).items.map((i) => i.filename)).toEqual(['natura_100%.png']);
    });

    it('filtra por estado e tipo', async () => {
      expect((await list('state=pending')).items).toHaveLength(4);
      expect((await list('state=ready')).items).toHaveLength(0);
      expect((await list('kind=video')).items).toHaveLength(0);
    });

    it('cursor inválido e limite acima de 50 → 422', async () => {
      expect((await t.get('/media?cursor=lixo', { bearer: lister })).statusCode).toBe(422);
      expect((await t.get('/media?limit=51', { bearer: lister })).statusCode).toBe(422);
    });
  });

  describe('GET/PATCH /media/:id', () => {
    it('detalhe com derivativos e paleta', async () => {
      const asset = await uploadFile(t, bearer);
      const palette = {
        dominant: '#1c1c1e',
        colors: [{ hex: '#1c1c1e', ratio: 0.42, contrast_white: 13.1, contrast_black: 1.6 }],
        suggested: { bg: '#1c1c1e', fg: '#f5f5f7', accent: '#c8ff3d' },
      };
      await t.db
        .update(mediaAssets)
        .set({ state: 'ready', width: 4000, height: 2667, palette })
        .where(eq(mediaAssets.id, asset.id));
      await t.db.insert(mediaDerivatives).values(
        [320, 640].map((width) => ({
          mediaId: asset.id,
          kind: 'image',
          format: 'webp',
          width,
          height: Math.round((width * 2667) / 4000),
          bytes: width * 10,
          storageKey: `m/${asset.id}/${String(width)}-0123abcd.webp`,
          ssim: '0.98700',
          quality: 72,
        })),
      );

      const res = await t.get(`/media/${asset.id}`, { bearer });
      expect(res.statusCode).toBe(200);
      const body = res.json<MediaAssetDetailResponse>();
      expect(body.palette).toEqual(palette);
      expect(body.derivatives).toHaveLength(2);
      expect(body.derivatives[0]).toMatchObject({ width: 320, ssim: 0.987, quality: 72 });
      expect(body.derivatives[0]?.url).toBe(
        `${t.env.PUBLIC_MEDIA_URL}/m/${asset.id}/320-0123abcd.webp`,
      );
      expect(body.thumbnail_url).toBe(body.derivatives[0]?.url);
    });

    it('renomeia e edita o alt_text; vazio vira null', async () => {
      const asset = await uploadFile(t, bearer);
      const res = await t.patch(`/media/${asset.id}`, {
        bearer,
        body: { filename: ' Natura final.jpg ', alt_text: 'Frasco sobre pedra' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<MediaAssetResponse>()).toMatchObject({
        filename: 'Natura final.jpg',
        alt_text: 'Frasco sobre pedra',
      });
      const cleared = await t.patch(`/media/${asset.id}`, { bearer, body: { alt_text: '' } });
      expect(cleared.json<MediaAssetResponse>().alt_text).toBeNull();
      expect((await t.patch(`/media/${asset.id}`, { bearer, body: {} })).statusCode).toBe(422);
    });
  });

  describe('DELETE /media/:id (RF-LIB-3)', () => {
    it('sem uso: soft delete, some da biblioteca e libera o dedupe', async () => {
      const bytes = fakeFile();
      const asset = await uploadFile(t, bearer, bytes);
      await t.db
        .update(profiles)
        .set({ avatarMediaId: asset.id })
        .where(eq(profiles.userId, userId));

      const res = await t.delete(`/media/${asset.id}`, { bearer });
      expect(res.statusCode).toBe(204);
      expect((await t.get(`/media/${asset.id}`, { bearer })).statusCode).toBe(404);

      const [row] = await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, asset.id));
      expect(row?.deletedAt).not.toBeNull();
      const [profile] = await t.db.select().from(profiles).where(eq(profiles.userId, userId));
      expect(profile?.avatarMediaId).toBeNull();

      const again = await t.post('/media/uploads', { bearer, body: intentBody(bytes) });
      expect(again.statusCode).toBe(201);
      expect(again.json<CreateUploadResponse>().asset.id).not.toBe(asset.id);
    });

    it('em uso por bloco: 409 com a lista de projetos; com confirm=true apaga', async () => {
      const asset = await uploadFile(t, bearer);
      const [project] = await t.db
        .insert(projects)
        .values({ userId, slug: `natura-${asset.id.slice(0, 8)}`, title: 'Natura — Essência' })
        .returning();
      if (!project) throw new Error('projeto não criado');
      const [block] = await t.db
        .insert(blocks)
        .values({ projectId: project.id, type: 'image', rank: 'a0' })
        .returning();
      if (!block) throw new Error('bloco não criado');
      await t.db.insert(blockMedia).values({ blockId: block.id, mediaId: asset.id });

      const res = await t.delete(`/media/${asset.id}`, { bearer });
      expect(res.statusCode).toBe(409);
      expect(res.json<MediaInUseProblem>()).toMatchObject({
        type: MEDIA_PROBLEM_TYPES.inUse,
        requires_confirmation: true,
        projects: [{ id: project.id, title: 'Natura — Essência', slug: project.slug }],
      });

      const confirmed = await t.delete(`/media/${asset.id}?confirm=true`, { bearer });
      expect(confirmed.statusCode).toBe(204);
      // Soft delete: o bloco segue apontando para a mídia (o snapshot publicado também).
      const refs = await t.db.select().from(blockMedia).where(eq(blockMedia.mediaId, asset.id));
      expect(refs).toHaveLength(1);
    });
  });

  describe('isolamento entre usuários (RNF-9)', () => {
    it('toda rota /media/:id com asset de outro usuário → 404', async () => {
      const asset = await uploadFile(t, bearer);
      const intruder = (await t.signup()).accessToken;
      const parts = { parts: [{ part_number: 1, etag: '"x"' }] };
      const routes = [
        () => t.get(`/media/${asset.id}`, { bearer: intruder }),
        () => t.patch(`/media/${asset.id}`, { bearer: intruder, body: { filename: 'x.jpg' } }),
        () => t.delete(`/media/${asset.id}`, { bearer: intruder }),
        () => t.delete(`/media/${asset.id}?confirm=true`, { bearer: intruder }),
        () => t.post(`/media/${asset.id}/complete`, { bearer: intruder, body: parts }),
        () => t.post(`/media/${asset.id}/retry`, { bearer: intruder }),
      ];
      for (const route of routes) {
        const res = await route();
        expect(res.statusCode, res.body).toBe(404);
      }
      // Nem aparece na lista do outro.
      const list = await t.get('/media', { bearer: intruder });
      expect(list.json<MediaListResponse>().items).toHaveLength(0);

      // E nada mudou no asset.
      const [row] = await t.db
        .select()
        .from(mediaAssets)
        .where(and(eq(mediaAssets.id, asset.id), sql`${mediaAssets.deletedAt} IS NULL`));
      expect(row).toMatchObject({ filename: 'still.jpg', state: 'uploaded' });
    });

    it('id que não é UUID → 404', async () => {
      expect((await t.get('/media/nao-e-uuid', { bearer })).statusCode).toBe(404);
    });
  });
});
