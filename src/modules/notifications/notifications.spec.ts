import { toMessage } from './notifications.processor';
import { parseCommand } from './telegram.bot';

describe('parseCommand', () => {
  it.each([
    ['/start abc', ['/start', 'abc']],
    ['  /START@CargoFlowBot   abc  ', ['/start', 'abc']],
    ['/stop', ['/stop', '']],
    ['привет', ['привет', '']],
    ['', ['', '']],
  ])('%j', (text, want) => {
    expect(parseCommand(text)).toEqual(want);
  });
});

describe('toMessage', () => {
  const id = '6b0f6c3e-3f7e-4d8a-9a51-1c2d3e4f5a6b';
  const owner = '0e7a1b2c-3d4e-4f50-8a9b-0c1d2e3f4a5b';

  it('shipment.created', () => {
    expect(
      toMessage('shipment.created', {
        shipmentId: id,
        ownerId: owner,
        cargoType: 'container',
        origin: 'Алматы-1',
        destination: 'Астана',
      }),
    ).toEqual({
      userId: owner,
      title: 'Заявка создана',
      text: `Заявка ${id} (контейнер): Алматы-1 → Астана`,
    });
  });

  it('shipment.status_changed', () => {
    expect(
      toMessage('shipment.status_changed', {
        shipmentId: id,
        ownerId: owner,
        oldStatus: 'created',
        newStatus: 'in_transit',
      })?.text,
    ).toBe(`Заявка ${id}: Создана → В пути`);
  });

  it('tracking.position_updated', () => {
    expect(
      toMessage('tracking.position_updated', {
        shipmentId: id,
        ownerId: owner,
        station: 'Шу',
      }),
    ).toMatchObject({ title: 'Вагон перемещен', text: `Заявка ${id}: Шу` });
  });

  it('неизвестное или битое событие → null', () => {
    expect(toMessage('foo.bar', { ownerId: owner })).toBeNull();
    expect(toMessage('shipment.created', null)).toBeNull();
  });
});
