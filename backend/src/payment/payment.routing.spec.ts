import { PaymentController } from './payment.controller';
import { StripeWebhookController } from './webhook/stripe-webhook.controller';
import { PaymentModule } from './payment.module';

/**
 * Regression test for the route collision that silently broke Stripe in
 * production (SPEC_CP10 RF-3).
 *
 * Both controllers live under `payments`. PaymentController declares
 * `POST :reservationId`; if it is registered first, Nest matches
 * `POST /payments/webhook` as `reservationId = "webhook"` — a `@Roles(CLIENT)`
 * route — and Stripe receives 401. The `@Public()` decorator on the webhook is
 * never consulted, and ParseUUIDPipe never runs because guards come first.
 *
 * The symptom is nasty: payments still settled, because the checkout modal polls
 * `/payments/:id/status`, which reconciles against Stripe directly. So the app
 * looked healthy while every webhook delivery failed.
 */
describe('PaymentModule — ordem das rotas', () => {
  const controllers = Reflect.getMetadata('controllers', PaymentModule) as unknown[];

  it('registra o webhook antes da rota com parâmetro', () => {
    const webhookIndex = controllers.indexOf(StripeWebhookController);
    const paymentIndex = controllers.indexOf(PaymentController);

    expect(webhookIndex).toBeGreaterThanOrEqual(0);
    expect(paymentIndex).toBeGreaterThanOrEqual(0);
    expect(webhookIndex).toBeLessThan(paymentIndex);
  });

  it('o webhook continua marcado como público', () => {
    const isPublic = Reflect.getMetadata(
      'isPublic',
      StripeWebhookController.prototype.handleWebhook,
    );

    expect(isPublic).toBe(true);
  });

  it('a rota de criação de pagamento continua sendo só do cliente', () => {
    const roles = Reflect.getMetadata('roles', PaymentController.prototype.createPayment);

    expect(roles).toEqual(['client']);
  });
});
