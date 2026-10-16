# CargoFlow API (NestJS) — команды разработчика. Рецепты на POSIX sh (Git Bash на Windows).

COMPOSE := docker compose
PNPM    := pnpm

.DEFAULT_GOAL := help

.PHONY: help
help: ## Показать список команд
	@grep -hE '^[a-zA-Z0-9_%-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# ---------- быстрый старт ----------
.PHONY: dev
dev: setup ## Всё сразу: .env, зависимости, Postgres + Redis, миграции, API в watch-режиме (:8080)
	$(PNPM) start:dev

.PHONY: setup
setup: .env node_modules/.modules.yaml infra-up migrate ## Подготовить окружение без запуска API

.env:
	cp .env.example .env
	@echo ".env создан из .env.example"

# pnpm обновляет этот файл при каждой установке: зависимости ставятся заново, только если
# менялись package.json или lock-файл. Если install падает с EPERM на query_engine-*.dll.node,
# остановите запущенный API: он держит файл движка Prisma.
node_modules/.modules.yaml: package.json pnpm-lock.yaml
	$(PNPM) install
	@touch $@

.PHONY: install
install: ## Установить зависимости (и сгенерировать Prisma Client)
	$(PNPM) install

# ---------- инфраструктура ----------
.PHONY: docker-check
docker-check:
	@docker info >/dev/null 2>&1 || { echo "Docker не запущен: откройте Docker Desktop и повторите"; exit 1; }

.PHONY: infra-up
infra-up: docker-check ## Поднять Postgres (:5434) и Redis (:6380) и дождаться healthcheck
	$(COMPOSE) up -d --wait

.PHONY: infra-down
infra-down: ## Остановить Postgres и Redis (данные сохраняются)
	$(COMPOSE) down

.PHONY: infra-reset
infra-reset: docker-check ## Удалить контейнеры вместе с данными и поднять заново с миграциями
	$(COMPOSE) down -v
	$(MAKE) infra-up migrate

.PHONY: infra-logs
infra-logs: ## Логи Postgres и Redis
	$(COMPOSE) logs -f

# ---------- база ----------
.PHONY: migrate
migrate: ## Применить миграции (prisma migrate deploy)
	$(PNPM) exec prisma migrate deploy

.PHONY: migration
migration: ## Новая миграция из schema.prisma: make migration name=add_something
	@test -n "$(name)" || { echo "укажите имя: make migration name=add_something"; exit 1; }
	$(PNPM) exec prisma migrate dev --name $(name)

.PHONY: studio
studio: ## Prisma Studio — просмотр данных в браузере
	$(PNPM) exec prisma studio

# ---------- запуск ----------
.PHONY: build
build: ## Собрать в dist/
	$(PNPM) build

.PHONY: start
start: build ## Собрать и запустить как на проде (node dist/main)
	$(PNPM) start:prod

# ---------- проверки ----------
.PHONY: lint
lint: ## ESLint + проверка форматирования
	$(PNPM) exec eslint "{src,test}/**/*.ts"
	$(PNPM) exec prettier --check "{src,test}/**/*.ts"

.PHONY: fmt
fmt: ## Отформатировать код (prettier + eslint --fix)
	$(PNPM) exec prettier --write "{src,test}/**/*.ts"
	$(PNPM) exec eslint "{src,test}/**/*.ts" --fix

.PHONY: typecheck
typecheck: ## Проверка типов без сборки
	$(PNPM) exec tsc --noEmit

.PHONY: test
test: ## Юнит-тесты
	$(PNPM) test

.PHONY: test-e2e
test-e2e: infra-up migrate ## Сквозные тесты (поднимает инфраструктуру сама)
	$(PNPM) test:e2e

.PHONY: check
check: lint typecheck test ## Всё перед коммитом: линт, типы, юнит-тесты
