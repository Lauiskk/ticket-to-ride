import { IsString, IsArray, IsUUID, ArrayMinSize } from 'class-validator';

export class CreateReservationDto {
  @IsUUID()
  eventId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  seatIds: string[];
}
