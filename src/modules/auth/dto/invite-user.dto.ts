import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class InviteUserDto {
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

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  @IsIn(['USER', 'ADMIN', 'MODERATOR'])
  role?: 'USER' | 'ADMIN' | 'MODERATOR';
}
