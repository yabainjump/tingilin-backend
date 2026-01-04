import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateRaffleDto {
  @IsString()
  productId: string;

  @IsNumber()
  @Min(0)
  ticketPrice: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  @IsOptional()
  @IsString()
  rules?: string;
}
