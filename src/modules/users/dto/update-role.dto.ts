import { IsIn, IsString } from 'class-validator';

export class UpdateRoleDto {
  @IsString()
  @IsIn(['USER', 'ADMIN', 'MODERATOR'])
  role: 'USER' | 'ADMIN' | 'MODERATOR';
}
