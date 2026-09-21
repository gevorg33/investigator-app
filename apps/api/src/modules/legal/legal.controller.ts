import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import { requestContext } from '../../common/http/request-context';
import { legalDocuments } from '../../database/schema';
import { AcceptDocumentsDto } from './legal.dto';
import { REQUIRED_AT_REGISTRATION, requiredForRole } from './legal.policy';
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

  @Get('outstanding')
  @UseGuards(ActorGuard)
  @ApiOperation({
    summary: 'What this account still has to accept before going on',
    description:
      'The documents registration requires, plus those the roles they hold require. Empty when ' +
      'nothing is outstanding — including when nothing is published yet, because there is no ' +
      'text to agree to. A material new version puts a document back on this list.',
  })
  async outstanding(@CurrentActor() actor: Actor): Promise<LegalDocumentResponse[]> {
    const types = [
      ...REQUIRED_AT_REGISTRATION,
      ...actor.roles.flatMap((role) => requiredForRole(role)),
    ];
    const pending = await this.legal.outstanding(actor.userId, [...new Set(types)]);
    return pending.map(view);
  }

  @Post('acceptances')
  @HttpCode(201)
  @UseGuards(ActorGuard)
  @ApiOperation({
    summary: 'Accept the documents that are outstanding',
    description:
      'For re-acceptance after a material version publishes. Every outstanding document must be ' +
      'in the list; an id that is not outstanding is ignored rather than recorded twice.',
  })
  async accept(
    @CurrentActor() actor: Actor,
    @Body() dto: AcceptDocumentsDto,
    @Req() req: Request,
  ): Promise<{ outstanding: LegalDocumentResponse[] }> {
    const types = [
      ...REQUIRED_AT_REGISTRATION,
      ...actor.roles.flatMap((role) => requiredForRole(role)),
    ];
    await this.legal.requireAcceptance(
      {
        userId: actor.userId,
        types: [...new Set(types)],
        acceptedDocumentIds: dto.acceptedDocumentIds,
        context: 'REACCEPTANCE',
      },
      requestContext(req),
    );
    return { outstanding: [] };
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
