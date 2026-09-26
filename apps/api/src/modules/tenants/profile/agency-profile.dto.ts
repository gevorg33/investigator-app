import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/**
 * The version a change was made against: the one read, 0 for a profile never saved. Two members
 * changing the profile at once cannot silently overwrite each other.
 */
export class ProfileVersionDto {
  @IsInt()
  @Min(0)
  version!: number;
}

/**
 * A change to the agency's public profile (T-084). An absent field is left alone; null clears it.
 * Lengths are bounded loosely here and exactly, after trimming, by the service.
 *
 * Nothing here says whether the profile is published — that is its own action — or which agency it
 * is: the workspace is the request's.
 */
export class UpdateAgencyProfileDto extends ProfileVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  displayName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  headline?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  about?: string | null;

  /** One of this agency's own AGENCY_LOGO uploads (`POST /media/uploads`). */
  @IsOptional()
  @IsUUID()
  logoMediaId?: string | null;

  /** One of this agency's own AGENCY_COVER uploads. */
  @IsOptional()
  @IsUUID()
  coverMediaId?: string | null;
}
