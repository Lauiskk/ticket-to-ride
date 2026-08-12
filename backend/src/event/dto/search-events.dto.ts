import { IsOptional, IsString, IsNumber, IsDateString, Min, Max, MaxLength, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum SortBy {
  DATE_ASC = 'date_asc',
  DATE_DESC = 'date_desc',
  PRICE_ASC = 'price_asc',
  PRICE_DESC = 'price_desc',
  RELEVANCE = 'relevance',
}

export class SearchEventsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  keyword?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMin?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Max(999999.99)
  priceMax?: number;

  @IsOptional()
  @IsString()
  city?: string;

  // Geo-proximity
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(500)
  radius?: number;

  // Pagination
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize?: number;

  // Sort
  @IsOptional()
  @IsEnum(SortBy)
  sortBy?: SortBy;
}
