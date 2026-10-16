# CargoFlow API (NestJS)

Порт Go-бэкенда CargoFlow на NestJS: модульный монолит, Postgres (Prisma), Redis, BullMQ. REST-контракт совпадает с grpc-gateway, поэтому React-фронт работает без изменений. Подробности переноса — в [NESTJS_PORT.md](NESTJS_PORT.md).

## Запуск

Нужны Node 22+, pnpm и Docker.

```bash
pnpm install                 # заодно генерирует Prisma Client
cp .env.example .env
pnpm infra:up                # Postgres :5434, Redis :6380
pnpm db:deploy               # применить миграции
pnpm start:dev               # API на http://localhost:8080
```

- Swagger UI: <http://localhost:8080/docs> (при `SWAGGER_UI=true`), спека: `/openapi.json`.
- Health: `/healthz`, `/readyz` (503, если Postgres или Redis недоступны).
- Telegram: укажите `TELEGRAM_BOT_TOKEN` в `.env`. Без токена бот и уведомления выключены, остальное API работает.

## Тесты

```bash
pnpm test        # юнит-тесты: поиск станций, переходы статусов, тексты уведомлений
pnpm test:e2e    # сквозной сценарий; нужны поднятые infra и миграции
```

## Модули

| Модуль | Что делает |
| --- | --- |
| `auth` | регистрация, логин, refresh с ротацией (сессии в Redis), глобальный `JwtAuthGuard` |
| `stations` | справочник из `data/stations_kz.csv`: upsert при старте, поиск в памяти |
| `shipments` | заявки, переходы статусов, кеш в Redis, события в outbox в той же транзакции |
| `outbox` | релей outbox → очереди BullMQ (`FOR UPDATE SKIP LOCKED`, `jobId = eventId`) |
| `tracking` | позиции и маршрут; по `shipment.created` добавляет первую точку |
| `notifications` | grammY-бот (long polling, один инстанс), deep-ссылки, уведомления |

## Схема БД

Меняйте `prisma/schema.prisma` и создавайте миграцию через `pnpm db:migrate --name <name>`. Частичный индекс `outbox_unsent_idx` есть только в SQL первой миграции: Prisma не умеет его описывать и не трогает.

Данные станций: © OpenStreetMap contributors (ODbL). На фронте рядом со станциями нужна эта подпись.
