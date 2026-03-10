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
import { diskStorage } from 'multer';
import { mkdirSync } from 'fs';
import { extname, join } from 'path';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

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
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const destination = join(process.cwd(), 'uploads', 'products');
          mkdirSync(destination, { recursive: true });
          cb(null, destination);
        },
        filename: (_req, file, cb) => {
          const safeExt = extname(file.originalname || '').toLowerCase() || '.jpg';
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `product-${unique}${safeExt}`);
        },
      }),
      limits: { fileSize: 8 * 1024 * 1024 },
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
  uploadImage(@UploadedFile() file?: any) {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    return {
      ok: true,
      imageUrl: `/uploads/products/${file.filename}`,
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
