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
      className={`inline-block size-2 rounded-full ${ok ? 'bg-accent' : 'bg-danger'}`}
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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-4">
      <h1 className="font-heading text-4xl font-semibold tracking-tight">
        Casebook<span className="text-accent">.</span>
      </h1>
      <section className="rounded-md border border-divider bg-surface p-5">
        <h2 className="mb-4 text-sm text-muted">Status da API</h2>
        <ul className="flex flex-col gap-3">
          {rows.map(([name, ok]) => (
            <li key={name} className="flex items-center justify-between">
              <span className="flex items-center gap-3">
                <Dot ok={ok} />
                {name}
              </span>
              <span className={ok ? 'text-fg' : 'text-danger'}>
                {ok ? 'ok' : health.reachable ? 'erro' : 'inacessível'}
              </span>
            </li>
          ))}
        </ul>
        {health.reachable && (
          <p className="mt-4 border-t border-divider pt-4 text-sm text-muted">
            uptime {health.body.uptime}s · HTTP {health.httpStatus}
          </p>
        )}
      </section>
    </main>
  );
}
