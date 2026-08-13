import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { User, UserRole } from '../user/entities/user.entity';
import { AppError, ErrorCodes } from '../shared/errors';
import { TokenBlacklistService } from './token-blacklist.service';
import { LoginRateLimitService } from './login-rate-limit.service';
import { JwtPayload } from './strategies/jwt.strategy';

export interface RegisterDto {
  email: string;
  password: string;
  name: string;
  role: UserRole;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; name: string; role: UserRole };
  requiresTwoFactor?: boolean;
}

/**
 * Autenticação: senha com bcrypt (12 rounds), JWT de 15 min, revogação por
 * blacklist no Redis e a mesma resposta para e-mail errado e senha errada.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly blacklistService: TokenBlacklistService,
    private readonly rateLimitService: LoginRateLimitService,
  ) {}

  async register(dto: RegisterDto): Promise<LoginResult> {
    const existing = await this.userRepo.findOne({ where: { email: dto.email.toLowerCase() } });
    if (existing) {
      throw new AppError(
        `Este email já está cadastrado`,
        ErrorCodes.ALREADY_EXISTS,
        409,
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = this.userRepo.create({
      email: dto.email.toLowerCase(),
      passwordHash,
      name: dto.name,
      role: dto.role,
      totpEnabled: false,
    });

    const saved = await this.userRepo.save(user);
    return this.generateTokens(saved);
  }

  async login(email: string, password: string, clientIp: string): Promise<LoginResult> {
    const isBlocked = await this.rateLimitService.isBlocked(clientIp);
    if (isBlocked) {
      throw new AppError(
        'Invalid credentials',
        ErrorCodes.UNAUTHORIZED,
        401,
      );
    }

    const user = await this.userRepo.findOne({
      where: { email: email.toLowerCase() },
    });

    // E-mail inexistente ainda gasta um hash: sem isso, o tempo de resposta
    // conta quais e-mails existem.
    if (!user) {
      await bcrypt.hash('dummy-password-timing-equalization', 12);
      await this.rateLimitService.recordFailure(clientIp);
      throw new AppError('Invalid credentials', ErrorCodes.UNAUTHORIZED, 401);
    }

    if (user.oauthProvider === 'google') {
      throw new AppError(
        'Esta conta foi criada com Google. Use o botão "Login com Google".',
        ErrorCodes.UNAUTHORIZED,
        401,
      );
    }

    if (!user.passwordHash) {
      await this.rateLimitService.recordFailure(clientIp);
      throw new AppError('Invalid credentials', ErrorCodes.UNAUTHORIZED, 401);
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      await this.rateLimitService.recordFailure(clientIp);
      throw new AppError('Invalid credentials', ErrorCodes.UNAUTHORIZED, 401);
    }

    await this.rateLimitService.resetFailures(clientIp);

    if (user.totpEnabled) {
      // Resultado parcial: falta o código TOTP
      const tempToken = this.jwtService.sign(
        { sub: user.id, twoFactorPending: true },
        { expiresIn: '5m' },
      );
      return {
        accessToken: tempToken,
        refreshToken: '',
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        requiresTwoFactor: true,
      };
    }

    return this.generateTokens(user);
  }

  /**
   * O usuário por trás do cookie. Lê do banco, não do JWT: papel revogado ou
   * conta apagada precisam aparecer agora, não quando o token expirar.
   */
  async getProfile(userId: string): Promise<{
    id: string;
    email: string;
    name: string;
    role: UserRole;
  }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new AppError('Invalid credentials', ErrorCodes.UNAUTHORIZED, 401);
    }

    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }

  async logout(jti: string, exp: number): Promise<void> {
    const remainingTtl = exp - Math.floor(Date.now() / 1000);
    if (remainingTtl > 0) {
      await this.blacklistService.blacklist(jti, remainingTtl + 60);
    }
  }

  async isTokenBlacklisted(jti: string): Promise<boolean> {
    return this.blacklistService.isBlacklisted(jti);
  }

  async refresh(userId: string): Promise<LoginResult> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new AppError('User not found', ErrorCodes.UNAUTHORIZED, 401);
    }
    return this.generateTokens(user);
  }

  async enable2FA(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const { Authenticator } = await import('otplib') as any;
    const authenticator = new Authenticator() as any;
    // A API muda entre versões do otplib
    const auth = authenticator.generateSecret ? authenticator : (await import('otplib') as any).default?.authenticator || (await import('otplib') as any);
    
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new AppError('User not found', ErrorCodes.NOT_FOUND, 404);
    }

    const secret = auth.generateSecret();
    const otpauthUrl = auth.keyuri(user.email, 'TicketToRide', secret);

    user.totpSecret = secret;
    await this.userRepo.save(user);

    return { secret, otpauthUrl };
  }

  async verify2FA(userId: string, code: string): Promise<LoginResult> {
    const { Authenticator } = await import('otplib') as any;
    const authenticator = new Authenticator() as any;
    const auth = authenticator.generateSecret ? authenticator : (await import('otplib') as any).default?.authenticator || (await import('otplib') as any);

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.totpSecret) {
      throw new AppError('Invalid credentials', ErrorCodes.UNAUTHORIZED, 401);
    }

    const isValid = auth.verify({ token: code, secret: user.totpSecret });
    if (!isValid) {
      throw new AppError('Invalid credentials', ErrorCodes.UNAUTHORIZED, 401);
    }

    if (!user.totpEnabled) {
      user.totpEnabled = true;
      await this.userRepo.save(user);
    }

    return this.generateTokens(user);
  }

  private generateTokens(user: User): LoginResult {
    const jti = uuidv4();
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti,
    };

    const accessToken = this.jwtService.sign(payload as any, {
      expiresIn: this.configService.get<string>('jwt.accessExpiry', '15m') as any,
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.id, jti: uuidv4(), type: 'refresh' } as any,
      { expiresIn: this.configService.get<string>('jwt.refreshExpiry', '7d') as any },
    );

    return {
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }

  /**
   * Login pelo Google. E-mail que já tem conta com senha é recusado — vincular
   * as duas sem confirmar posse do e-mail seria caminho de sequestro de conta.
   */
  async handleGoogleLogin(googleUser: {
    email: string;
    name: string;
    oauthProvider: string;
    oauthId: string;
  }): Promise<{ accessToken?: string; refreshToken?: string; user?: any; error?: string }> {
    const existing = await this.userRepo.findOne({
      where: { email: googleUser.email.toLowerCase() },
    });

    if (existing) {
      if (existing.passwordHash && existing.oauthProvider !== 'google') {
        return { error: 'Este email já tem uma conta. Faça login com email e senha.' };
      }

      if (existing.oauthProvider === 'google') {
        const tokens = this.generateTokens(existing);
        return tokens;
      }
    }

    // Conta nova pelo Google nasce como cliente
    const user = this.userRepo.create({
      email: googleUser.email.toLowerCase(),
      name: googleUser.name,
      passwordHash: null,
      role: UserRole.CLIENT,
      oauthProvider: 'google',
      oauthId: googleUser.oauthId,
      totpEnabled: false,
    });

    const saved = await this.userRepo.save(user);
    return this.generateTokens(saved);
  }

  /**
   * De quem é esta requisição (SPEC_CP21).
   *
   * `req.ip` primeiro: com `trust proxy` o Express já sabe quantos saltos são
   * nossos. Se sobrar o cabeçalho, o cliente é a PRIMEIRA entrada — a última é o
   * proxy, o mesmo endereço para todo mundo. Lendo pela direita, cinco erros de
   * qualquer um trancavam a porta para todos: negação de serviço de graça.
   */
  static extractClientIp(req: {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
  }): string {
    if (req.ip?.trim()) return req.ip.trim();

    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const header = Array.isArray(xff) ? xff[0] : xff;
      const client = header.split(',')[0]?.trim();
      if (client) return client;
    }

    return '0.0.0.0';
  }
}
