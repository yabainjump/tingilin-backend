import { IsIn, IsString } from 'class-validator';

export class UpdateWinnerStatusDto {
  @IsString()
  @IsIn([
    'PENDING_VERIFICATION',
    'VERIFIED',
    'IN_SHIPPING',
    'DELIVERED',
  ])
  status!: 'PENDING_VERIFICATION' | 'VERIFIED' | 'IN_SHIPPING' | 'DELIVERED';
}
