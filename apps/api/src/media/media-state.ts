import { HttpStatus, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import {
  MEDIA_TRANSITIONS,
  type MediaState,
  type MediaTransition,
} from '@casebook/contracts/media';
import { type DbExecutor, mediaAssets } from '@casebook/db';

import { PROBLEM_TYPES, ProblemException } from '../common/problem.exception.js';

export type MediaAssetRow = typeof mediaAssets.$inferSelect;

/** Colunas que uma transição pode gravar junto com o estado. */
export type TransitionSet = Partial<
  Pick<MediaAssetRow, 'uploadId' | 'originalBytes' | 'errorMessage'>
>;

const ACTIONS: Record<MediaTransition, string> = {
  complete: 'concluir o upload de',
  startProcessing: 'iniciar o processamento de',
  finish: 'concluir o processamento de',
  fail: 'marcar como falha',
  retry: 'reprocessar',
};

/**
 * Único ponto da API que muda `media_assets.state` (requisitos §6). A transição
 * é um `UPDATE … WHERE state = <origem> RETURNING`: entre duas requisições
 * concorrentes só uma acha a linha no estado de origem, e a outra recebe 409 em
 * vez de gravar um estado inválido.
 */
export async function transitionMedia(
  executor: DbExecutor,
  input: { mediaId: string; userId: string; transition: MediaTransition; set?: TransitionSet },
): Promise<MediaAssetRow> {
  const { from, to } = MEDIA_TRANSITIONS[input.transition];
  const owned = and(
    eq(mediaAssets.id, input.mediaId),
    eq(mediaAssets.userId, input.userId),
    isNull(mediaAssets.deletedAt),
  );

  const [row] = await executor
    .update(mediaAssets)
    .set({ ...input.set, state: to, updatedAt: sql`now()` })
    .where(and(owned, eq(mediaAssets.state, from)))
    .returning();
  if (row) return row;

  const [current] = await executor
    .select({ state: mediaAssets.state })
    .from(mediaAssets)
    .where(owned);
  if (!current) throw new NotFoundException('Mídia não encontrada');
  throw invalidTransition(input.transition, current.state);
}

/** Checagem prévia, antes de efeitos fora do banco (ex.: completar o multipart no S3). */
export function assertTransition(transition: MediaTransition, current: MediaState): void {
  if (MEDIA_TRANSITIONS[transition].from !== current) throw invalidTransition(transition, current);
}

function invalidTransition(transition: MediaTransition, current: MediaState): ProblemException {
  const { from } = MEDIA_TRANSITIONS[transition];
  return new ProblemException({
    status: HttpStatus.CONFLICT,
    type: PROBLEM_TYPES.invalidTransition,
    title: 'Transição de estado inválida',
    detail: `Não é possível ${ACTIONS[transition]} uma mídia em "${current}"; só em "${from}".`,
    extensions: { state: current },
  });
}
