import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionsRepository } from './sessions.repository';
import { TokensService } from './tokens.service';

@Module({
  // Секреты передаются при каждом sign/verify: у access и refresh они разные.
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokensService, SessionsRepository],
  exports: [TokensService],
})
export class AuthModule {}
