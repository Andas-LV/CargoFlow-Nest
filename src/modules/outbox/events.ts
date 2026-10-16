export const SUBJECT_SHIPMENT_CREATED = 'shipment.created';
export const SUBJECT_SHIPMENT_STATUS_CHANGED = 'shipment.status_changed';
export const SUBJECT_POSITION_UPDATED = 'tracking.position_updated';

export interface ShipmentCreatedEvent {
  eventId: string;
  shipmentId: string;
  ownerId: string;
  cargoType: string; // wagon | container
  origin: string; // nameRu, для текста уведомления
  destination: string;
  originStationId: string;
  destinationStationId: string;
  occurredAt: string;
}

export interface ShipmentStatusChangedEvent {
  eventId: string;
  shipmentId: string;
  ownerId: string;
  oldStatus: string;
  newStatus: string;
  occurredAt: string;
}

export interface PositionUpdatedEvent {
  eventId: string;
  shipmentId: string;
  ownerId: string;
  stationId: string;
  station: string;
  lat: number;
  lon: number;
  occurredAt: string;
}

export interface EventsBySubject {
  [SUBJECT_SHIPMENT_CREATED]: ShipmentCreatedEvent;
  [SUBJECT_SHIPMENT_STATUS_CHANGED]: ShipmentStatusChangedEvent;
  [SUBJECT_POSITION_UPDATED]: PositionUpdatedEvent;
}

export type Subject = keyof EventsBySubject;
