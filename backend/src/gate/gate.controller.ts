import { Controller, Post, Body } from '@nestjs/common';
import { GateService, ValidationResult } from './gate.service';
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

  @Roles(UserRole.GATE)
  @Post('validate')
  async validate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ValidateTicketDto,
  ): Promise<ValidationResult> {
    return this.gateService.validateTicket(dto.qrPayload, user.sub, dto.eventId);
  }
}
