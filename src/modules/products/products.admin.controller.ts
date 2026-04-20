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
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  adminList() {
    return this.productsService.adminListAll();
  }

  @Get(':id')
  adminGet(@Param('id') id: string) {
    return this.productsService.adminGetById(id);
  }

  @Post()
  create(@Body() dto: CreateProductDto, @Req() req: any) {
    return this.productsService.create(dto, req.user.sub);
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
  async uploadImage(@UploadedFile() file?: any) {
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

    return {
      ok: true,
      imageUrl,
    };
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  archive(@Param('id') id: string) {
    return this.productsService.archive(id);
  }
}
