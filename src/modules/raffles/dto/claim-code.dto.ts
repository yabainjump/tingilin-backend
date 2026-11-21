import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ClaimCodeDto {
  @ApiProperty({ example: '123456', description: 'Code de retrait du gagnant' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Le code doit contenir 6 chiffres' })
  code!: string;
}
