import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product, ProductDocument } from './schemas/product.schema';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  // Public
  async listPublished() {
    return this.productModel
      .find({ status: 'PUBLISHED' })
      .sort({ createdAt: -1 })
      .exec();
  }

  async getPublishedById(id: string) {
    const p = await this.productModel
      .findOne({ _id: id, status: 'PUBLISHED' })
      .exec();
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  // Admin
  async create(dto: CreateProductDto, createdBy: string) {
    return this.productModel.create({
      ...dto,
      createdBy: new Types.ObjectId(createdBy),
      status: dto.status ?? 'DRAFT',
      description: dto.description ?? '',
      category: dto.category ?? 'general',
      marketValue: dto.marketValue ?? 0,
    });
  }

  async update(id: string, dto: UpdateProductDto) {
    const p = await this.productModel
      .findByIdAndUpdate(id, dto, { new: true })
      .exec();
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  async archive(id: string) {
    const p = await this.productModel
      .findByIdAndUpdate(id, { status: 'ARCHIVED' }, { new: true })
      .exec();
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  async adminGetById(id: string) {
    const p = await this.productModel.findById(id).exec();
    if (!p) throw new NotFoundException('Product not found');
    return p;
  }

  async adminListAll() {
    return this.productModel.find().sort({ createdAt: -1 }).exec();
  }
}
