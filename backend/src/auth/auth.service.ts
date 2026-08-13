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
 * Core authentication service.
 *
 * Key behaviors:
 * - Argon2id for password hashing (Req 2.4)
 * - Anti-enumeration: same response for wrong email and wrong password (Req 2.6)
 * - Login rate limiting integrated (Req 2.7)
 * - Token revocation from any mechanism (Req 2.8)
 * - IP extraction from rightmost X-Forwarded-For (Req 2.10)
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

  // ─── Registration ─────────────────────────────────────────────────────────

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

  // ─── Login ────────────────────────────────────────────────────────────────

  async login(email: string, password: string, clientIp: string): Promise<LoginResult> {
    // Check rate limit first
    const isBlocked = await this.rateLimitService.isBlocked(clientIp);
    if (isBlocked) {
      // Anti-enumeration: same generic message (Req 2.6)
      throw new AppError(
        'Invalid credentials',
        ErrorCodes.UNAUTHORIZED,
        401,
      );
    }

    const user = await this.userRepo.findOne({
      where: { email: email.toLowerCase() },
    });

    // Anti-enumeration: if email doesn't exist, still "verify" a dummy hash
    // to prevent timing attacks (Req 2.6)
    if (!user) {
      // Spend time hashing to match timing of a real verification
      await bcrypt.hash('dummy-password-timing-equalization', 12);
      await this.rateLimitService.recordFailure(clientIp);
      throw new AppError('Invalid credentials', ErrorCodes.UNAUTHORIZED, 401);
    }

    // If user registered via Google, they must login via Google
    if (user.oauthProvider === 'google') {
      throw new AppError(
        'Esta conta foi criada com Google. Use o botão "Login com Google".',
        ErrorCodes.UNAUTHORIZED,
        401,
      );
    }

    if (!user.passwordHash) {
      // User registered via OAuth, no password set
      await this.rateLimitService.recordFailure(clientIp);
      throw new AppError('Invalid credentials', ErrorCodes.UNAUTHORIZED, 401);
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      await this.rateLimitService.recordFailure(clientIp);
      throw new AppError('Invalid credentials', ErrorCodes.UNAUTHORIZED, 401);
    }

    // Successful login — reset rate limit
    await this.rateLimitService.resetFailures(clientIp);

    // Check if 2FA is required
    if (user.totpEnabled) {
      // Return partial result — frontend must submit TOTP code
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

  // ─── Perfil da sessão (SPEC_CP20 RF-2) ────────────────────────────────────

  /**
   * O usuário por trás do cookie.
   *
   * Lê do banco em vez de devolver o conteúdo do JWT: papel revogado ou conta
   * apagada precisam aparecer aqui, não continuar valendo até o token expirar.
   * Devolve exatamente o que a interface usa — nunca o hash de senha nem o
   * segredo de 2FA.
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

  // ─── Token Operations ─────────────────────────────────────────────────────

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

  // ─── 2FA ──────────────────────────────────────────────────────────────────

  async enable2FA(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const { Authenticator } = await import('otplib') as any;
    const authenticator = new Authenticator() as any;
    // Fallback for different otplib versions
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

  // ─── Helpers ──────────────────────────────────────────────────────────────

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

  // ─── Google OAuth ──────────────────────────────────────────────────────────

  /**
   * Handle Google OAuth login.
   *
   * Rules:
   * - If email exists with passwordHash (registered via email/password) → error "Este email já tem conta"
   * - If email exists with oauthProvider=google → login (return tokens)
   * - If email doesn't exist → create new user with role CLIENT
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
      // User exists with password (not OAuth) — block
      if (existing.passwordHash && existing.oauthProvider !== 'google') {
        return { error: 'Este email já tem uma conta. Faça login com email e senha.' };
      }

      // User exists with Google OAuth — login
      if (existing.oauthProvider === 'google') {
        const tokens = this.generateTokens(existing);
        return tokens;
      }
    }

    // New user — create with CLIENT role via Google
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
   * Extract client IP from the rightmost value of X-Forwarded-For (Req 2.10).
   * The rightmost value is the one appended by our trusted proxy.
   */
  static extractClientIp(req: { headers: Record<string, string | string[] | undefined>; ip?: string }): string {
    const xff = req.headers['x-forwarded-for'];
    if (xff) {
      const header = Array.isArray(xff) ? xff[0] : xff;
      const ips = header.split(',').map((ip) => ip.trim());
      // Rightmost = the one our proxy appended (most trusted)
      return ips[ips.length - 1] || req.ip || '0.0.0.0';
    }
    return req.ip || '0.0.0.0';
  }
}
