from dataclasses import dataclass
from typing import Any

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind

from casebook_video.processors.noop import noop_processor

TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
PARENT_SPAN_ID = "00f067aa0ba902b7"

exporter = InMemorySpanExporter()
_provider = TracerProvider()
_provider.add_span_processor(SimpleSpanProcessor(exporter))
trace.set_tracer_provider(_provider)


@dataclass
class FakeJob:
    data: dict[str, Any]
    id: str | None = "1"
    name: str = "noop"
    attemptsMade: int = 0  # noqa: N815


async def test_video_process_is_child_of_traceparent() -> None:
    exporter.clear()
    job = FakeJob(data={"traceparent": f"00-{TRACE_ID}-{PARENT_SPAN_ID}-01", "note": "t"})

    result = await noop_processor(job)

    (span,) = exporter.get_finished_spans()
    assert result == {"traceId": TRACE_ID}
    assert span.name == "video.process"
    assert span.kind == SpanKind.CONSUMER
    assert format(span.context.trace_id, "032x") == TRACE_ID
    assert span.parent is not None
    assert format(span.parent.span_id, "016x") == PARENT_SPAN_ID


async def test_rejects_payload_without_traceparent() -> None:
    with pytest.raises(ValueError, match="traceparent"):
        await noop_processor(FakeJob(data={"note": "x"}))
