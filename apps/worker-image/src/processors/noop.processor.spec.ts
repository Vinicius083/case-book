import { context, propagation, SpanKind, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { noopProcessor } from './noop.processor.js';

import type { Job } from 'bullmq';

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
});

afterAll(() => {
  trace.disable();
  context.disable();
  propagation.disable();
});

describe('noopProcessor', () => {
  it('abre image.process como filho do span do traceparent', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const parentSpanId = '00f067aa0ba902b7';
    const job = {
      id: '1',
      name: 'noop',
      queueName: 'image',
      attemptsMade: 0,
      data: { traceparent: `00-${traceId}-${parentSpanId}-01`, note: 'teste' },
    } as unknown as Job<unknown>;

    const result = await noopProcessor(job);

    const [span] = exporter.getFinishedSpans();
    expect(result.traceId).toBe(traceId);
    expect(span?.name).toBe('image.process');
    expect(span?.kind).toBe(SpanKind.CONSUMER);
    expect(span?.spanContext().traceId).toBe(traceId);
    expect(span?.parentSpanContext?.spanId).toBe(parentSpanId);
  });

  it('rejeita payload sem traceparent', async () => {
    const job = { data: { note: 'x' } } as unknown as Job<unknown>;
    await expect(noopProcessor(job)).rejects.toThrow();
  });
});
