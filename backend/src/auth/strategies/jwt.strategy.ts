import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { Request } from 'express';

/**
 * O token é lido do cookie `access_token` primeiro e do header `Authorization`
 * depois. O navegador usa o cookie; `curl` e os testes de fluxo usam o header.
 */

export interface JwtPayload {
  sub: string;       // user ID
  email: string;
  role: string;
  jti: string;       // unique token ID (for blacklisting)
  iat: number;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // 1. Try cookie first
        (req: Request): string | null => {
          const token = req?.cookies?.['access_token'];
          return token || null;
        },
        // 2. Fall back to Authorization header
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') || 'fallback-secret',
    });
  }

  /**
   * Called after JWT is verified. The returned object is set on request.user.
   */
  validate(payload: JwtPayload): JwtPayload {
    return payload;
  }
}
