import {
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
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

  
  @IsOptional() @IsString() userEmail?: string;
  @IsOptional() @IsString() userPhone?: string;
  @IsOptional() @IsString() userCountry?: string;
  @IsOptional() @IsString() senderName?: string;
}
