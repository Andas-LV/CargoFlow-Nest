const cargoTypes: Record<string, string> = {
  wagon: 'вагон',
  container: 'контейнер',
};

const statuses: Record<string, string> = {
  created: 'Создана',
  in_transit: 'В пути',
  delivered: 'Доставлена',
  cancelled: 'Отменена',
};

const translate = (dict: Record<string, string>, code: string) =>
  Object.hasOwn(dict, code) ? dict[code] : code;

export const cargoTypeRu = (code: string) => translate(cargoTypes, code);
export const statusRu = (code: string) => translate(statuses, code);

export const REPLY = {
  linked: 'Уведомления CargoFlow подключены ✅\nОтключить: /stop',
  badCode:
    'Ссылка недействительна или устарела. Создайте новую в приложении CargoFlow.',
  noCode:
    'Чтобы подключить уведомления, нажмите «Подключить Telegram» в приложении CargoFlow.',
  unlinked:
    'Уведомления CargoFlow отключены. Подключить снова можно в приложении.',
  notLinked: 'Уведомления и так не подключены.',
  help: 'Я присылаю уведомления о ваших заявках CargoFlow.\nПодключение — в приложении, отключение — /stop.',
  internalFail: 'Что-то пошло не так, попробуйте позже.',
} as const;
