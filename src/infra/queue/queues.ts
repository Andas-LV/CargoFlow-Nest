/**
 * В BullMQ задачу из очереди получает один воркер, поэтому на каждого потребителя своя очередь
 * (аналог durable consumers "tracking" и "notification" в NATS).
 */
export const TRACKING_QUEUE = 'tracking-events';
export const NOTIFICATION_QUEUE = 'notification-events';
