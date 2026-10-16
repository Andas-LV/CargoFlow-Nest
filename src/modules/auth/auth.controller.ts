import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/auth/public.decorator';
import {
  CredentialsDto,
  RefreshDto,
  RegisterResponse,
  TokensResponse,
} from './auth.dto';
import { AuthService } from './auth.service';
import type { TokenPair } from './tokens.service';

@ApiTags('auth')
@Public()
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(200)
  async register(@Body() body: CredentialsDto): Promise<RegisterResponse> {
    const user = await this.auth.register(
      body.email ?? '',
      body.password ?? '',
    );
    return { userId: user.id, email: user.email };
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: CredentialsDto): Promise<TokensResponse> {
    return toResponse(
      await this.auth.login(body.email ?? '', body.password ?? ''),
    );
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: RefreshDto): Promise<TokensResponse> {
    return toResponse(await this.auth.refresh(body.refreshToken ?? ''));
  }
}

function toResponse(pair: TokenPair): TokensResponse {
  return {
    tokens: {
      accessToken: pair.accessToken,
      refreshToken: pair.refreshToken,
      expiresIn: String(pair.expiresIn),
    },
  };
}
