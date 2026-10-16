# CargoFlow → NestJS: выжимка для переписывания

Что делает текущий Go-бэкенд и как повторить его на NestJS: обычный REST, Postgres, Redis, без gRPC и NATS. REST-контракт сохраняется байт-в-байт, чтобы React-фронт работал без изменений.

---

## 1. Что это за система

Трекинг грузоперевозок по железным дорогам Казахстана:

- пользователь регистрируется и логинится (JWT access + refresh);
- создаёт **заявку** (вагон или контейнер) от станции A до станции B; станции берутся из справочника (≈1 200 станций КЗ из OpenStreetMap);
- меняет статус заявки: `created → in_transit → delivered`, отмена из `created` и `in_transit`;
- отмечает, какие станции прошёл груз: это **маршрут** (позиции);
- подключает свой Telegram через одноразовую deep-ссылку и получает уведомления о своих заявках.

### Как устроено сейчас (Go)

| Сервис | Что делает | Хранилище |
|---|---|---|
| gateway | REST → gRPC, проверка JWT, CORS, rate limit | Redis |
| auth | регистрация, логин, refresh, валидация токена | Postgres `auth`, Redis |
| shipment | заявки, статусы, справочник станций, outbox → NATS | Postgres `shipment`, Redis |
| tracking | позиции и маршрут; по `shipment.created` добавляет первую точку | Postgres `tracking` |
| notification | Telegram-бот (long polling), привязка чатов, уведомления по событиям | Postgres `notification`, Redis |

События (NATS JetStream, stream `CARGO`): `shipment.created`, `shipment.status_changed`, `tracking.position_updated`.

### Как будет в NestJS

Один процесс, **модульный монолит**, одна БД Postgres, Redis для всего остального:

| Было (Go) | Будет (NestJS) |
|---|---|
| 5 сервисов + gRPC | 1 приложение, модули `auth`, `stations`, `shipments`, `tracking`, `notifications` |
| grpc-gateway | обычные контроллеры `@Controller('v1/...')` |
| 4 базы Postgres | 1 база `cargoflow` (между `positions` и `stations` теперь можно поставить FK) |
| sqlc + goose | Prisma (схема + миграции), сложный SQL через `$queryRaw` |
| NATS JetStream | **BullMQ на Redis** (очереди) + transactional outbox в Postgres |
| gateway-middleware | глобальные guard'ы (`JwtAuthGuard`, `RateLimitGuard`) и exception filter |
| OpenTelemetry/Jaeger | по желанию; для начала хватит логов `nestjs-pino` |

---

## 2. Стек

```bash
npm i -g @nestjs/cli
nest new cargoflow-api --strict --package-manager npm

npm i @nestjs/config zod \
      @nestjs/jwt bcrypt \
      class-validator class-transformer \
      @prisma/client \
      ioredis \
      @nestjs/bullmq bullmq \
      @nestjs/schedule \
      @nestjs/swagger \
      @nestjs/terminus \
      nestjs-pino pino-http \
      grammy \
      csv-parse

npm i -D prisma @types/bcrypt pino-pretty
```

| Задача | Библиотека |
|---|---|
| Конфиг и валидация `.env` | `@nestjs/config` + `zod` |
| JWT | `@nestjs/jwt` (HS256, два секрета) |
| Пароли | `bcrypt` (cost 10, как `bcrypt.DefaultCost` в Go) |
| Валидация тела запроса | `class-validator` + глобальный `ValidationPipe` |
| БД | Prisma |
| Redis | `ioredis` (один клиент на всё приложение) |
| Очереди / события | `@nestjs/bullmq` |
| Outbox-релей | `@nestjs/schedule` (`@Interval`) |
| OpenAPI | `@nestjs/swagger`, отдаём на `/openapi.json` |
| health/ready | `@nestjs/terminus` |
| Telegram-бот | `grammy` (long polling) |
| Парсинг CSV станций | `csv-parse` |

---

## 3. Структура проекта

