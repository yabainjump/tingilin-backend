import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from '../audit/audit.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';
import { storeOptimizedImageFromBuffer } from '../../common/uploads/image-storage';

@ApiTags('Products Admin')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin/products')
export class ProductsAdminController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  adminList() {
    return this.productsService.adminListAll();
  }

  @Get(':id')
  adminGet(@Param('id') id: string) {
    return this.productsService.adminGetById(id);
  }

  @Post()
  async create(@Body() dto: CreateProductDto, @Req() req: any) {
    try {
      const product = await this.productsService.create(dto, req.user.sub);
      await this.auditService.safeLog({
        action: 'ADMIN_PRODUCT_CREATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'PRODUCT',
        targetId: String(product?._id ?? ''),
        metadata: {
          title: dto.title,
          category: dto.category,
          status: dto.status ?? 'DRAFT',
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return product;
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_PRODUCT_CREATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'PRODUCT',
        targetId: String(dto?.title ?? ''),
        status: 'FAILED',
        metadata: {
          title: dto?.title,
          category: dto?.category,
          error: error?.message ?? 'UNKNOWN',
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }

  @Post('upload-image')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Product image file to upload.',
        },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 6 * 1024 * 1024 },
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
  async uploadImage(@UploadedFile() file: any, @Req() req: any) {
    try {
      if (!file) {
        throw new BadRequestException('Image file is required');
      }

      const imageUrl = await storeOptimizedImageFromBuffer({
        buffer: file.buffer,
        mimeType: file.mimetype,
        kind: 'products',
        prefix: 'product',
        maxWidth: 1600,
        maxHeight: 1600,
        fit: 'inside',
        quality: 82,
      });

      await this.auditService.safeLog({
        action: 'ADMIN_PRODUCT_IMAGE_UPLOADED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'PRODUCT',
        targetId: imageUrl,
        metadata: {
          filename: String(file?.originalname ?? ''),
          mimeType: String(file?.mimetype ?? ''),
          size: Number(file?.size ?? 0),
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });

      return {
        ok: true,
        imageUrl,
      };
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_PRODUCT_IMAGE_UPLOADED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'PRODUCT',
        targetId: String(file?.originalname ?? ''),
        status: 'FAILED',
        metadata: {
          filename: String(file?.originalname ?? ''),
          mimeType: String(file?.mimetype ?? ''),
          error: error?.message ?? 'UNKNOWN',
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateProductDto, @Req() req: any) {
    try {
      const product = await this.productsService.update(id, dto);
      await this.auditService.safeLog({
        action: 'ADMIN_PRODUCT_UPDATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'PRODUCT',
        targetId: id,
        metadata: {
          fields: Object.keys(dto ?? {}),
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return product;
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_PRODUCT_UPDATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'PRODUCT',
        targetId: id,
        status: 'FAILED',
        metadata: {
          fields: Object.keys(dto ?? {}),
          error: error?.message ?? 'UNKNOWN',
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }

  @Delete(':id')
  async archive(@Param('id') id: string, @Req() req: any) {
    try {
      const product = await this.productsService.archive(id);
      await this.auditService.safeLog({
        action: 'ADMIN_PRODUCT_ARCHIVED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'PRODUCT',
        targetId: id,
        metadata: {
          status: product?.status,
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return product;
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_PRODUCT_ARCHIVED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'PRODUCT',
        targetId: id,
        status: 'FAILED',
        metadata: {
          error: error?.message ?? 'UNKNOWN',
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }
}
