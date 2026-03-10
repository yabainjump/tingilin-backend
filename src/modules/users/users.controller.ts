import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: any) {
    const userId = req.user?.sub; 
    const user = await this.usersService.findById(userId);
    return this.usersService.toPublic(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  async updateMe(@Req() req: any, @Body() dto: UpdateMeDto) {
    const userId = req.user?.sub;
    const user = await this.usersService.updateMe(userId, dto);
    return this.usersService.toPublic(user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me/avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const destination = join(process.cwd(), 'uploads', 'avatars');
          mkdirSync(destination, { recursive: true });
          cb(null, destination);
        },
        filename: (req: any, file, cb) => {
          const safeExt = extname(file.originalname || '').toLowerCase() || '.jpg';
          const userId = String(req.user?.sub ?? 'user').replace(/[^a-zA-Z0-9_-]/g, '');
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${userId}-${unique}${safeExt}`);
        },
      }),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        const mime = String(file.mimetype ?? '').toLowerCase();
        if (!mime.startsWith('image/')) {
          cb(new BadRequestException('Only image files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadAvatar(@Req() req: any, @UploadedFile() file?: any) {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }

    const avatarPath = `/uploads/avatars/${file.filename}`;
    const user = await this.usersService.updateMe(req.user?.sub, {
      avatar: avatarPath,
    });
    return this.usersService.toPublic(user);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/stats')
  stats(@Req() req: any) {
    return this.usersService.getMyStats(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/history')
  history(@Req() req: any, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? '5', 10) || 5, 1), 50);
    return this.usersService.getMyHistory(req.user.sub, n);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/referral-summary')
  referralSummary(@Req() req: any) {
    return this.usersService.getReferralSummary(req.user.sub);
  }
}
