import { Controller, Post, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { SharingService, SharePreview } from './sharing.service';
import { Roles } from '../shared/decorators/roles.decorator';
import { Public } from '../shared/decorators/public.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { UserRole } from '../user/entities/user.entity';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

/**
 * Sharing endpoints — Client-only (Organizers blocked per Req 3.7).
 */
@Controller('sharing')
export class SharingController {
  constructor(private readonly sharingService: SharingService) {}

  /**
   * Generate a sharing link for a ticket.
   * Link does NOT lock the ticket (Req 10.6).
   */
  @Roles(UserRole.CLIENT)
  @Post('tickets/:ticketId/share')
  async generateLink(
    @CurrentUser() user: JwtPayload,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ) {
    return this.sharingService.generateLink(ticketId, user.sub);
  }

  /**
   * O que este link oferece (SPEC_CP22 RF-2).
   *
   * Público de propósito: quem recebeu o link ainda pode não ter conta, e
   * precisa ver de que evento e assento se trata antes de decidir criar uma.
   * Não consome o link e não devolve dado de pessoa nenhuma.
   */
  @Public()
  @Get(':token')
  async preview(@Param('token') token: string): Promise<SharePreview> {
    return this.sharingService.preview(token);
  }

  /**
   * Accept a sharing link and transfer ticket ownership.
   * Recipient must be authenticated.
   */
  @Roles(UserRole.CLIENT)
  @Post(':token/accept')
  async acceptTransfer(
    @CurrentUser() user: JwtPayload,
    @Param('token') token: string,
  ) {
    return this.sharingService.acceptTransfer(token, user.sub);
  }
}
