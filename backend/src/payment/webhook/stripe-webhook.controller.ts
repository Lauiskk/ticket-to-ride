import {
  Controller,
  Post,
  Req,
  Res,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PaymentService } from '../payment.service';
import { Public } from '../../shared/decorators/public.decorator';
import { SkipCsrf } from '../../shared/decorators/skip-csrf.decorator';

/**
 * Stripe webhook endpoint (Req 8.4).
 *
 * Key behaviors:
 * - @Public() — no JWT auth (Stripe calls this directly)
 * - Validates webhook signature before processing (Req 8.4)
 * - Invalid signature → 400 (Req 8.4 / design)
 * - Duplicate webhook → 200 idempotent (Req 8.5)
 * - Processing failure → 500 (Stripe will retry)
 *
 * IMPORTANT: This endpoint needs raw body for signature verification.
 * Configure in main.ts: app.use('/payments/webhook', express.raw({type: 'application/json'}))
 */
@Controller('payments')
export class StripeWebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  @Public()
  // Quem chama é a Stripe, não um navegador: não há cookie de CSRF para
  // apresentar, e a credencial dela é a assinatura conferida logo abaixo.
  @SkipCsrf()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    // Verify signature (Req 8.4)
    const rawBody = (req as any).rawBody || req.body;
    const event = this.paymentService.verifyWebhookSignature(
      Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(JSON.stringify(rawBody)),
      signature,
    );

    if (!event) {
      res.status(HttpStatus.BAD_REQUEST);
      return { received: false };
    }

    // Handle relevant events
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as { id: string };
        await this.paymentService.handlePaymentSuccess(paymentIntent.id);
        break;
      }
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as { id: string };
        await this.paymentService.handlePaymentFailure(paymentIntent.id);
        break;
      }
      default:
        // Acknowledge but don't process unhandled event types
        break;
    }

    return { received: true };
  }
}
