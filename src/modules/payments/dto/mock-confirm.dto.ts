import { IsMongoId, IsString } from 'class-validator';

export class MockConfirmDto {
  @IsMongoId()
  transactionId: string;

  @IsString()
  providerRef: string;
}
