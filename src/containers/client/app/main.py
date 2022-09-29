import logging
import os
import time
import requests

from lumigo_opentelemetry import tracer_provider
from opentelemetry import trace
from opentelemetry.exporter.jaeger.thrift import JaegerExporter
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace.status import Status, StatusCode

logging.basicConfig(level=logging.INFO)

if not (target_url := os.environ.get("TARGET_URL")):
    raise Exception("The required 'TARGET_URL' is not defined")

# Add Jaeger exporter to the tracer
tracer_provider.add_span_processor(BatchSpanProcessor(JaegerExporter()))

tracer = trace.get_tracer(__name__)

while True:
    # We create an internal root span, as this is effectively a
    # batch job.
    with tracer.start_as_current_span("server_root") as root_span:

        try:
            response = requests.get(target_url, timeout=10)
            response.raise_for_status()

            root_span.set_status(Status(StatusCode.OK))
        except Exception as e:
            root_span.set_status(Status(StatusCode.ERROR, "Request failed"))
            root_span.record_exception(e)

    time.sleep(1)

# Ensure all spans are sent downstream before the process completes
tracer_provider.force_flush()
