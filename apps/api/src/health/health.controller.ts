import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';

import { type Database } from '@casebook/db';

import { DB } from '../database/database.module.js';
import { REDIS } from '../redis/redis.module.js';

import type { FastifyReply } from 'fastify';

type DependencyStatus = 'ok' | 'error';

export interface HealthResponse {
  status: DependencyStatus;
  db: DependencyStatus;
  redis: DependencyStatus;
  uptime: number;
}

const CHECK_TIMEOUT_MS = 2_000;

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthResponse> {
    const [db, redis] = await Promise.all([
      probe(() => this.db.execute(sql`SELECT 1`)),
      probe(() => this.redis.ping()),
    ]);

    const status: DependencyStatus = db === 'ok' && redis === 'ok' ? 'ok' : 'error';
    void reply.status(status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);

    return { status, db, redis, uptime: Math.round(process.uptime()) };
  }
}

async function probe(fn: () => Promise<unknown>): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([fn(), timeout]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}
