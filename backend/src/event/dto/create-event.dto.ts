import {
  IsString,
  IsDateString,
  IsNumber,
  IsEnum,
  IsBoolean,
  IsOptional,
  IsObject,
  IsArray,
  ValidateNested,
  Min,
  Max,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SeatingType } from '../entities/event.entity';

export class SectionDefinition {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @IsNumber()
  @Min(1)
  @Max(500)
  rows: number;

  @IsNumber()
  @Min(1)
  @Max(100)
  seatsPerRow: number;
}

export class GeneralAdmissionSector {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @IsNumber()
  @Min(1)
  capacity: number;
}

export class CreateEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description: string;

  @IsDateString()
  date: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  venueName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  venueAddress: string;

  @IsOptional()
  @IsNumber()
  venueLat?: number;

  @IsOptional()
  @IsNumber()
  venueLng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  venueCity?: string;

  @IsNumber()
  @Min(1)
  @Max(100000)
  capacity: number;

  @IsEnum(SeatingType)
  seatingType: SeatingType;

  @IsNumber()
  @Min(0)
  @Max(999999.99)
  price: number;

  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency: string;

  // Numbered seating: sections definition
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SectionDefinition)
  sections?: SectionDefinition[];

  // General admission: sectors
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GeneralAdmissionSector)
  sectors?: GeneralAdmissionSector[];

  /**
   * Half-price tickets (SPEC_CP12 RF-8). Defaults to enabled — in Brazil it is
   * a legal obligation (Lei 12.933/2013), not an opt-in feature.
   */
  @IsOptional()
  @IsBoolean()
  halfPriceEnabled?: boolean;

  /** Cap on half-price tickets. Omit or null for no cap. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  halfPriceQuota?: number | null;

  // External catalog reference
  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  externalSource?: string;
}
