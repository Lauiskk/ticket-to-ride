import { Controller, Post, Get, Body } from '@nestjs/common';
import { GateService, ValidationResult, GateEventSummary } from './gate.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { UserRole } from '../user/entities/user.entity';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { IsString, IsUUID } from 'class-validator';

class ValidateTicketDto {
  @IsString()
  qrPayload: string;

  @IsUUID()
  eventId: string;
}

/**
 * Gate validation endpoint — Gate role only (Req 3.3).
 *
 * Accepts QR payload (from camera scan or manual input)
 * and returns validation result.
 */
@Controller('gate')
export class GateController {
  constructor(private readonly gateService: GateService) {}

  /**
   * The gate's own event list (SPEC_CP11 RF-4) — operational data only:
   * what is open for entry now and how many people already came in.
   * Never buyer data: the gate checks tickets, not people.
   */
  @Roles(UserRole.GATE)
  @Get('events')
  async events(): Promise<GateEventSummary[]> {
    return this.gateService.listEventsForGate();
  }

  @Roles(UserRole.GATE)
  @Post('validate')
  async validate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ValidateTicketDto,
  ): Promise<ValidationResult> {
    return this.gateService.validateTicket(dto.qrPayload, user.sub, dto.eventId);
  }
}
