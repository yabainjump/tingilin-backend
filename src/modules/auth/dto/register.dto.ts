import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
  IsOptional,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsString()
  @Matches(/^\+\d{7,15}$/, {
    message: 'phone must be in E.164 format like +2376xxxxxxx',
  })
  phone!: string;

  @IsString()
  @MinLength(8)
  @Matches(/[A-Z]/, {
    message: 'password must contain at least 1 uppercase letter',
  })
  @Matches(/[\W_]/, {
    message: 'password must contain at least 1 special character',
  })
  password!: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsString()
  referralCode?: string;
}
