import { createHash } from 'node:crypto';

/**
 * Layout de chaves no object storage.
 *
 * Originais, no bucket privado (acesso só por URL presigned):
 *
 *     o/{userId}/{mediaId}
 *
 * O prefixo por usuário permite listar, auditar ou expurgar a conta inteira sem
 * consultar o banco. Sem extensão: o tipo está em `media_assets.mime` e no
 * `Content-Type` do objeto.
 *
 * Derivativos, no bucket público (servidos direto pela CDN):
 *
 *     m/{mediaId}/{width}-{hash8}.{fmt}
 *
 * `hash8` são os 8 primeiros hex do SHA-256 do conteúdo do derivativo. Com o
 * hash na chave o objeto é imutável — a mesma chave nunca aponta para bytes
 * diferentes —, então pode ser servido com `Cache-Control: public,
 * max-age=31536000, immutable`, e um reprocessamento gera chave nova em vez de a
 * CDN continuar servindo a versão velha. O `userId` fica de fora porque a URL é
 * pública.
 */
export const storageKeys = {
  original(userId: string, mediaId: string): string {
    return `o/${userId}/${mediaId}`;
  },

  derivative(input: {
    mediaId: string;
    width: number;
    contentHash8: string;
    format: DerivativeFormat;
  }): string {
    if (!/^[\da-f]{8}$/.test(input.contentHash8)) {
      throw new Error(`hash curto inválido: ${input.contentHash8}`);
    }
    return `m/${input.mediaId}/${String(input.width)}-${input.contentHash8}.${input.format}`;
  },
};

export type DerivativeFormat = 'avif' | 'webp' | 'jpeg';

/** Cache dos derivativos: a chave muda quando o conteúdo muda (ver `storageKeys`). */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** 8 primeiros hex do SHA-256 do conteúdo. */
export function contentHash8(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8);
}