```
src/
  main.ts                      # bootstrap: CORS, trust proxy, pipes, filter, swagger
  app.module.ts
  config/
    env.schema.ts              # zod-схема всех переменных из .env
  common/
    errors/app-error.ts        # AppError(code, message) + коды как в gRPC
    errors/http-exception.filter.ts   # всё → {code, message, details}
    auth/jwt-auth.guard.ts     # глобальный, пропускает @Public()
    auth/public.decorator.ts
    auth/current-user.decorator.ts    # @CurrentUser() → userId
    rate-limit/rate-limit.guard.ts    # fixed window в Redis
  infra/
    prisma/prisma.service.ts
    redis/redis.module.ts      # провайдер REDIS (ioredis)
    queue/queues.ts            # имена очередей
  modules/
    auth/        controller, service, tokens.service, sessions.repository (Redis)
    stations/    controller, service (in-memory справочник), stations.seeder
    shipments/   controller, service, shipments.cache (Redis), mapper
    tracking/    controller, service, tracking.processor (BullMQ)
    notifications/ controller, service, link-codes.repository (Redis),
                   telegram.bot, notifications.processor (BullMQ), locale.ru.ts
    outbox/      outbox.service (enqueue в транзакции), outbox.relay (@Interval)
    health/      health.controller (/healthz, /readyz)
data/
  stations_kz.csv              # скопировать из services/shipment/data/
prisma/
  schema.prisma
  migrations/
```

---

## 4. Схема БД (Prisma)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String   @id @db.Uuid
  email        String   @unique
  passwordHash String   @map("password_hash")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  @@map("users")
}

model Station {
  id     String  @id                 // "osm-n922818608"
  esr    String  @default("")        // 6 цифр или ""
  kind   String                      // "station" | "halt"
  name   String
  nameRu String  @map("name_ru")
  nameKk String  @default("") @map("name_kk")
  nameEn String  @default("") @map("name_en")
  lat    Float
  lon    Float

  originOf      Shipment[] @relation("origin")
  destinationOf Shipment[] @relation("destination")
  positions     Position[]

  @@index([esr])
  @@map("stations")
}

enum CargoType {
  wagon
  container
}

enum ShipmentStatus {
  created
  in_transit
  delivered
  cancelled
}

model Shipment {
  id                   String         @id @db.Uuid
  ownerId              String         @map("owner_id") @db.Uuid
  cargoType            CargoType      @map("cargo_type")
  status               ShipmentStatus
  originStationId      String         @map("origin_station_id")
  destinationStationId String         @map("destination_station_id")
  createdAt            DateTime       @default(now()) @map("created_at") @db.Timestamptz
  updatedAt            DateTime       @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  origin      Station @relation("origin", fields: [originStationId], references: [id])
  destination Station @relation("destination", fields: [destinationStationId], references: [id])

  @@index([ownerId, createdAt(sort: Desc)])
  @@map("shipments")
}

model Position {
  // Для позиций из событий id = eventId: повторная доставка события ничего не дублирует.
  id         String   @id @db.Uuid
  shipmentId String   @map("shipment_id") @db.Uuid
  stationId  String   @map("station_id")
  station    String                       // название (рус.) на момент записи
  lat        Float    @default(0)
  lon        Float    @default(0)
  source     String                       // "manual" | "shipment.created"
  recordedAt DateTime @map("recorded_at") @db.Timestamptz

  stationRef Station @relation(fields: [stationId], references: [id])

  @@index([shipmentId, recordedAt])
  @@map("positions")
}

model TelegramLink {
  userId   String   @id @map("user_id") @db.Uuid   // у пользователя максимум один чат
  chatId   BigInt   @map("chat_id")
  linkedAt DateTime @default(now()) @map("linked_at") @db.Timestamptz

  @@index([chatId])
  @@map("telegram_links")
}

