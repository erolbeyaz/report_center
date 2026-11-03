# Rapor Merkezi: tek imaj (React build'i FastAPI üzerinden sunulur)

FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-trixie
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    RM_DATA_DIR=/data \
    RM_SECRETS_DIR=/etc/rapor-merkezi \
    RM_FRONTEND_DIST=/app/frontend/dist \
    RM_CORS_ORIGINS=
# Diğer ayarlar (RM_TIMEZONE, RM_BOOTSTRAP_FILE, RM_HEALTH_CHECKS_FILE, RM_DATABASE_URL…) çalıştırırken verilir; bkz. README
# Microsoft ODBC Driver 18 (MSSQL veri kaynakları için; TLS ve sertifika doğrulaması destekler)
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSLo /tmp/ms.deb https://packages.microsoft.com/config/debian/13/packages-microsoft-prod.deb \
 && dpkg -i /tmp/ms.deb && rm /tmp/ms.deb \
 && apt-get update \
 && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18 unixodbc libgssapi-krb5-2 \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt \
 && groupadd -g 10001 rapor && useradd -u 10001 -g 10001 -M -d /app -s /usr/sbin/nologin rapor \
 && mkdir -p /data /etc/rapor-merkezi && chown 10001:10001 /data
COPY backend/app ./app
COPY --from=web /web/dist /app/frontend/dist

USER 10001:10001
VOLUME ["/data"]
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz',timeout=2).status==200 else 1)"
# Tek worker: Ana Sayfa sağlık önbelleği süreç içinde tutulur
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
