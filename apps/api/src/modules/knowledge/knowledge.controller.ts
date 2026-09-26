import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import { requestContext } from '../../common/http/request-context';
import {
  KnowledgeDocumentsService,
  type KnowledgeDocumentView,
} from './knowledge-documents.service';
import { ReadDocumentQuery } from './knowledge.dto';

/** A document key as the knowledge base writes them (`knowledge-source.ts`): `kb-…`. */
const DOC_KEY = /^kb-[a-z0-9]+(-[a-z0-9]+)*$/;

/** The platform's help articles, for signed-in readers (T-059). */
@ApiTags('knowledge')
@Controller('knowledge')
@UseGuards(ActorGuard)
export class KnowledgeController {
  constructor(private readonly documents: KnowledgeDocumentsService) {}

  @Get('documents/:docKey')
  @ApiOperation({
    summary: 'One help article the caller may read, section by section',
    description:
      'The same gate as the assistant’s retrieval: an article of another audience or visibility ' +
      'is a 404, like one that does not exist. English when the language asked for has no version.',
  })
  read(
    @CurrentActor() actor: Actor,
    @Param('docKey') docKey: string,
    @Query() query: ReadDocumentQuery,
    @Req() req: Request,
  ): Promise<KnowledgeDocumentView> {
    if (docKey.length > 120 || !DOC_KEY.test(docKey)) throw AppError.notFound();
    return this.documents.read(actor, docKey, query.locale, requestContext(req));
  }
}