// Transactional outbox: событие пишется в той же транзакции, что и изменение заявки.
model Outbox {
  id        String    @id @db.Uuid                 // = eventId
  subject   String                                 // "shipment.created" и т.д.
  payload   Json
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz
  sentAt    DateTime? @map("sent_at") @db.Timestamptz

  @@index([createdAt])   // в миграции руками сделать частичный: WHERE sent_at IS NULL
  @@map("outbox")
}
```

---

## 5. REST API (контракт как у текущего бэкенда)

Все защищённые эндпоинты требуют `Authorization: Bearer <accessToken>`. Публичные: всё под `/v1/auth/*`, `/healthz`, `/readyz`, `/openapi.json`.

| Метод | Путь | Auth | Тело / query | Ответ |
|---|---|---|---|---|
| POST | `/v1/auth/register` | — | `{email, password}` | `{userId, email}` |
| POST | `/v1/auth/login` | — | `{email, password}` | `{tokens}` |
| POST | `/v1/auth/refresh` | — | `{refreshToken}` | `{tokens}` |
| GET | `/v1/stations` | ✓ | `?query=&pageSize=` (1..50, по умолчанию 20) | `{stations: Station[]}` |
| GET | `/v1/stations/:id` | ✓ | — | `{station}` |
| POST | `/v1/shipments` | ✓ | `{cargoType, originStationId, destinationStationId}` | `{shipment}` |
| GET | `/v1/shipments` | ✓ | `?pageSize=` (1..100, по умолчанию 20) | `{shipments: Shipment[]}` |
| GET | `/v1/shipments/:id` | ✓ | — | `{shipment}` |
| PATCH | `/v1/shipments/:id/status` | ✓ | `{status}` | `{shipment}` |
| POST | `/v1/shipments/:shipmentId/positions` | ✓ | `{stationId}` | `{position}` |
| GET | `/v1/shipments/:shipmentId/route` | ✓ | — | `{positions: Position[]}` |
| POST | `/v1/notifications/telegram/link` | ✓ | `{}` | `{url, expiresAt}` |
| GET | `/v1/notifications/telegram` | ✓ | — | `{linked, linkedAt}` |
| DELETE | `/v1/notifications/telegram` | ✓ | — | `{}` |
| GET | `/healthz` | — | — | `200 ok` |
| GET | `/readyz` | — | — | `{"db":"ok","redis":"ok"}` |
| GET | `/openapi.json` | — | — | OpenAPI-спека |

Все POST-ответы — **200**, не 201 (в Nest поставить `@HttpCode(200)`), так отвечает grpc-gateway.

### Форматы JSON (важно для совместимости с фронтом)

- Поля в **camelCase**.
- Enum'ы — строки в стиле protobuf: в БД `wagon`, наружу `CARGO_TYPE_WAGON`. Нужен маппер в обе стороны.
- Даты — ISO 8601 UTC (`2026-10-16T09:30:00.000Z`).
- Пустые поля **не выкидываются**: пустая строка `""`, `0`, `false`, отсутствующая дата → `null`.
- `expiresIn` — **строка** (protojson кодирует int64 строкой): `"900"`.

```jsonc
// Station
{
  "id": "osm-n260543817", "esr": "700002", "kind": "STATION_KIND_STATION",
  "name": "Алматы-1", "nameRu": "Алматы-1", "nameKk": "Алматы-1", "nameEn": "Almaty-1",
  "lat": 43.341, "lon": 76.950
}

// Shipment
{
  "id": "uuid", "ownerId": "uuid",
  "cargoType": "CARGO_TYPE_CONTAINER",          // | CARGO_TYPE_WAGON
  "status": "SHIPMENT_STATUS_CREATED",          // | _IN_TRANSIT | _DELIVERED | _CANCELLED
  "createdAt": "...", "updatedAt": "...",
  "originStation": { /* Station */ },
  "destinationStation": { /* Station */ }
}

// Position
{
  "id": "uuid", "shipmentId": "uuid", "stationId": "osm-n...",
  "station": "Алматы-1", "lat": 43.341, "lon": 76.950,
  "source": "manual",                           // | "shipment.created"
  "recordedAt": "..."
}

// tokens
{ "accessToken": "...", "refreshToken": "...", "expiresIn": "900" }

// telegram status
{ "linked": false, "linkedAt": null }
```

| Наружу | В БД |
|---|---|
| `CARGO_TYPE_WAGON` / `CARGO_TYPE_CONTAINER` | `wagon` / `container` |
| `SHIPMENT_STATUS_CREATED` / `_IN_TRANSIT` / `_DELIVERED` / `_CANCELLED` | `created` / `in_transit` / `delivered` / `cancelled` |
| `STATION_KIND_STATION` / `STATION_KIND_HALT` | `station` / `halt` |

### Ошибки

Единый формат, как у grpc-gateway:

```json
{ "code": 3, "message": "invalid input: email is not valid", "details": [] }
```

| `code` | HTTP | Когда |
|---|---|---|
| 3 `INVALID_ARGUMENT` | 400 | валидация, неизвестная станция, origin == destination |
| 16 `UNAUTHENTICATED` | 401 | нет токена, токен истёк, неверный email/пароль, refresh уже использован |
| 5 `NOT_FOUND` | 404 | нет заявки **или она чужая** (чужая выглядит как несуществующая) |
| 6 `ALREADY_EXISTS` | 409 | email уже зарегистрирован |
| 9 `FAILED_PRECONDITION` | 400 | недопустимый переход статуса; Telegram-бот не настроен |
| 8 `RESOURCE_EXHAUSTED` | 429 | rate limit |
| 14 `UNAVAILABLE` | 503 | лёг Postgres/Redis |
| 13 `INTERNAL` | 500 | всё остальное (текст наружу не отдавать) |

```ts
// common/errors/app-error.ts
export enum Code { InvalidArgument = 3, NotFound = 5, AlreadyExists = 6, ResourceExhausted = 8,
  FailedPrecondition = 9, Internal = 13, Unavailable = 14, Unauthenticated = 16 }

