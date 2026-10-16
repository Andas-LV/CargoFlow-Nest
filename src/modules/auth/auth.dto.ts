import { IsOptional, IsString } from 'class-validator';

// Поля необязательные, как в protobuf: пустое значение проверяет сервис и отвечает
// тем же текстом ошибки, что Go-бэкенд.

export class CredentialsDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  password?: string;
}

export class RefreshDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class RegisterResponse {
  userId!: string;
  email!: string;
}

export class TokensDto {
  accessToken!: string;
  refreshToken!: string;
  /** Секунды жизни access-токена; строка, как int64 в protojson. */
  expiresIn!: string;
}

export class TokensResponse {
  tokens!: TokensDto;
}
