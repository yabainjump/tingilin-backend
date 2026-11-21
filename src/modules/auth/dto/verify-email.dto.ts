import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ description: 'Jeton recu dans le lien de verification' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'Lien invalide ou expiré' })
  token!: string;
}
