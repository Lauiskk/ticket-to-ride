import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter';
import { ResponseInterceptor } from './shared/interceptors/response.interceptor';
import { AppValidationPipe } from './shared/pipes/app-validation.pipe';
import helmet from 'helmet';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Needed for Stripe webhook signature verification
  });
  const configService = app.get(ConfigService);

  // Security & performance
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  // Global pipes, filters, interceptors
  app.useGlobalPipes(new AppValidationPipe());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  app.enableCors({
    origin: configService.get<string>('cors.origin', 'http://localhost:5173'),
    credentials: true,
  });

  const port = configService.get<number>('port', 3000);
  await app.listen(port);

  console.log(`Ticket to Ride API running on port ${port}`);
}

bootstrap();
