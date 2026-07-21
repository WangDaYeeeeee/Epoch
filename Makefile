.PHONY: dev web migrate scheduler scheduler-once test lint build verify

dev:
	docker compose up --build

web:
	pnpm --filter @epoch/web dev

migrate:
	pnpm db:migrate

scheduler:
	pnpm scheduler

scheduler-once:
	pnpm scheduler:once

test:
	pnpm --filter @epoch/web test

lint:
	pnpm lint

build:
	pnpm build

verify: lint test build
