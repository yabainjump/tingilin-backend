import {
  IsEmail,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateIntentDto {
  @IsMongoId()
  raffleId: string;

  @IsInt()
  @Min(10)
  amount: number;

  @IsOptional()
  @IsIn(['MOCK', 'DIGIKUNTZ'])
  provider?: 'MOCK' | 'DIGIKUNTZ';

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  userEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  userPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userCountry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  senderName?: string;

  @IsOptional()
  @IsIn(['ORANGE', 'MTN'])
  paymentMethodCode?: 'ORANGE' | 'MTN';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  idempotencyKey?: string;
}
