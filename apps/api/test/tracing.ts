import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';

/**
 * Spans finalizados durante o teste. Sem o SDK (o `instrumentation.ts` não roda
 * nos testes), só os spans manuais existem — `upload.complete`, `outbox.relay`,
 * `s3.*` —, que são os que os testes de trace verificam.
 */
export const testSpans = new InMemorySpanExporter();

export function installTestTracing(): void {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(testSpans)] }),
  );
}

export function findSpan(
  name: string,
  predicate: (span: ReadableSpan) => boolean = () => true,
): ReadableSpan {
  const span = testSpans.getFinishedSpans().find((s) => s.name === name && predicate(s));
  if (!span) throw new Error(`span ${name} não encontrado`);
  return span;
}
