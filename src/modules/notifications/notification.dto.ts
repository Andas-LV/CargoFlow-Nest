export class TelegramLinkResponse {
  /** https://t.me/<bot>?start=<code> */
  url!: string;
  expiresAt!: Date;
}

export class TelegramStatusResponse {
  linked!: boolean;
  linkedAt!: Date | null;
}

export class EmptyResponse {}
