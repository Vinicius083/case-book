import { registerOTel } from '@vercel/otel';

// Hook oficial do Next: roda uma vez no boot do servidor. O exporter usa
// OTEL_EXPORTER_OTLP_ENDPOINT.
export async function register(): Promise<void> {
  const propagateContextUrls: string[] = [];

  if (process.env['NEXT_RUNTIME'] === 'nodejs') {
    // Valida o env no boot: config inválida derruba a subida, não a 1ª requisição.
    const { getEnv } = await import('./env');
    // O @vercel/otel só injeta `traceparent` em fetch para URLs permitidas (não
    // vaza contexto para terceiros). Liberando a API, web → api vira um trace só.
    propagateContextUrls.push(getEnv().API_URL);
  }

  registerOTel({
    serviceName: 'casebook-web',
    instrumentationConfig: { fetch: { propagateContextUrls } },
  });
}
