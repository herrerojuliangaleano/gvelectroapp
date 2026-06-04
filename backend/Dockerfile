FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STORAGE_DIR=/app/storage \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    # Runtime deps de Chromium (Playwright) — listadas manualmente porque
    # `playwright install --with-deps` falla en Debian 12 (paquetes renombrados).
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 \
    libxshmfence1 libwayland-client0 libxss1 \
    fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Chromium para Playwright (anuncios de precios renderizados desde HTML+CSS).
RUN python -m playwright install chromium

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
