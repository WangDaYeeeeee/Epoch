.PHONY: setup dev local web analytics analytics-sync migrate scheduler scheduler-once test test-web test-analytics lint build verify

setup:
	pnpm install --frozen-lockfile
	uv sync --locked --project services/analytics

dev:
	docker compose up --build

local:
	pnpm dev:local

web:
	pnpm --filter @epoch/web dev

analytics:
	uv run --project services/analytics epoch-analytics serve --reload

analytics-sync:
	uv sync --locked --project services/analytics

migrate:
	pnpm db:migrate

scheduler:
	pnpm scheduler

scheduler-once:
	pnpm scheduler:once

test:
	pnpm test

test-web:
	pnpm test:web

test-analytics:
	pnpm analytics:test

lint:
	pnpm lint

build:
	pnpm build

verify: lint test build
