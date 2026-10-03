import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * SDK sem auto-instrumentação, como no worker: o poll do outbox a cada 5s e o
 * BullMQ gerariam um trace de `pg`/`ioredis` por iteração, sem valor. Os spans
 * do relay são manuais (`outbox.relay`, `maintenance <job>`, `s3.*`).
 */
export function startTelemetry(serviceName: string): NodeSDK {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: serviceName }),
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [],
  });
  sdk.start();
  return sdk;
}
