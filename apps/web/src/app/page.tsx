import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { getEnv } from '@/env';

// Sempre renderizado por requisição: o status tem que ser o atual.
export const dynamic = 'force-dynamic';

interface Health {
  status: 'ok' | 'error';
  db: 'ok' | 'error';
  redis: 'ok' | 'error';
  uptime: number;
}

type HealthResult = { reachable: true; httpStatus: number; body: Health } | { reachable: false };

async function fetchHealth(): Promise<HealthResult> {
  try {
    const res = await fetch(new URL('/health', getEnv().API_URL), {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    return { reachable: true, httpStatus: res.status, body: (await res.json()) as Health };
  } catch {
    return { reachable: false };
  }
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2 rounded-full ${ok ? 'bg-accent-text' : 'bg-danger'}`}
    />
  );
}

export default async function Home() {
  const health = await fetchHealth();
  const rows: [string, boolean][] = health.reachable
    ? [
        ['api', health.body.status === 'ok'],
        ['postgres', health.body.db === 'ok'],
        ['redis', health.body.redis === 'ok'],
      ]
    : [['api', false]];

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-6">
      <div>
        <p className="eyebrow">Portfólio para o audiovisual</p>
        <h1 className="mt-3 text-screen">Casebook</h1>
      </div>
      <nav className="flex gap-3" aria-label="Conta">
        <Button asChild>
          <Link href="/signup">Criar conta</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Entrar</Link>
        </Button>
      </nav>
      <section className="rounded-md border border-border bg-surface p-[1.125rem]">
        <h2 className="label-caps mb-4 font-sans font-normal">Status da API</h2>
        <ul className="flex flex-col gap-3">
          {rows.map(([name, ok]) => (
            <li key={name} className="flex items-center justify-between">
              <span className="flex items-center gap-3">
                <Dot ok={ok} />
                {name}
              </span>
              <span className={ok ? 'text-text' : 'text-danger'}>
                {ok ? 'ok' : health.reachable ? 'erro' : 'inacessível'}
              </span>
            </li>
          ))}
        </ul>
        {health.reachable && (
          <p className="mt-4 border-t border-border pt-4 text-support text-muted">
            uptime {health.body.uptime}s · HTTP {health.httpStatus}
          </p>
        )}
      </section>
    </main>
  );
}
