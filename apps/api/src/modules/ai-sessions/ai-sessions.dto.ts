import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateSessionDto {
  /** Optional: a session is untitled until someone names it. */
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;
}

export class RenameSessionDto {
  @IsString()
  @Length(1, 120)
  title!: string;
}

export class ListSessionsQuery {
  /** `true` lists archived sessions instead of current ones. */
  @IsOptional()
  @IsIn(['true', 'false'])
  archived?: 'true' | 'false';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class SearchSessionsQuery {
  @IsString()
  @Length(2, 200)
  q!: string;
}

export class ListMessagesQuery {
  /** `newest`: from the end of the conversation backwards, newest first (T-057). */
  @IsOptional()
  @IsIn(['oldest', 'newest'])
  order?: 'oldest' | 'newest';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
