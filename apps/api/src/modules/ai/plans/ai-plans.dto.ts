import { IsIn, IsOptional, Matches } from 'class-validator';

export class ListPlansQuery {
  /** `true` lists only plans still waiting for an answer, unexpired — what a returning client shows. */
  @IsOptional()
  @IsIn(['true', 'false'])
  open?: 'true' | 'false';
}

export class ConfirmPlanDto {
  /** The hash of the plan as the client showed it. A plan that is not exactly that is not confirmed. */
  @Matches(/^[0-9a-f]{64}$/)
  planHash!: string;
}
