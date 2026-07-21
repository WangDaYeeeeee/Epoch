.PHONY: dev web test lint

dev:
	docker compose up --build

web:
	pnpm --filter @epoch/web dev

test:
	pnpm --filter @epoch/web test

lint:
	pnpm lint
