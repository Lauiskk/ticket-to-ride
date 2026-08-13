import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';
import { ResponseInterceptor } from './shared/interceptors/response.interceptor';
import { AppValidationPipe } from './shared/pipes/app-validation.pipe';
import { CsrfGuard } from './shared/guards/csrf.guard';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import { parseCorsOrigins } from './shared/config/cors';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    /*
      Só JSON entra (SPEC_CP20 RF-6).

      Com a sessão num cookie, o navegador anexa a credencial sozinho. Um
      `fetch` cross-origin com `Content-Type: application/json` esbarra no
      preflight e o CORS recusa — mas um `<form>` de outro site não faz
      preflight nenhum, e ele só sabe falar `urlencoded` e `multipart`. Desligar
      esses formatos fecha o caminho que sobrava para uma requisição autenticada
      partir de fora.
    */
    bodyParser: false,
  });
  const configService = app.get(ConfigService);

  /*
    Desligar o parser do Nest também desliga o `rawBody: true` dele — e o
    webhook da Stripe verifica a assinatura sobre os bytes EXATOS que chegaram.
    Reserializar o objeto já parseado muda espaços e ordem de chaves, a
    assinatura não confere e o pagamento deixa de ser confirmado sem ninguém
    ver. Por isso o corpo cru é guardado aqui, na entrada.
  */
  const { json } = await import('express');
  app.use(
    json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );

  // Atrás do proxy do Railway, sem isto `req.ip` é o IP do proxy — e o
  // limitador de login passaria a contar todo mundo como a mesma pessoa.
  app.set('trust proxy', 1);

  // Security & performance
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  // Global pipes, filters, interceptors
  app.useGlobalPipes(new AppValidationPipe());
  app.useGlobalGuards(new CsrfGuard(app.get(Reflector)));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  app.enableCors({
    origin: parseCorsOrigins(
      configService.get<string>('cors.origin', 'http://localhost:5173'),
    ),
    credentials: true,
  });

  const port = configService.get<number>('port', 3000);
  await app.listen(port);

  console.log(`Ticket to Ride API running on port ${port}`);
}

bootstrap();
