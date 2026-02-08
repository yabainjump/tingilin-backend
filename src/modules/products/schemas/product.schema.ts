import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Document } from 'mongoose';

export type ProductDocument = HydratedDocument<Product>;
export type ProductStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

@Schema({ timestamps: true })
export class Product {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ default: '', trim: true })
  description: string;

  @Prop({ type: [String], default: [] })
  images: string[]; // on mettra mieux plus tard

  @Prop({ required: true })
  imageUrl: string;

  @Prop({ type: Number, default: 0 })
  marketValue: number;

  @Prop({ type: String, default: 'general', trim: true })
  category: string;

  @Prop({ type: String, default: 'DRAFT' })
  status: ProductStatus;

  @Prop({ default: 0 })
  realValue?: number;

  @Prop({ type: Types.ObjectId, required: true })
  createdBy: Types.ObjectId;

  @Prop({ required: true }) categoryId: string;
}

export const ProductSchema = SchemaFactory.createForClass(Product);
