import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * SDK sem auto-instrumentação: o BullMQ faz polling contínuo no Redis e a
 * instrumentação do ioredis geraria milhares de spans de BRPOPLPUSH sem valor.
 * Os spans do worker são manuais (ver processors/).
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