const httpStatus: Record<Code, number> = { 3: 400, 5: 404, 6: 409, 8: 429, 9: 400, 13: 500, 14: 503, 16: 401 };

export class AppError extends Error {
  constructor(readonly code: Code, message: string) { super(message); }
  get status() { return httpStatus[this.code]; }
}
```

```ts
// common/errors/http-exception.filter.ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger(AllExceptionsFilter.name);

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let code = Code.Internal, message = 'internal error';

    if (err instanceof AppError) {
      ({ code, message } = err);
    } else if (err instanceof BadRequestException) {     // ValidationPipe
      const r = err.getResponse() as { message: string | string[] };
      code = Code.InvalidArgument;
      message = 'invalid input: ' + [r.message].flat().join('; ');
    } else if (err instanceof HttpException) {
      code = fromHttp(err.getStatus()); message = err.message;
    } else {
      this.log.error(err);
    }
    res.status(new AppError(code, message).status).json({ code, message, details: [] });
  }
}
```

---

## 6. Бизнес-логика по модулям

### auth

- **Register**: `email = trim().toLowerCase()`, проверка формата email, пароль ≥ 8 символов, `bcrypt.hash(password, 10)`, `id = randomUUID()`. Unique violation (`P2002`) → `ALREADY_EXISTS "email already registered"`.
- **Login**: если пользователя нет — всё равно выполнить `bcrypt.compare` с фиктивным хешем (чтобы время ответа не выдавало, существует ли email). Любая ошибка → `UNAUTHENTICATED "invalid email or password"`.
- **Токены** HS256, **разные секреты** для access и refresh:
  - claims: `jti = uuid`, `iss = "cargoflow-auth"`, `sub = userId`, `aud = "access" | "refresh"`, `iat`, `exp`;
  - при проверке требовать алгоритм HS256, issuer, нужный audience, наличие `exp` и непустой `sub`.
- **Сессии refresh в Redis**: при выдаче пары `SET refresh:<jti> <userId> EX <refreshTtl>`.
- **Refresh** (ротация, каждый refresh-токен работает один раз): проверить подпись → `GETDEL refresh:<jti>`; нет ключа → `UNAUTHENTICATED "refresh token revoked or already used"`; `userId` не совпал с `sub` → `UNAUTHENTICATED`; иначе выдать новую пару.
- **Guard**: глобальный `JwtAuthGuard`, кладёт `userId` в `request.user`. Нет `Bearer` → 401 `"missing bearer token"`, плохой токен → 401 `"invalid or expired token"`.

```ts
// sessions.repository.ts
async consume(jti: string): Promise<string | null> {
  return this.redis.getdel(`refresh:${jti}`); // атомарно: прочитать и удалить
}
```

### stations

- При старте (`OnModuleInit`) прочитать `data/stations_kz.csv` (заголовок: `id,esr,kind,name,name_ru,name_kk,name_en,lat,lon`) и сделать upsert в `stations` одним запросом. Ничего не удалять: на станции ссылаются заявки.
- Потом загрузить всю таблицу в память (`Map<id, Station>` + массив для поиска). Около 1 200 строк, БД для поиска не нужна.
- **Поиск** `query` по названиям (ru, локальное, kk, en) и по ЕСР:
  - нормализация: lower-case; казахские буквы → русские; `ё → е`; `-` → пробел; схлопнуть пробелы;
  - ранг: 0 — точное совпадение (или ЕСР ровно равен query), 1 — префикс, 2 — префикс слова (`" " + q`), 3 — подстрока;
  - сортировка: ранг ↑, потом `station` раньше `halt`, потом `nameRu` по алфавиту;
  - пустой query → пустой список; limit по умолчанию 20, максимум 50.
- `GET /v1/stations/:id`: нет такой станции → `NOT_FOUND`.

```ts
const FOLD: Record<string, string> = {
  'ә': 'а', 'ғ': 'г', 'қ': 'к', 'ң': 'н', 'ө': 'о', 'ұ': 'у', 'ү': 'у', 'һ': 'х', 'і': 'и', 'ё': 'е', '-': ' ',
};
export const normalize = (s: string) =>
  s.toLowerCase().replace(/[әғқңөұүһіё-]/g, (c) => FOLD[c]).split(/\s+/).filter(Boolean).join(' ');

