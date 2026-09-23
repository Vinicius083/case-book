import asyncio
import logging
import signal

import av
from bullmq import Worker

from casebook_video.processors.noop import noop_processor
from casebook_video.settings import Settings
from casebook_video.telemetry import setup_telemetry

QUEUE = "video"  # QUEUES.video em @casebook/contracts

log = logging.getLogger("casebook_video")


def log_media_stack() -> None:
    # Valida no boot que PyAV carrega e com qual FFmpeg foi linkado.
    ffmpeg = {name: ".".join(map(str, ver)) for name, ver in av.library_versions.items()}
    log.info("PyAV %s | FFmpeg libs %s", av.__version__, ffmpeg)


async def main() -> None:
    settings = Settings()  # type: ignore[call-arg]  # campos obrigatórios vêm do env
    provider = setup_telemetry(settings.otel_exporter_otlp_endpoint)
    log_media_stack()

    worker = Worker(
        QUEUE,
        noop_processor,
        {
            "connection": settings.redis_url,  # db 0 = filas
            "concurrency": settings.worker_concurrency,
            "lockDuration": settings.lock_duration_ms,
        },
    )
    log.info(
        'ouvindo fila "%s" (concorrência %d, lock %ds)',
        QUEUE,
        settings.worker_concurrency,
        settings.lock_duration_ms // 1000,
    )

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()

    log.info("encerrando: aguardando job em andamento...")
    await worker.close()  # sem force: espera o job atual
    provider.shutdown()


def run() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [video] %(message)s")
    asyncio.run(main())


if __name__ == "__main__":
    run()
