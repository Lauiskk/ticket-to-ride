import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { EventService } from './event.service';
import { CreateEventDto } from './dto/create-event.dto';
import { SearchEventsDto } from './dto/search-events.dto';
import { Public } from '../shared/decorators/public.decorator';
import { Roles } from '../shared/decorators/roles.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { UserRole } from '../user/entities/user.entity';
import { JwtPayload } from '../auth/strategies/jwt.strategy';

/**
 * Event endpoints.
 *
 * Public: browse, get by ID
 * Organizer: create, publish, cancel, my events
 */
@Controller('events')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  // ─── Public endpoints ───────────────────────────────────────────────────────

  @Public()
  @Get()
  async browse(@Query() dto: SearchEventsDto) {
    return this.eventService.browse(dto);
  }

  @Public()
  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventService.getById(id);
  }

  // ─── Organizer endpoints ────────────────────────────────────────────────────

  @Roles(UserRole.ORGANIZER)
  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateEventDto,
  ) {
    return this.eventService.create(user.sub, dto);
  }

  @Roles(UserRole.ORGANIZER)
  @Patch(':id/publish')
  async publish(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.eventService.publish(id, user.sub);
  }

  @Roles(UserRole.ORGANIZER)
  @Patch(':id/cancel')
  async cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.eventService.cancel(id, user.sub);
  }

  @Roles(UserRole.ORGANIZER)
  @Get('my/list')
  async myEvents(@CurrentUser() user: JwtPayload) {
    return this.eventService.getMyEvents(user.sub);
  }
}
