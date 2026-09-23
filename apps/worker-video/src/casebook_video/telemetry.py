from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

SERVICE = "casebook-worker-video"


def setup_telemetry(otlp_endpoint: str) -> TracerProvider:
    """Tracer global exportando OTLP/HTTP para o collector do SigNoz."""
    provider = TracerProvider(resource=Resource.create({SERVICE_NAME: SERVICE}))
    exporter = OTLPSpanExporter(endpoint=f"{otlp_endpoint.rstrip('/')}/v1/traces")
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    return provider
