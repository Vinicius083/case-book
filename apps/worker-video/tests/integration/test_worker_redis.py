"""Integração: job real atravessando o Redis até o `noop_processor`."""

import asyncio
import uuid

import pytest
from bullmq import Queue, Worker

from casebook_video.processors.noop import noop_processor
from casebook_video.settings import Settings

pytestmark = pytest.mark.integration

TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736"
TRACEPARENT = f"00-{TRACE_ID}-00f067aa0ba902b7-01"


async def test_worker_consumes_job_from_redis() -> None:
    settings = Settings()  # type: ignore[call-arg]
    # Fila exclusiva do teste: não disputa jobs com um worker de dev na fila "video".
    queue_name = f"video-test-{uuid.uuid4().hex[:8]}"
    opts = {"connection": settings.redis_url}

    queue = Queue(queue_name, opts)
    done: asyncio.Future[dict[str, str]] = asyncio.get_running_loop().create_future()
    worker = Worker(queue_name, noop_processor, opts)
    worker.on("completed", lambda _job, result: done.set_result(result))
    worker.on("failed", lambda _job, err: done.set_exception(RuntimeError(str(err))))

    try:
        await queue.add("noop", {"traceparent": TRACEPARENT, "note": "integração"})
        result = await asyncio.wait_for(done, timeout=10)
    finally:
        await worker.close()
        await queue.obliterate(force=True)
        await queue.close()

    # O processor devolve o trace_id que extraiu do payload vindo do Redis.
    assert result == {"traceId": TRACE_ID}
