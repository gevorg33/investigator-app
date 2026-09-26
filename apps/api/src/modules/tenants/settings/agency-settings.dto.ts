import { IsInt, IsObject, Min } from 'class-validator';

/**
 * A change to one settings section (T-084): the values to set — null puts one back to its
 * default — and the section's version as read, 0 for a section never saved. What each section
 * accepts is checked by the service, which refuses a key the section does not have.
 */
export class UpdateSettingsSectionDto {
  @IsInt()
  @Min(0)
  version!: number;

  @IsObject()
  values!: Record<string, unknown>;
}
