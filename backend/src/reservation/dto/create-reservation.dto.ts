import {
  IsArray,
  IsUUID,
  ArrayMinSize,
  IsOptional,
  IsEnum,
  IsString,
  MinLength,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Half-price categories recognised by Lei 12.933/2013.
 * Kept as a closed set so the gate always knows what to ask for.
 */
export enum HalfPriceCategory {
  STUDENT = 'student',
  SENIOR = 'senior',
  PCD = 'pcd',
}

/**
 * One half-price claim (SPEC_CP12 RF-9).
 *
 * Note what is NOT here: a price. The client says which seats are half and who
 * the holder is; the server decides what that costs.
 */
export class HalfPriceClaimDto {
  @IsUUID()
  seatId: string;

  @IsEnum(HalfPriceCategory)
  category: HalfPriceCategory;

  /** Document number shown at the gate. Free text — formats vary by category. */
  @IsString()
  @MinLength(5)
  @MaxLength(40)
  document: string;
}

export class CreateReservationDto {
  @IsUUID()
  eventId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  seatIds: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HalfPriceClaimDto)
  halfPriceClaims?: HalfPriceClaimDto[];
}