function matchRank(name: string, q: string): number {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(' ' + q)) return 2;
  if (name.includes(q)) return 3;
  return -1;
}
```

```ts
// upsert всех станций одним запросом
await prisma.$executeRaw`
  INSERT INTO stations (id, esr, kind, name, name_ru, name_kk, name_en, lat, lon)
  SELECT * FROM unnest(${ids}::text[], ${esrs}::text[], ${kinds}::text[], ${names}::text[],
                       ${namesRu}::text[], ${namesKk}::text[], ${namesEn}::text[],
                       ${lats}::float8[], ${lons}::float8[])
  ON CONFLICT (id) DO UPDATE SET esr = EXCLUDED.esr, kind = EXCLUDED.kind, name = EXCLUDED.name,
    name_ru = EXCLUDED.name_ru, name_kk = EXCLUDED.name_kk, name_en = EXCLUDED.name_en,
    lat = EXCLUDED.lat, lon = EXCLUDED.lon`;
```

Лицензия ODbL: на фронте, где показываются станции, нужна подпись «© OpenStreetMap contributors».

### shipments

- **Create**: `cargoType` обязателен (`WAGON`/`CONTAINER`); обе станции должны быть в справочнике; origin ≠ destination. В **одной транзакции**: insert заявки со статусом `created` + insert в `outbox` события `shipment.created`.
- **Get**: сначала Redis `shipment:v2:<id>` (JSON, TTL `SHIPMENT_CACHE_TTL_SEC`), промах → БД → положить в кеш. Ошибки Redis только логировать, запрос из-за них не падает. Если `ownerId !== userId` → `NOT_FOUND`.
- **List**: заявки владельца, `ORDER BY created_at DESC LIMIT pageSize`; `pageSize <= 0` → 20, максимум 100. Без кеша.
- **UpdateStatus**: в транзакции `SELECT ... FOR UPDATE` → чужая или нет → `NOT_FOUND` → проверка перехода → update → outbox `shipment.status_changed {oldStatus, newStatus}`. После коммита `DEL shipment:v2:<id>`.

```ts
const TRANSITIONS: Record<string, string[]> = {
  created:    ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'cancelled'],
};
// нельзя → AppError(Code.FailedPrecondition, `invalid status transition: ${from} -> ${to}`)
```

### tracking

- **AddPosition** (`POST /v1/shipments/:shipmentId/positions`, `{stationId}`): `stationId` обязателен → заявка существует и принадлежит пользователю (иначе `NOT_FOUND`) → станция есть в справочнике (иначе `INVALID_ARGUMENT`) → insert позиции (`source = "manual"`, `station = nameRu`, координаты из справочника, `recordedAt = now`) + событие `tracking.position_updated`.
  - В Go событие публикуется сразу после insert, без outbox (если NATS лежит, событие теряется). В Nest проще и надёжнее положить insert и outbox в одну транзакцию.
  - Статус заявки при этом не проверяется (так же, как в Go).
- **GetRoute**: проверка владельца → позиции по `recordedAt ASC`.
- **Обработчик `shipment.created`**: вставить первую точку маршрута — станцию отправления, `id = eventId`, `source = "shipment.created"`, `recordedAt = occurredAt`. Insert с `ON CONFLICT (id) DO NOTHING`, поэтому повторная доставка события безопасна.

В монолите проверка владельца — это обычный вызов `ShipmentsService`, а не gRPC.

### notifications (Telegram)

- `TELEGRAM_BOT_TOKEN` пустой → бот не запускается, уведомления молча пропускаются, `POST .../link` → `FAILED_PRECONDITION "telegram notifications are not configured"`.
- **CreateLink**: код = 12 случайных байт в base64url (16 символов), `SET tglink:<code> <userId> EX 600`. Ответ: `url = https://t.me/<botUsername>?start=<code>`, `expiresAt = now + 10 мин`. `botUsername` берётся из `bot.api.getMe()` при старте.
- **Status**: есть строка в `telegram_links` → `{linked: true, linkedAt}`, иначе `{linked: false, linkedAt: null}`.
- **Unlink**: удалить строку по `userId` (если строки нет, это не ошибка).
- **Бот** (grammY, long polling, только приватные чаты). Long polling может вести **только один инстанс**, второй получит 409 от Telegram.
  - `/start <code>` → `GETDEL tglink:<code>` → upsert `telegram_links(userId, chatId)`;
  - `/start` без кода, неверный или протухший код, `/stop`, любой другой текст → ответы ниже.
- **Уведомления**: обработчик очереди получает событие → ищет `chatId` владельца (`ownerId` из события) → `sendMessage(chatId, title + "\n" + text)`.
  - не привязан → пропустить (не ошибка);
  - Telegram ответил 403 или 400 (бот заблокирован, чат удалён) → пропустить, без ретраев;
  - сеть или 5xx → бросить ошибку, BullMQ повторит.

