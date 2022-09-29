FROM python:3.9

WORKDIR /code

COPY ./requirements.txt /code/requirements.txt

RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

COPY ./app /code/app

# Activate the Lumigo instrumentation
ENV AUTOWRAPT_BOOTSTRAP='lumigo_opentelemetry'

CMD ["python3", "/code/app/main.py"]