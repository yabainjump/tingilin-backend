import {
  IsBoolean,
  IsIn,
  IsJWT,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CAMEROON_REGIONS } from '../../../common/regions';

export class GoogleAuthDto {
  @IsJWT()
  @MaxLength(4096)
  idToken!: string;

  @IsOptional()
  @IsIn(CAMEROON_REGIONS as unknown as string[])
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  referralCode?: string;

  // Optionnel: un compte Google cree sans cette declaration devra confirmer
  // ses 18 ans avant son premier achat.
  @IsOptional()
  @IsBoolean()
  isAdult?: boolean;
}
