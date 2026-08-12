import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { TokenBlacklistService } from './token-blacklist.service';
import { LoginRateLimitService } from './login-rate-limit.service';
import { User } from '../user/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('jwt.secret')!;
        const expiresIn = configService.get<string>('jwt.accessExpiry') || '15m';
        return {
          secret,
          signOptions: { expiresIn: expiresIn as any },
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    GoogleStrategy,
    TokenBlacklistService,
    LoginRateLimitService,
  ],
  controllers: [AuthController],
  exports: [AuthService, TokenBlacklistService, JwtModule],
})
export class AuthModule {}
