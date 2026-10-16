// Нужна поднятая инфраструктура: docker compose up -d --wait && pnpm db:deploy
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- тела ответов supertest нетипизированы */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

describe('CargoFlow API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /healthz', () =>
    request(app.getHttpServer()).get('/healthz').expect(200, { status: 'ok' }));

  it('защищённый эндпоинт без токена → 401 в формате grpc-gateway', () =>
    request(app.getHttpServer())
      .get('/v1/shipments')
      .expect(401, { code: 16, message: 'missing bearer token', details: [] }));

  it('регистрация → логин → заявка → смена статуса → маршрут', async () => {
    const http = request(app.getHttpServer());
    const email = `e2e-${Date.now()}@example.com`;
    const creds = { email, password: 'password123' };

    await http.post('/v1/auth/register').send(creds).expect(200);
    const login = await http.post('/v1/auth/login').send(creds).expect(200);
    expect(login.body.tokens.expiresIn).toBe('900');
    const auth = { Authorization: `Bearer ${login.body.tokens.accessToken}` };

    const find = async (query: string): Promise<string> => {
      const res = await http
        .get('/v1/stations')
        .query({ query })
        .set(auth)
        .expect(200);
      return res.body.stations[0].id;
    };
    const [origin, destination] = [
      await find('алматы 1'),
      await find('астана'),
    ];

    const created = await http
      .post('/v1/shipments')
      .set(auth)
      .send({
        cargoType: 'CARGO_TYPE_WAGON',
        originStationId: origin,
        destinationStationId: destination,
      })
      .expect(200);
    const { id, status } = created.body.shipment;
    expect(status).toBe('SHIPMENT_STATUS_CREATED');

    await http
      .patch(`/v1/shipments/${id}/status`)
      .set(auth)
      .send({ status: 'SHIPMENT_STATUS_DELIVERED' })
      .expect(400)
      .expect((r) => expect(r.body.code).toBe(9));
    await http
      .patch(`/v1/shipments/${id}/status`)
      .set(auth)
      .send({ status: 'SHIPMENT_STATUS_IN_TRANSIT' })
      .expect(200);

    // Первая точка маршрута приходит асинхронно: outbox → BullMQ → tracking.
    let positions: { source: string }[] = [];
    for (let i = 0; i < 20 && positions.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 250));
      positions = (
        await http.get(`/v1/shipments/${id}/route`).set(auth).expect(200)
      ).body.positions;
    }
    expect(positions.map((p) => p.source)).toEqual(['shipment.created']);
  });
});
