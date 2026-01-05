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
  @Min(100)
  amount: number;

  @IsOptional()
  @IsString()
  @IsIn(['MOCK'])
  provider?: 'MOCK';
}
