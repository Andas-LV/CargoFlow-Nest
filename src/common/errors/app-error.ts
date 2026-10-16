/** Коды ошибок как в gRPC: фронт получает тот же {code, message, details}, что от grpc-gateway. */
export enum Code {
  InvalidArgument = 3,
  NotFound = 5,
  AlreadyExists = 6,
  ResourceExhausted = 8,
  FailedPrecondition = 9,
  Internal = 13,
  Unavailable = 14,
  Unauthenticated = 16,
}

const httpStatus: Record<Code, number> = {
  [Code.InvalidArgument]: 400,
  [Code.NotFound]: 404,
  [Code.AlreadyExists]: 409,
  [Code.ResourceExhausted]: 429,
  [Code.FailedPrecondition]: 400,
  [Code.Internal]: 500,
  [Code.Unavailable]: 503,
  [Code.Unauthenticated]: 401,
};

export class AppError extends Error {
  constructor(
    readonly code: Code,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return httpStatus[this.code];
  }

  /** Ошибка валидации в формате Go-сервисов: "invalid input: <detail>". */
  static invalidInput(detail: string): AppError {
    return new AppError(Code.InvalidArgument, `invalid input: ${detail}`);
  }
}

export function statusOf(code: Code): number {
  return httpStatus[code];
}

/** Обратное соответствие для HttpException, которые бросает сам Nest (404 маршрута, 413 и т.п.). */
export function codeFromHttp(status: number): Code {
  switch (status) {
    case 400:
      return Code.InvalidArgument;
    case 401:
      return Code.Unauthenticated;
    case 404:
      return Code.NotFound;
    case 409:
      return Code.AlreadyExists;
    case 429:
      return Code.ResourceExhausted;
    case 503:
      return Code.Unavailable;
    default:
      return status >= 400 && status < 500
        ? Code.InvalidArgument
        : Code.Internal;
  }
}
