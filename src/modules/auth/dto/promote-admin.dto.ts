import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';

export class PromoteAdminDto {
  @ApiProperty({
    example: 'setup-secret-key',
    description: 'Bootstrap key used to unlock the setup endpoint.',
  })
  @IsString()
  setupKey: string;

  @ApiProperty({
    example: 'admin@digikuntz.com',
    description: 'Email of the user that must be promoted as administrator.',
  })
  @IsEmail()
  email: string;
}
