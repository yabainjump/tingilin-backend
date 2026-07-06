import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

export class DigikuntzWebhookDataDto {
  @ApiPropertyOptional({ example: 'IN123#250101120000' })
  @IsOptional()
  @IsString()
  transactionRef?: string;

  [key: string]: unknown;
}

export class DigikuntzWebhookDto {
  @ApiPropertyOptional({
    example: '664f1a2b3c4d5e6f7a8b9c0d',
    description: 'Digikuntz transaction identifier.',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({
    example: 'txn_12345',
    description: 'Internal transaction identifier.',
  })
  @IsOptional()
  @IsString()
  transactionId?: string;

  @ApiPropertyOptional({
    example: 'provider_txn_987',
    description: 'Transaction identifier returned by the payment provider.',
  })
  @IsOptional()
  @IsString()
  providerTransactionId?: string;

  @ApiPropertyOptional({
    example: 'DIGI-REF-20260316',
    description: 'Provider reference associated with the payment event.',
  })
  @IsOptional()
  @IsString()
  providerRef?: string;

  @ApiPropertyOptional({
    example: 'SUCCESS',
    description: 'Normalized payment status sent by the provider.',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    example: 'INSUFFICIENT_FUNDS',
    description:
      'Failure reason when the webhook reports an unsuccessful payment.',
  })
  @IsOptional()
  @IsString()
  failReason?: string;

  @ApiPropertyOptional({ type: DigikuntzWebhookDataDto })
  @IsOptional()
  @IsObject()
  data?: DigikuntzWebhookDataDto;
}
