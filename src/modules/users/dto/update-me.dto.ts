import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CAMEROON_REGIONS } from '../../../common/regions';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  @Matches(/^\+?[0-9][0-9\s-]{5,18}[0-9]$/)
  phone?: string;

  @IsOptional()
  @IsIn(CAMEROON_REGIONS as unknown as string[])
  region?: string;
}
