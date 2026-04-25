import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { Product, ProductSchema } from './schemas/product.schema';
import { ProductsAdminController } from './products.admin.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    AuditModule,
    MongooseModule.forFeature([{ name: Product.name, schema: ProductSchema }]),
  ],
  controllers: [ProductsController, ProductsAdminController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
