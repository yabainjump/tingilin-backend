import { IsMongoId, IsString } from 'class-validator';

export class MockFailDto {
  @IsMongoId()
  transactionId: string;

  @IsString()
  reason: string;
}
