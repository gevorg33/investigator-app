import { IsIn, IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import { MEDIA_CATEGORIES, type MediaCategory } from './media.policy';

export class AuthorizeUploadDto {
  @IsIn(MEDIA_CATEGORIES)
  category!: MediaCategory;

  // Checked against the category's allowlist by the service. Bounded here so an arbitrary
  // string never reaches it.
  @IsString()
  @MaxLength(100)
  mimeType!: string;

  // The client's claim. The size Cloudinary actually holds is what gets enforced, at completion.
  @IsInt()
  @Min(1)
  @Max(1024 * 1024 * 1024)
  bytes!: number;
}
