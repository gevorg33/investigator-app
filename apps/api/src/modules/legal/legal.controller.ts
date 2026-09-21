import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppError } from '../../common/errors/app-error';
import { legalDocuments } from '../../database/schema';
import { LegalService, type LegalDocumentType, type PublishedDocument } from './legal.service';

/** The response: the text itself, and what would be recorded if someone accepted it. */
export interface LegalDocumentResponse {
  type: LegalDocumentType;
  version: number;
  locale: string;
  title: string;
  content: string;
  contentHash: string;
  effectiveFrom: string;
  authoritative: boolean;
}

const TYPES = new Set<string>(legalDocuments.type.enumValues);

/**
 * Reading the terms (T-021).
 *
 * **Unauthenticated, deliberately.** Registration cannot complete without accepting these
 * documents, so they have to be readable before an account exists — and afterwards, by anyone
 * checking what they agreed to. Nothing here is workspace-scoped; published legal text is the
 * same for everyone, which is the point of publishing it.
 */
@ApiTags('legal')
@Controller('legal')
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get('documents/:type')
  @ApiOperation({
    summary: 'The version of a legal document currently in force',
    description:
      'Returns the text for the locale asked for, or the authoritative locale when that ' +
      'translation does not exist. The hash is what a consent record copies, so a client can ' +
      'show the text and the record can be proved against it afterwards.',
  })
  async current(
    @Param('type') type: string,
    @Query('locale') locale?: string,
  ): Promise<LegalDocumentResponse> {
    // A type that does not exist and one with nothing published are answered alike: 404.
    if (!TYPES.has(type)) throw AppError.notFound();
    return view(await this.legal.currentDocument(type as LegalDocumentType, locale));
  }
}

const view = (d: PublishedDocument): LegalDocumentResponse => ({
  type: d.type,
  version: d.version,
  locale: d.locale,
  title: d.title,
  content: d.content,
  contentHash: d.contentHash,
  effectiveFrom: d.effectiveFrom.toISOString(),
  authoritative: d.authoritative,
});
