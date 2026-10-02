# syntax=docker/dockerfile:1.7
# Build (contexto = raiz do repo):
#   docker build -f apps/worker-video/Dockerfile -t casebook-worker-video .
#
# Debian slim, não Alpine: musl quebra os wheels de PyAV/numpy/scikit-image
# (sem wheel musllinux → compila do fonte, ou simplesmente falha).

ARG PYTHON_IMAGE=python:3.12-slim-bookworm

# ─── build: resolve o venv a partir do uv.lock ────────────────────────────────
FROM ${PYTHON_IMAGE} AS build
COPY --from=ghcr.io/astral-sh/uv:0.11.7 /uv /bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /src
# Dependências primeiro (camada cacheável), projeto depois.
COPY apps/worker-video/pyproject.toml apps/worker-video/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/worker-video/src ./src
# --no-editable: o pacote vai para dentro do venv; o runtime só precisa do .venv.
RUN uv sync --frozen --no-dev --no-editable

# ─── ffmpeg: build estático GPL (libx264/libx265), fixado por versão e checksum ─
# Versão, origem e SHA256 ficam em scripts/fetch_ffmpeg.py (fonte única, também
# usada pelo CI). O script aborta o build se o checksum do tarball não bater.
FROM ${PYTHON_IMAGE} AS ffmpeg
COPY apps/worker-video/scripts/fetch_ffmpeg.py /fetch_ffmpeg.py
RUN python /fetch_ffmpeg.py /out && /out/ffmpeg -version | head -1

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM ${PYTHON_IMAGE} AS runtime
# ffmpeg/ffprobe estáticos (ver stage `ffmpeg` e docs/adr/0001). O encode roda
# por este CLI em subprocess; o PyAV usa as libs FFmpeg do próprio wheel.
COPY --from=ffmpeg /out/ffmpeg /out/ffprobe /usr/local/bin/
RUN useradd --system --uid 10001 --create-home worker
COPY --from=build --chown=worker:worker /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1
WORKDIR /app
USER worker
# Sem HEALTHCHECK: worker sem HTTP; o lock do BullMQ cobre worker travado.
CMD ["casebook-video"]
