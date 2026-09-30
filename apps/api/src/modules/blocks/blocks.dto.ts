import { IsOptional, IsUUID } from 'class-validator';

/**
 * Whom to block, named by where the blocker is (T-052): an investigator's profile, a mission they
 * can see, or an assignment they are party to. Exactly one — the service says so if not. Never a
 * user id: nothing the application shows carries one, and a block must not be a way to test them.
 */
export class BlockDto {
  @IsOptional()
  @IsUUID()
  investigatorProfileId?: string;

  @IsOptional()
  @IsUUID()
  missionId?: string;

  @IsOptional()
  @IsUUID()
  assignmentId?: string;
}
