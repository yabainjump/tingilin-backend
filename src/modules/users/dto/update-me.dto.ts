import { IsOptional, IsString, MinLength } from 'class-validator';

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
  phone?: string;

  // avatar = url ou filename (ex: "defpic.jpg" ou "https://...")
  @IsOptional()
  @IsString()
  avatar?: string;
}
