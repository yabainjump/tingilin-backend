import { Equals, IsIn, IsInt, Max, Min } from 'class-validator';
import {
  SPENDING_LIMIT_MAX_AMOUNT,
  SPENDING_LIMIT_MIN_AMOUNT,
  SPENDING_PERIODS,
} from '../spending-limit';

export class SetSpendingLimitDto {
  @IsIn(SPENDING_PERIODS as unknown as string[])
  period!: (typeof SPENDING_PERIODS)[number];

  @IsInt()
  @Min(SPENDING_LIMIT_MIN_AMOUNT)
  @Max(SPENDING_LIMIT_MAX_AMOUNT)
  amount!: number;
}

export class ConfirmAdultDto {
  // Declaration explicite: aucune valeur par defaut ne vaut confirmation.
  @Equals(true)
  confirm!: boolean;
}
