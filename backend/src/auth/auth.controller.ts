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
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Verify2faDto } from './dto/verify-2fa.dto';
import { Public } from '../shared/decorators/public.decorator';
import { SkipCsrf } from '../shared/decorators/skip-csrf.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { JwtPayload } from './strategies/jwt.strategy';
import { resolveFrontendUrl } from '../shared/config/frontend-url';
import {
  issueSessionCookies,
  SESSION_COOKIE,
  CSRF_COOKIE,
} from '../shared/config/session-cookie';

/**
 * Authentication endpoints.
 * Public routes: register, login
 * Protected routes: logout, refresh, 2fa/enable, 2fa/verify
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Criar conta é barato para quem abusa e caro para nós: cada uma é uma linha
  // no banco e um hash bcrypt de 12 rounds.
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Public()
  @SkipCsrf() // ainda não existe sessão de onde tirar o par
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto);
    const csrfToken = this.setTokenCookie(res, result.accessToken);
    return {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      csrfToken,
    };
  }

  @Public()
  @SkipCsrf() // idem: o par de CSRF nasce nesta resposta
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

    const csrfToken = this.setTokenCookie(res, result.accessToken);
    return {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      csrfToken,
    };
  }

  /**
   * Quem está logado (SPEC_CP20 RF-2).
   *
   * Com o token fora do JavaScript, o SPA não tem mais como saber sozinho quem
   * é o usuário — o cookie é `httpOnly` justamente para não poder ser lido.
   * Esta rota é como ele descobre, e o servidor é quem responde: o papel usado
   * para montar a interface passa a vir do JWT verificado, não de um JSON que
   * estava no `localStorage` e podia ter sido editado à mão.
   */
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async me(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const profile = await this.authService.getProfile(user.sub);

    /*
      O token de CSRF acompanha o perfil (B20).

      Esta rota é a primeira coisa que o site chama ao abrir, e é por ela que o
      SPA descobre o token — já que o cookie legível pertence ao domínio da API
      e o JavaScript do site não o alcança. Reaproveita o cookie existente
      quando há um; só emite outro se ele tiver sumido, para não invalidar o
      token que outra aba já esteja usando.
    */
    const existente = req.cookies?.[CSRF_COOKIE];
    const csrfToken =
      existente || issueSessionCookies(res, req.cookies?.[SESSION_COOKIE] ?? '', process.env.NODE_ENV);

    return { ...profile, csrfToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.logout(user.jti, user.exp);
    // Os dois nasceram juntos e vão embora juntos
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.clearCookie(CSRF_COOKIE, { path: '/' });
    return { message: 'Logged out successfully' };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.refresh(user.sub);
    const csrfToken = this.setTokenCookie(res, result.accessToken);
    return {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      csrfToken,
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
    const csrfToken = this.setTokenCookie(res, result.accessToken);
    return {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      csrfToken,
    };
  }

  /**
   * Emite a sessão e devolve o token de CSRF para ir no corpo da resposta
   * (SPEC_CP20 RF-1, RF-5 e B20).
   *
   * O JWT vai num cookie que o JavaScript não lê. O par de CSRF vai num cookie
   * legível **e** no corpo — porque em produção o site e a API estão em domínios
   * diferentes, e `document.cookie` no site não enxerga cookie da API.
   */
  private setTokenCookie(res: Response, token: string): string {
    return issueSessionCookies(res, token, process.env.NODE_ENV);
  }

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

    /*
      A sessão vai no cookie; a URL não carrega mais nada (SPEC_CP20 RF-4).

      Antes o token e o JSON do usuário viajavam na query string. O CP19 já os
      apagava do histórico do navegador, mas isso é a última etapa do trajeto:
      até chegar lá a URL inteira passa por log de servidor, por proxy e pelo
      cabeçalho `Referer` de qualquer requisição que a página faça em seguida.
      O `?oauth=ok` existe só para o SPA saber que deve perguntar quem entrou.
    */
    this.setTokenCookie(res, result.accessToken!);
    return res.redirect(`${frontendUrl}/login?oauth=ok`);
  }
}
