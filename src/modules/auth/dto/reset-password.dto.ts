import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @IsOptional()
  @IsString()
  identifier?: string;

  @IsOptional()
  @IsString()
  phoneOrEmail?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(4)
  code!: string;

  // Aligne la politique de reset sur celle de l'inscription (RegisterDto).
  @IsString()
  @MinLength(8)
  @Matches(/[A-Z]/, {
    message: 'password must contain at least 1 uppercase letter',
  })
  @Matches(/[\W_]/, {
    message: 'password must contain at least 1 special character',
  })
  newPassword!: string;
}
