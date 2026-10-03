import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type Attributes, context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';

import type { StorageEnv } from './env.js';

const tracer = trace.getTracer('casebook-storage');

export interface UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface PresignedPart {
  part_number: number;
  url: string;
}

/**
 * Acesso ao object storage. Toda chamada abre um span manual `s3.<Operação>` com
 * operação e bucket — nunca a chave nem a URL presigned, que identificam o
 * usuário e, no caso da URL, dão acesso ao objeto. Os spans automáticos de HTTP
 * e do aws-sdk ficam suprimidos dentro dele pelo mesmo motivo (a URL da
 * requisição carrega a chave).
 */
export class Storage {
  readonly buckets: { originals: string; media: string };
  private readonly client: S3Client;
  private readonly presignClient: S3Client;
  private readonly publicMediaUrl: string;
  private readonly timeoutMs: number;

  constructor(env: StorageEnv) {
    this.timeoutMs = env.S3_TIMEOUT_MS;
    this.buckets = { originals: env.S3_BUCKET_ORIGINALS, media: env.S3_BUCKET_MEDIA };
    this.publicMediaUrl = env.PUBLIC_MEDIA_URL.replace(/\/+$/, '');
    this.client = createClient(env, env.S3_ENDPOINT);
    this.presignClient =
      env.S3_PUBLIC_ENDPOINT && env.S3_PUBLIC_ENDPOINT !== env.S3_ENDPOINT
        ? createClient(env, env.S3_PUBLIC_ENDPOINT)
        : this.client;
  }

  /** URL pública de um objeto do bucket de mídia. */
  publicUrl(key: string): string {
    return `${this.publicMediaUrl}/${key}`;
  }

  async createMultipartUpload(bucket: string, key: string, contentType: string): Promise<string> {
    const out = await this.traced('CreateMultipartUpload', bucket, {}, (signal) =>
      this.client.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
        { abortSignal: signal },
      ),
    );
    if (!out.UploadId) throw new Error('CreateMultipartUpload sem UploadId');
    return out.UploadId;
  }

  /** URLs de `UploadPart` para as partes 1..partCount. Assinatura local, sem rede. */
  presignUploadParts(input: {
    bucket: string;
    key: string;
    uploadId: string;
    partCount: number;
    expiresInSec: number;
  }): Promise<PresignedPart[]> {
    const { bucket, key, uploadId, partCount, expiresInSec } = input;
    return this.traced('PresignUploadPart', bucket, { 's3.part_count': partCount }, () =>
      Promise.all(
        Array.from({ length: partCount }, async (_, index) => ({
          part_number: index + 1,
          url: await getSignedUrl(
            this.presignClient,
            new UploadPartCommand({
              Bucket: bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: index + 1,
            }),
            { expiresIn: expiresInSec },
          ),
        })),
      ),
    );
  }

  /** Partes já recebidas pelo storage, em ordem. */
  listParts(bucket: string, key: string, uploadId: string): Promise<UploadedPart[]> {
    return this.traced('ListParts', bucket, {}, async (signal) => {
      const parts: UploadedPart[] = [];
      let marker: string | undefined;
      do {
        const out = await this.client.send(
          new ListPartsCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: marker,
          }),
          { abortSignal: signal },
        );
        for (const part of out.Parts ?? []) {
          parts.push({
            partNumber: part.PartNumber ?? 0,
            etag: part.ETag ?? '',
            size: part.Size ?? 0,
          });
        }
        marker = out.IsTruncated ? out.NextPartNumberMarker : undefined;
      } while (marker);
      return parts;
    });
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: readonly { partNumber: number; etag: string }[],
  ): Promise<void> {
    await this.traced(
      'CompleteMultipartUpload',
      bucket,
      { 's3.part_count': parts.length },
      (signal) =>
        this.client.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
              Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
            },
          }),
          { abortSignal: signal },
        ),
    );
  }

  /** Devolve `false` se o upload já não existia (completado ou abortado antes). */
  abortMultipartUpload(bucket: string, key: string, uploadId: string): Promise<boolean> {
    return this.traced('AbortMultipartUpload', bucket, {}, async (signal) => {
      try {
        await this.client.send(
          new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
          { abortSignal: signal },
        );
        return true;
      } catch (err) {
        if (isNoSuchUpload(err)) return false;
        throw err;
      }
    });
  }

  /** `undefined` se o objeto não existe. */
  headObject(
    bucket: string,
    key: string,
  ): Promise<{ bytes: number; contentType: string | undefined } | undefined> {
    return this.traced('HeadObject', bucket, {}, async (signal) => {
      try {
        const out = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: signal,
        });
        return { bytes: out.ContentLength ?? 0, contentType: out.ContentType };
      } catch (err) {
        if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) {
          return undefined;
        }
        throw err;
      }
    });
  }

  getObjectBytes(bucket: string, key: string): Promise<Uint8Array> {
    return this.traced('GetObject', bucket, {}, async (signal) => {
      const out = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal: signal,
      });
      if (!out.Body) throw new Error('GetObject sem corpo');
      return out.Body.transformToByteArray();
    });
  }

  async putObject(input: {
    bucket: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    cacheControl?: string;
  }): Promise<void> {
    await this.traced('PutObject', input.bucket, { 's3.bytes': input.body.byteLength }, (signal) =>
      this.client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          CacheControl: input.cacheControl,
        }),
        { abortSignal: signal },
      ),
    );
  }

  destroy(): void {
    this.client.destroy();
    if (this.presignClient !== this.client) this.presignClient.destroy();
  }

  /**
   * Span + prazo da operação. O `AbortSignal` cobre a operação inteira, com as
   * retentativas do SDK e a paginação: um storage lento não segura quem chamou
   * (na API, uma transação com a linha travada) além de `S3_TIMEOUT_MS`.
   */
  private traced<T>(
    operation: string,
    bucket: string,
    attributes: Attributes,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return tracer.startActiveSpan(
      `s3.${operation}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'rpc.system': 'aws-api',
          'rpc.service': 'S3',
          'rpc.method': operation,
          'aws.s3.bucket': bucket,
          ...attributes,
        },
      },
      async (span) => {
        const signal = AbortSignal.timeout(this.timeoutMs);
        try {
          return await context.with(suppressTracing(context.active()), () => fn(signal));
        } catch (err) {
          const error = signal.aborted
            ? new StorageTimeoutError(operation, this.timeoutMs, { cause: err })
            : err;
          // Só o nome do erro: a mensagem do SDK pode citar a chave ou a URL.
          const name = error instanceof Error ? error.name : 'Error';
          span.setAttribute('error.type', name);
          span.setStatus({ code: SpanStatusCode.ERROR, message: name });
          throw error;
        } finally {
          span.end();
        }
      },
    );
  }
}

/** A operação passou de `S3_TIMEOUT_MS`. A API responde 503. */
export class StorageTimeoutError extends Error {
  override readonly name = 'StorageTimeoutError';

  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
    options?: ErrorOptions,
  ) {
    super(`S3 ${operation} passou de ${String(timeoutMs)}ms`, options);
  }
}

export function isNoSuchUpload(err: unknown): boolean {
  return err instanceof S3ServiceException && err.name === 'NoSuchUpload';
}

function createClient(env: StorageEnv, endpoint: string): S3Client {
  return new S3Client({
    endpoint,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    // Desde a 3.729 o SDK calcula CRC32 por padrão e o põe nas URLs presigned de
    // UploadPart; o browser teria de mandar o mesmo checksum, e nem o MinIO nem o
    // R2 tratam o cabeçalho de forma igual. Só quando a operação exige.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}
