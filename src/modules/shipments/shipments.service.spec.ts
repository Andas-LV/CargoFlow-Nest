import { ShipmentStatus } from '@prisma/client';
import { canTransition } from './shipments.service';

describe('canTransition', () => {
  const { created, in_transit, delivered, cancelled } = ShipmentStatus;

  it.each([
    [created, in_transit],
    [created, cancelled],
    [in_transit, delivered],
    [in_transit, cancelled],
  ])('%s -> %s разрешён', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    [created, delivered],
    [created, created],
    [in_transit, created],
    [delivered, cancelled],
    [cancelled, in_transit],
  ])('%s -> %s запрещён', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});
