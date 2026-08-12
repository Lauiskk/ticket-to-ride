import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { UserRole } from '../user/entities/user.entity';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

/**
 * Ticket endpoints — Client-only access.
 */
@Controller('tickets')
export class TicketController {
  constructor(private readonly ticketService: TicketService) {}

  @Roles(UserRole.CLIENT)
  @Get()
  async myTickets(@CurrentUser() user: JwtPayload) {
    return this.ticketService.getMyTickets(user.sub);
  }

  @Roles(UserRole.CLIENT)
  @Get(':id')
  async getTicket(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ticketService.getTicket(id, user.sub);
  }
}
