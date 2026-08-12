import { Controller, Get, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Roles } from '../../shared/decorators/roles.decorator';
import { UserRole } from '../../user/entities/user.entity';
import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

class SearchCatalogDto {
  @IsString()
  query: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;

  @IsOptional()
  @IsString()
  source?: 'ticketmaster' | 'tmdb' | 'all';
}

/**
 * Catalog search endpoint — Organizer only.
 *
 * Allows Organizers to search external catalogs (Ticketmaster, TMDb)
 * to find events/movies to base their event creation on.
 */
@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Roles(UserRole.ORGANIZER)
  @Get('search')
  async search(@Query() dto: SearchCatalogDto) {
    const page = dto.page || 0;
    const source = dto.source || 'all';

    switch (source) {
      case 'ticketmaster':
        return this.catalogService.searchTicketmaster(dto.query, page);
      case 'tmdb':
        return this.catalogService.searchTmdb(dto.query, page + 1);
      case 'all':
      default:
        return this.catalogService.searchAll(dto.query, page);
    }
  }
}
