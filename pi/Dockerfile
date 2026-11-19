FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

# pg_dump has to match the board's Postgres 18, which only PGDG ships for bookworm.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-client curl ca-certificates \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*
# ssh refuses to run for a uid with no passwd entry; 1000 matches the Pi user that owns ./data.
RUN useradd --uid 1000 --create-home herdr

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
COPY config.toml VERSION* ./
RUN uv sync --frozen --no-dev

USER herdr
ENV PATH="/app/.venv/bin:$PATH" HERDR_PI_CONFIG=/app/config.toml HERDR_PI_VERSION_FILE=/app/VERSION
HEALTHCHECK --interval=60s --timeout=5s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8095/health', timeout=4)"
CMD ["python", "-m", "herdr_pi"]
