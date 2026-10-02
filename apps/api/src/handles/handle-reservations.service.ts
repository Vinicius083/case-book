import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, lte, ne, or, sql } from 'drizzle-orm';

import { type Database, type DbExecutor, handleReservations, type Transaction } from '@casebook/db';

import { PROBLEM_TYPES, ProblemException } from '../common/problem.exception.js';
import { DB } from '../database/database.module.js';

export const HANDLE_QUARANTINE_DAYS = 30;

/**
 * Quarentena de handle: depois de uma troca, o handle antigo fica reservado ao
 * dono por 30 dias. Para qualquer outra pessoa ele se comporta como um handle
 * reservado. Reservas expiradas são ignoradas (e apagadas quando alguém as cruza).
 */
@Injectable()
export class HandleReservationsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Há reserva vigente do handle para alguém que não seja `userId`? */
  async isReservedForOthers(
    handle: string,
    userId: string | undefined,
    executor: DbExecutor = this.db,
  ): Promise<boolean> {
    const [row] = await executor
      .select({ handle: handleReservations.handle })
      .from(handleReservations)
      .where(
        and(
          eq(handleReservations.handle, handle),
          gt(handleReservations.expiresAt, sql`now()`),
          userId ? ne(handleReservations.userId, userId) : undefined,
        ),
      );
    return row !== undefined;
  }

  /**
   * Toma o handle para `userId` dentro da transação que já gravou o handle em
   * `users`. Lança 422 se ele estiver em quarentena para outra pessoa; devolve
   * `true` se era uma reserva do próprio usuário (ele está voltando ao handle
   * antigo).
   *
   * Chame depois do INSERT/UPDATE em `users`: a constraint única faz esta
   * transação esperar o commit de uma troca concorrente que esteja liberando o
   * mesmo handle, e só então a reserva dela fica visível aqui.
   */
  async claim(tx: Transaction, handle: string, userId: string): Promise<boolean> {
    if (await this.isReservedForOthers(handle, userId, tx)) {
      throw new ProblemException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        type: PROBLEM_TYPES.validation,
        title: 'Requisição inválida',
        detail: 'Um ou mais campos não passaram na validação.',
        errors: [{ pointer: '/handle', detail: 'Este handle é reservado' }],
      });
    }

    const removed = await tx
      .delete(handleReservations)
      .where(
        and(
          eq(handleReservations.handle, handle),
          or(eq(handleReservations.userId, userId), lte(handleReservations.expiresAt, sql`now()`)),
        ),
      )
      .returning({ userId: handleReservations.userId, expiresAt: handleReservations.expiresAt });
    return removed.some((row) => row.userId === userId && row.expiresAt > new Date());
  }

  /** Põe em quarentena o handle que `userId` acabou de deixar. */
  async reserve(tx: Transaction, handle: string, userId: string): Promise<void> {
    const expiresAt = sql`now() + make_interval(days => ${HANDLE_QUARANTINE_DAYS})`;
    await tx
      .insert(handleReservations)
      .values({ handle, userId, expiresAt })
      // Sobra de uma reserva antiga (expirada) do mesmo handle.
      .onConflictDoUpdate({
        target: handleReservations.handle,
        set: { userId, releasedAt: sql`now()`, expiresAt },
      });
  }
}
