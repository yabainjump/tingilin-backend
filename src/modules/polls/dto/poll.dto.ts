import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsMongoId,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// Images servies par l'API elle-meme seulement (upload admin existant): pas
// d'URL externe arbitraire affichee aux joueurs.
export const POLL_IMAGE_PATH = /^\/uploads\/products\/[A-Za-z0-9._-]+\.(webp|png|jpe?g|gif)$/;

export class PollOptionInputDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;

  @IsOptional()
  @IsString()
  @Matches(POLL_IMAGE_PATH, { message: 'imageUrl must be an uploaded image path' })
  imageUrl?: string;
}

export class CreatePollDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(140)
  question!: string;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => PollOptionInputDto)
  options!: PollOptionInputDto[];

  @IsOptional()
  @IsDateString()
  endsAt?: string;
}

export class VotePollDto {
  @IsMongoId()
  optionId!: string;
}