| Ситуация | Ответ бота |
|---|---|
| `/start <верный код>` | `Уведомления CargoFlow подключены ✅\nОтключить: /stop` |
| код неверный или протух | `Ссылка недействительна или устарела. Создайте новую в приложении CargoFlow.` |
| `/start` без кода | `Чтобы подключить уведомления, нажмите «Подключить Telegram» в приложении CargoFlow.` |
| `/stop` (что-то было привязано) | `Уведомления CargoFlow отключены. Подключить снова можно в приложении.` |
| `/stop` (ничего не было) | `Уведомления и так не подключены.` |
| другой текст | `Я присылаю уведомления о ваших заявках CargoFlow.\nПодключение — в приложении, отключение — /stop.` |
| внутренняя ошибка | `Что-то пошло не так, попробуйте позже.` |

`/stop` удаляет **все** привязки с этим `chatId`.

| Событие | Заголовок | Текст |
|---|---|---|
| `shipment.created` | `Заявка создана` | `Заявка <id> (<вагон\|контейнер>): <origin> → <destination>` |
| `shipment.status_changed` | `Статус вагона изменен` | `Заявка <id>: <Создана\|В пути\|Доставлена\|Отменена> → <...>` |
| `tracking.position_updated` | `Вагон перемещен` | `Заявка <id>: <станция>` |

---

## 7. События: outbox + BullMQ вместо NATS

```
HTTP-запрос ──► транзакция Postgres: [изменение данных] + [INSERT INTO outbox]
                                   │
OutboxRelay (@Interval 1s) ────────┘  SELECT ... WHERE sent_at IS NULL
                                       ORDER BY created_at LIMIT 100
                                       FOR UPDATE SKIP LOCKED
        │
        ├──► queue "tracking-events"      (только shipment.created)
        └──► queue "notification-events"  (все события)
                     jobId = eventId  → BullMQ не создаст дубль
```

- В BullMQ задачу из одной очереди получает **один** воркер, поэтому для fan-out нужна своя очередь на каждого потребителя (аналог durable consumers `tracking` и `notification`).
- Доставка at-least-once: если процесс упал после `queue.add`, но до коммита, событие уйдёт ещё раз. Дубли отсекаются `jobId = eventId` и идемпотентными обработчиками (`ON CONFLICT DO NOTHING`).
- Битое или неизвестное событие обработчик логирует и **не бросает** ошибку, иначе оно будет ретраиться вечно.
- Ретраи: `attempts: 10, backoff: { type: 'exponential', delay: 1000 }`, `removeOnComplete: 1000`, `removeOnFail: 5000`.

```ts
// outbox.relay.ts
@Interval(Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 1000))
async flush() {
  await this.prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<OutboxRow[]>`
      SELECT id, subject, payload FROM outbox
      WHERE sent_at IS NULL ORDER BY created_at LIMIT ${this.batchSize}
      FOR UPDATE SKIP LOCKED`;
    if (!rows.length) return;

    for (const r of rows) {
      const opts = { jobId: r.id };
      await this.notificationQ.add(r.subject, r.payload, opts);
      if (r.subject === 'shipment.created') await this.trackingQ.add(r.subject, r.payload, opts);
    }
    await tx.$executeRaw`UPDATE outbox SET sent_at = now() WHERE id = ANY(${rows.map((r) => r.id)}::uuid[])`;
  });
}
```

Payload'ы событий (JSON в `outbox.payload`):

```ts
type ShipmentCreated = {
  eventId: string; shipmentId: string; ownerId: string;
  cargoType: 'wagon' | 'container';
  origin: string; destination: string;          // nameRu, для текста уведомления
  originStationId: string; destinationStationId: string;
  occurredAt: string;
};
type ShipmentStatusChanged = {
  eventId: string; shipmentId: string; ownerId: string;
  oldStatus: string; newStatus: string; occurredAt: string;
};
type PositionUpdated = {
  eventId: string; shipmentId: string; ownerId: string;
  stationId: string; station: string; lat: number; lon: number; occurredAt: string;
};
```

---

## 8. Redis: все ключи

| Ключ | Значение | TTL | Кто пишет |
|---|---|---|---|
| `refresh:<jti>` | `userId` | `JWT_REFRESH_TTL_SEC` | auth; читается и удаляется через `GETDEL` |
| `shipment:v2:<id>` | JSON заявки | `SHIPMENT_CACHE_TTL_SEC` | shipments; `DEL` при смене статуса |
| `tglink:<code>` | `userId` | `TELEGRAM_LINK_TTL_SEC` | notifications; читается и удаляется через `GETDEL` |
| `rl:<ip>:<bucket>` | счётчик | `RATE_LIMIT_WINDOW_SEC` | RateLimitGuard |
| `bull:*` | очереди | — | BullMQ |

