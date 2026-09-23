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

# ─── runtime ──────────────────────────────────────────────────────────────────
FROM ${PYTHON_IMAGE} AS runtime
# ffmpeg/ffprobe de linha de comando (probe, debug e fallback). O PyAV traz as
# próprias libs FFmpeg no wheel; estas são independentes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --create-home worker
COPY --from=build --chown=worker:worker /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1
WORKDIR /app
USER worker
# Sem HEALTHCHECK: worker sem HTTP; o lock do BullMQ cobre worker travado.
CMD ["casebook-video"]
