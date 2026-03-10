import { Body, Controller, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';

@Controller('auth/setup')
export class AuthSetupController {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  @Post('promote-admin')
  async promoteAdmin(@Body() body: { setupKey: string; email: string }) {
    const setupEnabled =
      String(this.config.get<string>('SETUP_ENABLED', 'false'))
        .trim()
        .toLowerCase() === 'true';

    if (!setupEnabled) {
      return { ok: false, message: 'Setup endpoint disabled' };
    }

    const expected = this.config.get<string>('SETUP_KEY');
    if (!expected || body.setupKey !== expected) {
      return { ok: false, message: 'Invalid setup key' };
    }

    const user = await this.usersService.findByEmail(body.email);
    if (!user) return { ok: false, message: 'User not found' };

    await this.usersService.updateRole(user._id.toString(), 'ADMIN');
    return { ok: true, email: user.email, role: 'ADMIN' };
  }
}
