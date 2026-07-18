import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { RaffleStatus } from '../schemas/raffle.schema';

export class UpdateRaffleDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  ticketPrice?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsString()
  rules?: string;

  @IsOptional()
  @IsEnum(RaffleStatus)
  status?: RaffleStatus;
}
