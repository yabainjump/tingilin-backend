import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty({ message: 'currentPassword must not be empty' })
  currentPassword: string;

  // Politique identique à ResetPasswordDto : min 8 chars, 1 majuscule, 1 spécial.
  @ApiProperty({ minLength: 8 })
  @IsString()
  @IsNotEmpty({ message: 'newPassword must not be empty' })
  @MinLength(8)
  @Matches(/[A-Z]/, {
    message: 'newPassword must contain at least 1 uppercase letter',
  })
  @Matches(/[\W_]/, {
    message: 'newPassword must contain at least 1 special character',
  })
  newPassword: string;
}
