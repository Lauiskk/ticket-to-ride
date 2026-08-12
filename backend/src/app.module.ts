import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { SharedModule } from './shared/shared.module';
import { AuthModule } from './auth/auth.module';
import { EventModule } from './event/event.module';
import { ReservationModule } from './reservation/reservation.module';
import { PaymentModule } from './payment/payment.module';
import { TicketModule } from './ticket/ticket.module';
import { GateModule } from './gate/gate.module';
import { SharingModule } from './sharing/sharing.module';
import { HealthModule } from './health/health.module';
import { SeedModule } from './seed/seed.module';
import { RequestIdMiddleware } from './shared/middleware/request-id.middleware';
import { AppAuthGuard } from './shared/guards/auth.guard';
import { RolesGuard } from './shared/guards/roles.guard';
import { configuration, envValidationSchema } from './shared/config/configuration';
import { getTypeOrmConfig } from './shared/config/typeorm.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
    TypeOrmModule.forRoot(getTypeOrmConfig()),
    SharedModule,
    AuthModule,
    EventModule,
    ReservationModule,
    PaymentModule,
    TicketModule,
    GateModule,
    SharingModule,
    HealthModule,
    SeedModule,
  ],
  providers: [
    // Global guards — applied to all routes (use @Public() to skip auth)
    { provide: APP_GUARD, useClass: AppAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
