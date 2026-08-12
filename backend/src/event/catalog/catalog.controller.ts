import { Controller, Get, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { UserRole } from '../../user/entities/user.entity';
import { IsString, IsOptional, IsInt, Min, Max, IsIn, IsISO8601, Length } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Ticketmaster classifications we expose. Kept as a closed list so a typo in
 * the UI cannot silently return everything.
 */
const CLASSIFICATIONS = ['Music', 'Film', 'Arts & Theatre', 'Sports', 'Miscellaneous'] as const;

class SearchCatalogDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  query?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  page?: number;

  @IsOptional()
  @IsIn(['ticketmaster', 'tmdb', 'all', 'now-playing'])
  source?: 'ticketmaster' | 'tmdb' | 'all' | 'now-playing';

  @IsOptional()
  @IsString()
  @Length(2, 2)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  city?: string;

  @IsOptional()
  @IsIn(CLASSIFICATIONS as unknown as string[])
  classificationName?: string;

  @IsOptional()
  @IsISO8601()
  startDateTime?: string;
}

/**
 * External catalogue search — Organizer only (SPEC_CP13).
 *
 * Feeds the event wizard: the organizer finds a real show or a film currently
 * in cinemas, and the result pre-fills the form. It never creates an event by
 * itself — date, price and seating are the organizer's decisions.
 */
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Roles(UserRole.ORGANIZER)
  @Get('search')
  async search(@Query() dto: SearchCatalogDto) {
    const page = dto.page || 0;
    const filters = {
      query: dto.query,
      page,
      countryCode: dto.countryCode,
      city: dto.city,
      classificationName: dto.classificationName,
      startDateTime: dto.startDateTime,
    };

    switch (dto.source) {
      case 'now-playing':
        // No query needed — this is "what is in cinemas right now"
        return this.catalogService.nowPlaying(page);
      case 'ticketmaster':
        return this.catalogService.searchTicketmaster(filters);
      case 'tmdb':
        return this.catalogService.searchTmdb(filters);
      case 'all':
      default:
        return this.catalogService.searchAll(filters);
    }
  }

  /** Ticketmaster classifications offered in the wizard filter. */
  @Roles(UserRole.ORGANIZER)
  @Get('classifications')
  classifications(): string[] {
    return [...CLASSIFICATIONS];
  }
}
