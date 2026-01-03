import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UsersService } from './users.service';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin/users')
export class UsersAdminController {
  constructor(private readonly usersService: UsersService) {}

  @Patch(':id/role')
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    const user = await this.usersService.updateRole(id, dto.role);
    return { id: user?._id?.toString(), email: user?.email, role: user?.role };
  }
}
