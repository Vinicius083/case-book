import logging
import re
from typing import Any, Protocol

from opentelemetry import trace
from opentelemetry.trace import SpanKind
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

log = logging.getLogger(__name__)
tracer = trace.get_tracer("casebook-worker-video")
propagator = TraceContextTextMapPropagator()

# Mesmo formato validado por `traceparentSchema` em @casebook/contracts.
TRACEPARENT = re.compile(r"^[\da-f]{2}-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$")


class JobLike(Protocol):
    id: str | None
    name: str
    data: dict[str, Any]
    attemptsMade: int  # noqa: N815 — nome vem do bullmq


def parse_payload(data: dict[str, Any]) -> tuple[str, str]:
    traceparent = data.get("traceparent")
    note = data.get("note")
    if not isinstance(traceparent, str) or not TRACEPARENT.match(traceparent):
        raise ValueError("payload sem traceparent W3C válido")
    if not isinstance(note, str):
        raise ValueError("payload sem 'note'")
    return traceparent, note


async def noop_processor(job: JobLike, _token: str | None = None) -> dict[str, str]:
    """Reconstrói o contexto OTel do `traceparent` e abre `video.process` como filho."""
    traceparent, note = parse_payload(job.data)
    parent = propagator.extract({"traceparent": traceparent})

    with tracer.start_as_current_span(
        "video.process",
        context=parent,
        kind=SpanKind.CONSUMER,
        attributes={
            "messaging.system": "bullmq",
            "messaging.destination.name": "video",
            "messaging.message.id": job.id or "",
            "job.name": job.name,
            "job.attempt": job.attemptsMade + 1,
        },
    ) as span:
        log.info("job %s (%s): %s", job.id, job.name, note)
        return {"traceId": format(span.get_span_context().trace_id, "032x")}
