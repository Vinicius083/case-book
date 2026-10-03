import { randomBytes } from 'node:crypto';

import { context, defaultTextMapSetter, TraceFlags } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

// Instância própria, não o propagador global: o formato gravado no outbox não
// pode depender de qual propagador o SDK registrou.
const w3c = new W3CTraceContextPropagator();

/**
 * `traceparent` W3C do span ativo, para atravessar o outbox e a fila. Sem span
 * válido (SDK desligado), gera um raiz não amostrado: o contrato exige o campo,
 * e o relay e o worker seguem sem exportar spans desse trace.
 */
export function currentTraceparent(): string {
  const carrier: Record<string, string> = {};
  w3c.inject(context.active(), carrier, defaultTextMapSetter);
  // O propagador só injeta quando o span ativo tem contexto válido.
  const traceparent = carrier['traceparent'];
  if (traceparent) return traceparent;
  const flags = TraceFlags.NONE.toString(16).padStart(2, '0');
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-${flags}`;
}
