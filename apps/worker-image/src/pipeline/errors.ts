import { UnrecoverableError } from 'bullmq';

import { RAW_NOT_SUPPORTED_MESSAGE } from '@casebook/contracts/media';

/**
 * Falha definitiva (RF-MP-8): tentar de novo não muda o resultado — hash que não
 * confere, formato fora da lista, imagem acima do limite. Estende o
 * `UnrecoverableError` do BullMQ, que leva o job direto a `failed` sem retry.
 * `userMessage` vai para `media_assets.error_message`: português, sem detalhe
 * técnico; o detalhe fica na mensagem do erro (log e span).
 */
export class PermanentImageError extends UnrecoverableError {
  constructor(
    readonly userMessage: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'PermanentImageError';
  }
}

export const USER_MESSAGES = {
  hashMismatch:
    'O arquivo que chegou ao servidor não é o mesmo que foi enviado. Envie a imagem de novo.',
  unsupportedFormat:
    'Não reconhecemos o formato desta imagem. Envie JPEG, PNG, TIFF, HEIC, WebP ou AVIF.',
  raw: RAW_NOT_SUPPORTED_MESSAGE,
  tooManyPixels:
    'A imagem passa de 200 megapixels. Reduza a resolução no seu editor e envie de novo.',
  unreadable: 'Não conseguimos ler esta imagem; o arquivo pode estar corrompido.',
  transient: 'Não conseguimos processar a imagem agora. Use "Reprocessar" em alguns minutos.',
} as const;

/** Mensagem para o usuário: a do erro definitivo, ou a genérica de falha temporária. */
export function userMessageFor(err: unknown): string {
  return err instanceof PermanentImageError ? err.userMessage : USER_MESSAGES.transient;
}
