import { IsMongoId, IsString } from 'class-validator';

export class CreateFreeTicketDto {
  @IsString()
  @IsMongoId()
  raffleId!: string;
}
