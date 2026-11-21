import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches } from 'class-validator';
import { DEVICE_PLATFORMS } from '../schemas/device-token.schema';
import type { DevicePlatform } from '../schemas/device-token.schema';

/** Format d'un jeton FCM (lettres, chiffres, : _ -), longueur bornee. */
export const PUSH_TOKEN_PATTERN = /^[A-Za-z0-9:_-]{32,4096}$/;

export class RegisterDeviceDto {
  @ApiProperty()
  @IsString()
  @Matches(PUSH_TOKEN_PATTERN, { message: 'Invalid push token' })
  token!: string;

  @ApiProperty({ enum: DEVICE_PLATFORMS })
  @IsIn(DEVICE_PLATFORMS)
  platform!: DevicePlatform;
}

export class UnregisterDeviceDto {
  @ApiProperty()
  @IsString()
  @Matches(PUSH_TOKEN_PATTERN, { message: 'Invalid push token' })
  token!: string;
}
