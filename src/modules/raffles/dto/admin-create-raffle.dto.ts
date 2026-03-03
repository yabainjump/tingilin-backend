import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class AdminCreateProductDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  imageUrl: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  realValue?: number;
}

export class AdminCreateRafflePayloadDto {
  @IsNumber()
  @Min(0)
  ticketPrice: number;

  
  @IsNumber()
  @IsOptional()
  @Min(1)
  totalTickets?: number;

  @IsString()
  @IsOptional()
  currency?: string; 

  @IsString()
  @IsOptional()
  rules?: string;

  @IsDateString()
  @IsOptional()
  startAt?: string;

  @IsDateString()
  endAt: string;

  @IsString()
  @IsOptional()
  badge?: string;
}

export class AdminCreateRaffleDto {
  @ValidateNested()
  @Type(() => AdminCreateProductDto)
  product: AdminCreateProductDto;

  @ValidateNested()
  @Type(() => AdminCreateRafflePayloadDto)
  raffle: AdminCreateRafflePayloadDto;

  @IsBoolean()
  @IsOptional()
  publishNow?: boolean; 
}
