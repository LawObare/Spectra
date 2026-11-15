FROM python:3.11-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.4.29 /uv /usr/local/bin/uv

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/app/backend/.venv/bin:/home/user/.local/bin:$PATH \
    PYTHONPATH=/home/user/app \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
WORKDIR /home/user/app

# Dependency layer (cached unless pyproject.toml or uv.lock change)
COPY --chown=user backend/pyproject.toml backend/uv.lock ./backend/
RUN cd backend && uv sync --frozen --no-dev --no-install-project

# Application source, pre-cached benchmark .spx.zst sections, and entrypoint
COPY --chown=user backend/ ./backend/
RUN cd backend && uv sync --frozen --no-dev
COPY --chown=user start.sh ./start.sh
RUN chmod +x ./start.sh && mkdir -p /home/user/app/backend/cache/cutouts

EXPOSE 7860
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
    CMD curl -fsS http://127.0.0.1:7860/api/health/live || exit 1
CMD ["./start.sh"]
