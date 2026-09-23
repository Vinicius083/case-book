// Carregado com `node --import ./dist/instrumentation.js` ANTES do main.ts. As
// instrumentações precisam estar registradas antes de `pg`, `ioredis`, `fastify`
// e `http` serem importados; importar este arquivo de dentro do main.ts seria
// tarde demais (os imports do main são avaliados antes do corpo dele).
import { register } from 'node:module';

import { FastifyOtelInstrumentation } from '@fastify/otel';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { createAddHookMessageChannel } from 'import-in-the-middle';

// A API é ESM: `import` não passa pelo `require`, então o hook padrão
// (require-in-the-middle) não vê `pg`/`ioredis`. O loader do import-in-the-middle
// cobre o grafo ESM.
const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
register('import-in-the-middle/hook.mjs', import.meta.url, registerOptions);

if (process.env['OTEL_LOG_LEVEL'] === 'debug') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'casebook-api',
    [ATTR_SERVICE_VERSION]: process.env['npm_package_version'] ?? '0.0.0',
  }),
  // Endpoint vem de OTEL_EXPORTER_OTLP_ENDPOINT (o exporter acrescenta /v1/traces).
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false }, // ruído
      '@opentelemetry/instrumentation-dns': { enabled: false }, // ruído
      '@opentelemetry/instrumentation-net': { enabled: false }, // ruído
    }),
    // A instrumentação de Fastify saiu do pacote de auto-instrumentações
    // (descontinuada em favor desta, mantida pelo time do Fastify).
    new FastifyOtelInstrumentation({ registerOnInitialization: true }),
  ],
});

sdk.start();
await waitForAllMessagesAcknowledged();

const shutdown = () => {
  sdk.shutdown().catch((err: unknown) => {
    console.error('Falha ao encerrar o OpenTelemetry SDK', err);
  });
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
