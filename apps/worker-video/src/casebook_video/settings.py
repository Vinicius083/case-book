from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Env do worker. Em dev lê o `.env` da raiz do monorepo."""

    model_config = SettingsConfigDict(
        env_file=("../../.env", ".env"),
        extra="ignore",
    )

    redis_url: str = Field(pattern=r"^rediss?://")
    otel_exporter_otlp_endpoint: str = Field(pattern=r"^https?://")
    # Encode satura CPU: um job por vez por processo; escala com réplicas.
    worker_concurrency: int = Field(default=1, ge=1)
    # 15 min: um transcode longo não pode perder o lock e ser reentregue a outro worker.
    lock_duration_ms: int = Field(default=15 * 60 * 1000, ge=30_000)
