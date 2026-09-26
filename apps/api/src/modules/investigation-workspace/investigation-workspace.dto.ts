import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { investigationTaskStatus, investigationVisibility } from '../../database/schema';

const VISIBILITIES = investigationVisibility.enumValues;
const STATUSES = investigationTaskStatus.enumValues;
type Visibility = (typeof VISIBILITIES)[number];

/** A note. Private — its author alone — unless `visibility` says SHARED. */
export class CreateNoteDto {
  @IsString()
  @Length(1, 20000)
  body!: string;

  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: Visibility;
}

/** Any subset. The assignment and the author do not change. */
export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @Length(1, 20000)
  body?: string;

  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: Visibility;
}

/** A task. Private and still to do; placed after the creator's others unless `position` says. */
export class CreateTaskDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  /** A calendar day, `YYYY-MM-DD`. */
  @IsOptional()
  @IsISO8601({ strict: true })
  @Length(10, 10)
  dueOn?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  position?: number;

  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: Visibility;
}

/**
 * Any subset of a task's own fields; `null` clears the description or the due date. **No status**:
 * a task moves only through `POST .../transition`, and the validation pipe refuses a `status` here
 * as a field this shape does not declare.
 */
export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @ValidateIf((_, v: unknown) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @ValidateIf((_, v: unknown) => v !== undefined && v !== null)
  @IsISO8601({ strict: true })
  @Length(10, 10)
  dueOn?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  position?: number;

  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: Visibility;
}

/** Where the task should go next. Refused unless `task-transitions.ts` has the edge. */
export class TransitionTaskDto {
  @IsIn(STATUSES)
  to!: (typeof STATUSES)[number];
}
