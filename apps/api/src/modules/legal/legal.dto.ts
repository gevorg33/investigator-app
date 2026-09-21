import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Length } from 'class-validator';

/** Accepting documents by id, so the record says which exact version and locale was shown. */
export class AcceptDocumentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Length(36, 36, { each: true })
  acceptedDocumentIds!: string[];
}
