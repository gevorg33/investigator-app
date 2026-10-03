import { IsString, IsUUID, Length, Matches } from 'class-validator';
import { Reasoned } from './taxonomy.dto';

/** The locale a caller reads tags in. English when absent, and for anything untranslated. */
export { TaxonomyReadQuery as TagReadQuery } from './taxonomy.dto';

export class CreateTagDto extends Reasoned {
  /** Permanent: lowercase words joined by hyphens. The database checks it too. */
  @IsString()
  @Length(2, 60)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  slug!: string;

  /** The English label, which every other locale falls back to. */
  @IsString()
  @Length(1, 60)
  @Matches(/\S/)
  label!: string;
}

export class SetTagLabelDto extends Reasoned {
  @IsString()
  @Length(1, 60)
  @Matches(/\S/)
  label!: string;
}

/** Retiring a tag: gone from every picker, still on the missions that carry it. */
export class DeprecateTagDto extends Reasoned {}

/** Merging a tag into another: the old one is retired, and its missions are found under the new. */
export class MergeTagDto extends Reasoned {
  @IsUUID()
  intoId!: string;
}
