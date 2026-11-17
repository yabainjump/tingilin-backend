import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { ConfirmAdultDto, SetSpendingLimitDto } from './dto/spending-limit.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import {
  removeStoredImage,
  storeOptimizedImageFromBuffer,
} from '../../common/uploads/image-storage';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@Controller('users')
export class UsersController {
  private readonly logger = new Logger(UsersController.name);

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
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Avatar image file to upload.',
        },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 4 * 1024 * 1024 },
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

    const avatarPath = await storeOptimizedImageFromBuffer({
      buffer: file.buffer,
      mimeType: file.mimetype,
      kind: 'avatars',
      prefix: String(req.user?.sub ?? 'user'),
      maxWidth: 512,
      maxHeight: 512,
      fit: 'cover',
      quality: 78,
    });
    let replacement: { user: any; previousAvatar: string };
    try {
      replacement = await this.usersService.replaceAvatar(
        req.user?.sub,
        avatarPath,
      );
    } catch (error) {
      await removeStoredImage(avatarPath, 'avatars').catch(() => false);
      throw error;
    }

    await removeStoredImage(replacement.previousAvatar, 'avatars').catch(
      (error: unknown) => {
        this.logger.warn(`Previous avatar cleanup failed: ${String(error)}`);
      },
    );
    return this.usersService.toPublic(replacement.user);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/confirm-adult')
  @HttpCode(200)
  confirmAdult(@Req() req: any, @Body() dto: ConfirmAdultDto) {
    // Le DTO impose deja confirm === true; double garde si le pipe change.
    if (dto?.confirm !== true) {
      throw new BadRequestException('Confirmation requise');
    }
    return this.usersService.confirmAdult(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/spending-limit')
  spendingLimit(@Req() req: any) {
    return this.usersService.getSpendingLimitStatus(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Put('me/spending-limit')
  setSpendingLimit(@Req() req: any, @Body() dto: SetSpendingLimitDto) {
    return this.usersService.setSpendingLimit(req.user.sub, {
      period: dto.period,
      amount: dto.amount,
    });
  }

  // Supprimer la limite = assouplissement: applique apres le delai de reflexion.
  @UseGuards(JwtAuthGuard)
  @Delete('me/spending-limit')
  removeSpendingLimit(@Req() req: any) {
    return this.usersService.setSpendingLimit(req.user.sub, null);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('me/spending-limit/pending')
  cancelPendingSpendingLimit(@Req() req: any) {
    return this.usersService.cancelPendingSpendingLimit(req.user.sub);
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

  @UseGuards(JwtAuthGuard)
  @Get('me/referrals')
  referrals(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedPage = Math.max(parseInt(page ?? '1', 10) || 1, 1);
    const parsedLimit = Math.min(
      Math.max(parseInt(limit ?? '10', 10) || 10, 1),
      50,
    );

    return this.usersService.getMyReferrals(
      req.user.sub,
      parsedPage,
      parsedLimit,
    );
  }
}
