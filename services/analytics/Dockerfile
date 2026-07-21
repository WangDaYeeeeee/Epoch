FROM python:3.13-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.30 /uv /uvx /bin/

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

COPY services/analytics/pyproject.toml services/analytics/uv.lock ./
RUN uv sync --locked --no-install-project --no-dev

COPY services/analytics/src ./src
RUN uv sync --locked --no-dev --no-editable

EXPOSE 8000
CMD ["uvicorn", "epoch_analytics_service.api:app", "--host", "0.0.0.0", "--port", "8000"]
