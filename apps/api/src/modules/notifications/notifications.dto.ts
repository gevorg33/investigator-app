import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ListNotificationsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;
}

/** One choice: a category, a channel, on or off (T-036). In-app is always on, so not a channel here. */
export class SetPreferenceDto {
  @IsIn(['activity'])
  category!: 'activity';

  @IsIn(['email'])
  channel!: 'email';

  @IsBoolean()
  enabled!: boolean;
}
