import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class DigikuntzWebhookDto {
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
    description: 'Failure reason when the webhook reports an unsuccessful payment.',
  })
  @IsOptional()
  @IsString()
  failReason?: string;
}
