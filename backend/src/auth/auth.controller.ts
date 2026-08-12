import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Verify2faDto } from './dto/verify-2fa.dto';
import { Public } from '../shared/decorators/public.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { JwtPayload } from './strategies/jwt.strategy';
import { resolveFrontendUrl } from '../shared/config/frontend-url';

/**
 * Authentication endpoints.
 * Public routes: register, login
 * Protected routes: logout, refresh, 2fa/enable, 2fa/verify
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto);
    this.setTokenCookie(res, result.accessToken);
    return {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const clientIp = AuthService.extractClientIp(req);
    const result = await this.authService.login(dto.email, dto.password, clientIp);

    if (result.requiresTwoFactor) {
      return {
        requiresTwoFactor: true,
        tempToken: result.accessToken,
      };
    }

    this.setTokenCookie(res, result.accessToken);
    return {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.jti, user.exp);
    res.clearCookie('access_token');
    return { message: 'Logged out successfully' };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.refresh(user.sub);
    this.setTokenCookie(res, result.accessToken);
    return {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  async enable2FA(@CurrentUser() user: JwtPayload) {
    return this.authService.enable2FA(user.sub);
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verify2FA(
    @CurrentUser() user: JwtPayload,
    @Body() dto: Verify2faDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verify2FA(user.sub, dto.code);
    this.setTokenCookie(res, result.accessToken);
    return {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private setTokenCookie(res: Response, token: string): void {
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000, // 15 minutes
      path: '/',
    });
  }

  // ─── Google OAuth ───────────────────────────────────────────────────────────

  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    // Passport handles redirect to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const googleUser = req.user as any;
    const result = await this.authService.handleGoogleLogin(googleUser);
    const frontendUrl = resolveFrontendUrl(
      process.env.FRONTEND_URL,
      process.env.CORS_ORIGIN,
    );

    if (result.error) {
      // Email already has a password account — redirect with error
      return res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(result.error)}`);
    }

    // Success — set cookie and redirect to /login with token params (LoginPage handles them)
    this.setTokenCookie(res, result.accessToken!);
    return res.redirect(`${frontendUrl}/login?token=${result.accessToken}&user=${encodeURIComponent(JSON.stringify(result.user))}`);
  }
}
