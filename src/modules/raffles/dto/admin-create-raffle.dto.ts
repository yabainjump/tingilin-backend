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

  // Tu as dit: photo / import => côté API on reçoit une URL (upload géré ailleurs) ou base64 si tu veux.
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

  // optionnel (si ton schema l’a)
  @IsNumber()
  @IsOptional()
  @Min(1)
  totalTickets?: number;

  @IsString()
  @IsOptional()
  currency?: string; // XAF par défaut

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
  publishNow?: boolean; // default true
}
