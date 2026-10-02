import { createHash, randomBytes, randomInt } from 'node:crypto';

import { eq, like, sql } from 'drizzle-orm';

import { auditLog, type Database, users } from '@casebook/db';

import { createApp } from '../src/app.factory.js';
import { type ApiEnv, ENV } from '../src/config/env.js';
import { DB } from '../src/database/database.module.js';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export const PASSWORD = 'senha-de-teste-1234';

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

export interface RequestOptions {
  body?: object;
  cookie?: string;
  bearer?: string;
  ip?: string;
  headers?: object;
}

export interface TestUser {
  email: string;
  handle: string;
  password: string;
}

/**
 * Aplicação real contra o Postgres e o Redis do compose. Cada execução usa um
 * domínio de email e um user agent próprios, o que permite apagar só o que ela
 * criou. Os IPs são aleatórios por requisição (ou fixados pelo teste) para os
 * limites de um teste não vazarem para outro.
 */
export class AuthHarness {
  readonly runId = randomBytes(6).toString('hex');
  readonly userAgent = `casebook-int-test/${this.runId}`;

  private constructor(readonly app: NestFastifyApplication) {}

  static async create(): Promise<AuthHarness> {
    const app = await createApp();
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return new AuthHarness(app);
  }

  get db(): Database {
    return this.app.get<Database>(DB);
  }

  get env(): ApiEnv {
    return this.app.get<ApiEnv>(ENV);
  }

  async close(): Promise<void> {
    await this.db
      .delete(auditLog)
      .where(sql`${auditLog.metadata}->>'user_agent' = ${this.userAgent}`);
    await this.db.delete(users).where(like(users.email, `%@${this.runId}.test.local`));
    await this.app.close();
  }

  newUser(): TestUser {
    const id = randomBytes(5).toString('hex');
    return { email: `u-${id}@${this.runId}.test.local`, handle: `t-${id}`, password: PASSWORD };
  }

  post(url: string, options: RequestOptions = {}): Promise<InjectResponse> {
    return this.request('POST', url, options);
  }

  get(url: string, options: RequestOptions = {}): Promise<InjectResponse> {
    return this.request('GET', url, options);
  }

  patch(url: string, options: RequestOptions = {}): Promise<InjectResponse> {
    return this.request('PATCH', url, options);
  }

  request(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    options: RequestOptions = {},
  ): Promise<InjectResponse> {
    return this.app.inject({
      method,
      url,
      remoteAddress: options.ip ?? randomIp(),
      headers: {
        'user-agent': this.userAgent,
        ...(options.cookie && { cookie: `cb_refresh=${options.cookie}` }),
        ...(options.bearer && { authorization: `Bearer ${options.bearer}` }),
        ...options.headers,
      },
      ...(options.body && { payload: options.body }),
    });
  }

  /** Cadastra um usuário novo e devolve as credenciais emitidas. */
  async signup(user = this.newUser()) {
    const res = await this.post('/auth/signup', {
      body: { ...user, display_name: 'Pessoa de Teste' },
    });
    if (res.statusCode !== 201) throw new Error(`signup falhou: ${res.body}`);
    return {
      user,
      refreshToken: refreshCookie(res),
      accessToken: res.json<{ access_token: string }>().access_token,
    };
  }

  async userId(email: string): Promise<string> {
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (!row) throw new Error(`usuário ${email} não existe`);
    return row.id;
  }
}

export function randomIp(): string {
  return `10.${String(randomInt(256))}.${String(randomInt(256))}.${String(randomInt(1, 255))}`;
}

/** Header `Set-Cookie` do `cb_refresh` na resposta. */
export function setCookieHeader(res: InjectResponse): string {
  const header = res.headers['set-cookie'];
  const value = Array.isArray(header) ? header.join('\n') : header;
  if (!value?.startsWith('cb_refresh=')) throw new Error('resposta sem Set-Cookie de cb_refresh');
  return value;
}

/** Valor do refresh token emitido na resposta. */
export function refreshCookie(res: InjectResponse): string {
  const token = /^cb_refresh=([^;]+);/.exec(setCookieHeader(res))?.[1];
  if (!token) throw new Error('cookie cb_refresh sem valor');
  return token;
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