Для BullMQ у ioredis-соединения нужно `maxRetriesPerRequest: null`. Upstash подходит, но BullMQ шлёт много команд и быстро съедает бесплатный лимит; на проде лучше Render Key Value или Redis в Docker.

---

## 9. Rate limit, CORS, bootstrap

Fixed window на IP, общий для всех инстансов, **fail-open**: если Redis недоступен, запрос пропускается.

```ts
// rate-limit.guard.ts
async canActivate(ctx: ExecutionContext) {
  const req = ctx.switchToHttp().getRequest<Request>();
  const res = ctx.switchToHttp().getResponse<Response>();
  const bucket = Math.floor(Date.now() / (this.windowSec * 1000));
  const key = `rl:${req.ip}:${bucket}`;
  let count: number;
  try {
    const [[, n]] = (await this.redis.multi().incr(key).expire(key, this.windowSec).exec())!;
    count = n as number;
  } catch (e) {
    this.log.warn(`rate limit: redis error, allowing request: ${e}`);
    return true;
  }
  res.setHeader('X-RateLimit-Limit', this.limit);
  res.setHeader('X-RateLimit-Remaining', Math.max(this.limit - count, 0));
  if (count > this.limit) {
    res.setHeader('Retry-After', this.windowSec);
    throw new AppError(Code.ResourceExhausted, 'rate limit exceeded');
  }
  return true;
}
```

```ts
// main.ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
app.set('trust proxy', 1);                  // req.ip из X-Forwarded-For (Render и другие прокси)
app.enableShutdownHooks();                  // корректно остановить бота и BullMQ-воркеры
app.enableCors({
  origin: env.CORS_ALLOWED_ORIGINS.split(','),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
});
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
app.useGlobalFilters(new AllExceptionsFilter());
// guards: APP_GUARD → RateLimitGuard, затем JwtAuthGuard (в AppModule providers)

const doc = SwaggerModule.createDocument(app, new DocumentBuilder()
  .setTitle('CargoFlow API').setVersion('1.0').addBearerAuth().build());
app.getHttpAdapter().get('/openapi.json', (_req, res) => res.json(doc));
if (env.SWAGGER_UI) SwaggerModule.setup('docs', app, doc);

await app.listen(env.PORT);
```

Бонус для фронта: `@nestjs/swagger` генерирует OpenAPI 3, поэтому `openapi-typescript` работает напрямую, без шага `swagger2openapi`.

---

## 10. Локальная инфраструктура

