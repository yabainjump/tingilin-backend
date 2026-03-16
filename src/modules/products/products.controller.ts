import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProductsService } from './products.service';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  list() {
    return this.productsService.listPublished();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.productsService.getPublishedById(id);
  }
}
