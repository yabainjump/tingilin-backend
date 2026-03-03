import { IsMongoId } from 'class-validator';

export class DigikuntzVerifyDto {
  @IsMongoId()
  transactionId: string; 
}
