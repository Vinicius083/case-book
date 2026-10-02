import { randomBytes } from 'node:crypto';

import { Injectable, type OnModuleInit } from '@nestjs/common';
import { hash, type Options, verify } from '@node-rs/argon2';
import { type Span, SpanStatusCode, trace } from '@opentelemetry/api';

// Argon2id é o algoritmo padrão da lib (o enum `Algorithm` é `const enum` ambiente,
// inacessível com `isolatedModules`); o teste unitário confere o prefixo do hash.
export const ARGON2_OPTIONS = {
  memoryCost: 65_536, // KiB = 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const satisfies Options;

const tracer = trace.getTracer('casebook-api.auth');

@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash = '';

  /**
   * Pré-computa no boot o hash usado quando o email não existe: o login faz um
   * verify de mesmo custo nos dois casos e o tempo de resposta não revela se a
   * conta existe.
   */
  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash(randomBytes(32), ARGON2_OPTIONS);
  }

  hash(password: string): Promise<string> {
    return withSpan('argon2.hash', () => hash(password, ARGON2_OPTIONS));
  }

  /**
   * Confere a senha contra o hash armazenado. Com `storedHash` nulo (conta
   * inexistente) gasta o mesmo tempo contra o hash dummy e devolve `false`.
   */
  verify(storedHash: string | null, password: string): Promise<boolean> {
    return withSpan('argon2.verify', async () => {
      const matches = await verify(storedHash ?? this.dummyHash, password).catch(() => false);
      return storedHash !== null && matches;
    });
  }
}

// Span manual: argon2 é CPU nativa fora de qualquer auto-instrumentação. Os
// atributos são só os parâmetros de custo — nunca a senha nem o hash.
function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, async (span: Span) => {
    span.setAttributes({
      'argon2.memory_cost_kib': ARGON2_OPTIONS.memoryCost,
      'argon2.time_cost': ARGON2_OPTIONS.timeCost,
      'argon2.parallelism': ARGON2_OPTIONS.parallelism,
    });
    try {
      return await fn();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
