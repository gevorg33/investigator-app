import { IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

/** Each refusal its own message (T-157); each key written out whole for the catalog check. */
const NAME_LENGTH = 'error.validation.teams.name_length';
const DESCRIPTION_LENGTH = 'error.validation.teams.description_length';

/** A new team: what it is called, and what it is for. Which agency is the request's. */
export class CreateTeamDto {
  @IsString({ message: NAME_LENGTH })
  @Length(1, 80, { message: NAME_LENGTH })
  name!: string;

  @IsOptional()
  @IsString({ message: DESCRIPTION_LENGTH })
  @Length(1, 500, { message: DESCRIPTION_LENGTH })
  description?: string;
}

/** A change to a team. Absent is left alone; a null description clears it. */
export class UpdateTeamDto {
  @IsOptional()
  @IsString({ message: NAME_LENGTH })
  @Length(1, 80, { message: NAME_LENGTH })
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString({ message: DESCRIPTION_LENGTH })
  @Length(1, 500, { message: DESCRIPTION_LENGTH })
  description?: string | null;
}

/** Someone to put in a team: a member of this agency, by their membership. */
export class AddTeamMemberDto {
  @IsUUID('all', { message: 'error.validation.teams.member_unknown' })
  membershipId!: string;
}
