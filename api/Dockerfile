# Playwright 런타임/브라우저(Chromium) 포함 이미지 사용
FROM mcr.microsoft.com/playwright/python:v1.49.1-jammy AS base
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# DB 백업(pg_dump)을 API 컨테이너에서 수행할 수 있도록 Postgres client(16)를 포함한다.
# - server(Postgres 16)과 major 불일치 시 pg_dump가 실패할 수 있어 16을 명시 설치한다.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && install -d /etc/apt/keyrings \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt jammy-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV ANALYTICS_DB_URL=postgresql://analytics:analytics_pw@analytics-db:5432/analytics
ENV PW_USER_DATA_DIR=/data/playwright/user-data
ENV PW_DEBUG_PORT=9222

EXPOSE 8000 9222
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]