`docker-compose.yml` в корне нового проекта:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: cargo
      POSTGRES_PASSWORD: cargo
      POSTGRES_DB: cargoflow
    ports: ["5434:5432"]          # 5432 часто занят локальным PostgreSQL
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U cargo -d cargoflow"]
      interval: 2s
      retries: 30

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]   # BullMQ лучше не терять при рестарте
    ports: ["6379:6379"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 2s
      retries: 30

volumes:
  pgdata:
```

Если Go-версия запущена параллельно, она уже занимает 5434 и 6379: остановите её (`make infra-down`) или поменяйте порты здесь и в `.env`.

```bash
docker compose up -d --wait
cp .env.example .env
npx prisma migrate dev --name init
npm run start:dev
```

---

## 11. `.env`

Значения ниже рабочие для локального запуска с compose из раздела 10. Секреты JWT на проде заменить (`openssl rand -base64 48`). Все длительности — в секундах, чтобы одно и то же число шло и в JWT `exp`, и в Redis `EX`, и в `expiresIn`.

```dotenv
# ---------- общее ----------
# development | production | test
NODE_ENV=development
# HTTP-порт API (фронт ходит сюда вместо gateway)
PORT=8080
# trace | debug | info | warn | error
LOG_LEVEL=debug
# Список origin через запятую: Vite локально + домен на Vercel
CORS_ALLOWED_ORIGINS=http://localhost:5173
# Swagger UI на /docs (спека на /openapi.json отдаётся всегда)
SWAGGER_UI=true

# ---------- Postgres ----------
# Prod (Neon): postgresql://<user>:<password>@<endpoint>.neon.tech/cargoflow?sslmode=require
DATABASE_URL=postgresql://cargo:cargo@localhost:5434/cargoflow?schema=public
# true → при старте выполняется `prisma migrate deploy` (для Render)
MIGRATE_ON_START=false

# ---------- Redis ----------
# Prod: rediss://default:<password>@<host>:6379
REDIS_URL=redis://localhost:6379/0
# Префикс ключей BullMQ (bull:* по умолчанию)
QUEUE_PREFIX=cargoflow

# ---------- JWT ----------
# Разные секреты для access и refresh, на проде: openssl rand -base64 48
JWT_ACCESS_SECRET=dev-access-secret-change-me-0123456789abcdef
JWT_REFRESH_SECRET=dev-refresh-secret-change-me-0123456789abcdef
# 15 минут
JWT_ACCESS_TTL_SEC=900
# 7 дней
JWT_REFRESH_TTL_SEC=604800
JWT_ISSUER=cargoflow-auth
BCRYPT_ROUNDS=10

# ---------- rate limit (fixed window на IP в Redis) ----------
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_SEC=60

# ---------- shipments ----------
# TTL кеша заявок в Redis (5 минут)
SHIPMENT_CACHE_TTL_SEC=300

# ---------- outbox / очереди ----------
# Как часто релей забирает неотправленные события
OUTBOX_POLL_INTERVAL_MS=1000
OUTBOX_BATCH_SIZE=100
# Ретраи обработчиков событий
QUEUE_JOB_ATTEMPTS=10
QUEUE_BACKOFF_MS=1000

# ---------- Telegram ----------
# Токен от @BotFather. Пусто — бот и уведомления выключены, остальное API работает.
TELEGRAM_BOT_TOKEN=
# Время жизни одноразовой ссылки t.me/<bot>?start=<code> (10 минут)
TELEGRAM_LINK_TTL_SEC=600

# ---------- справочник станций ----------
# CSV из Go-проекта: services/shipment/data/stations_kz.csv
STATIONS_CSV_PATH=data/stations_kz.csv
```

Валидация при старте (`config/env.schema.ts`):

```ts
import { z } from 'zod';

const sec = z.coerce.number().int().positive();
// z.coerce.boolean() превратил бы строку "false" в true, поэтому разбираем руками
const flag = z.enum(['true', 'false']).transform((v) => v === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  SWAGGER_UI: flag.default('false'),

  DATABASE_URL: z.string().url(),
  MIGRATE_ON_START: flag.default('false'),

  REDIS_URL: z.string().url(),
  QUEUE_PREFIX: z.string().default('cargoflow'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SEC: sec.default(900),
  JWT_REFRESH_TTL_SEC: sec.default(604800),
  JWT_ISSUER: z.string().default('cargoflow-auth'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  RATE_LIMIT_REQUESTS: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_SEC: sec.default(60),

  SHIPMENT_CACHE_TTL_SEC: sec.default(300),

  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  QUEUE_JOB_ATTEMPTS: z.coerce.number().int().positive().default(10),
  QUEUE_BACKOFF_MS: z.coerce.number().int().positive().default(1000),

  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_LINK_TTL_SEC: sec.default(600),

  STATIONS_CSV_PATH: z.string().default('data/stations_kz.csv'),
});
export type Env = z.infer<typeof envSchema>;

// app.module.ts:
// ConfigModule.forRoot({ isGlobal: true, validate: (raw) => envSchema.parse(raw) })
```

---

## 12. Порядок работы

1. `nest new`, compose, `.env`, zod-конфиг, Prisma-схема, первая миграция.
2. `common/`: `AppError`, exception filter, `JwtAuthGuard` + `@Public()`, `@CurrentUser()`, `ValidationPipe`.
3. **auth**: register, login, refresh с ротацией в Redis. Проверить curl'ами из `README.md` Go-проекта.
4. **stations**: загрузка CSV при старте, поиск в памяти, тесты на `normalize` и ранжирование (запрос «жезказган» находит «Жезқазған», «алматы 1» находит «Алматы-1»).
5. **shipments**: CRUD, переходы статусов, кеш, outbox в транзакции.
6. **outbox relay** + BullMQ-очереди + **tracking** (обработчик `shipment.created`, positions, route).
7. **notifications**: grammY-бот, link-коды, обработчик уведомлений.
8. Rate limit, `/healthz`, `/readyz`, `/openapi.json`, CORS.
9. Направить фронт на новый бэкенд (тот же `localhost:8080`) и пройти сценарий: регистрация → заявка → смена статуса → позиция → маршрут → уведомление в Telegram.

### На что легко наступить

- Ответы POST должны быть 200, а не 201.
- Enum'ы наружу в формате `CARGO_TYPE_*` / `SHIPMENT_STATUS_*` / `STATION_KIND_*`, иначе фронт сломается.
- `expiresIn` — строка.
- Чужая заявка → 404, а не 403.
- Ошибки Redis-кеша и rate limit не должны ронять запрос.
- Telegram-бот на long polling работает только в одном инстансе.
- Prisma `BigInt` (`chatId`) не сериализуется в JSON сам по себе. Наружу `chatId` не отдаётся, но в логах и кеше нужен `.toString()`.
