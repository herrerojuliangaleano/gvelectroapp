FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STORAGE_DIR=/app/storage

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app
COPY alembic /app/alembic
COPY alembic.ini /app/alembic.ini
COPY legacy_scripts /app/legacy_scripts
COPY scripts /app/scripts

RUN mkdir -p /app/storage/uploads /app/storage/runs /app/storage/logs /app/storage/outputs /app/storage/secrets /app/storage/private /app/secrets

EXPOSE 8000

# Healthcheck contra el endpoint /api/health (sin depender de curl).
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=5 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status==200 else 1)" || exit 1

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
