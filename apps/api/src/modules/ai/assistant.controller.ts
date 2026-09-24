import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import { AskKnowledgeDto } from './knowledge-answer.dto';
import { type KnowledgeAnswer, KnowledgeAnswerService } from './knowledge-answer.service';

/** The assistant's answers from the knowledge base (T-017). Signed-in callers only. */
@ApiTags('ai')
@Controller('ai/knowledge')
@UseGuards(ActorGuard)
export class AssistantController {
  constructor(private readonly answers: KnowledgeAnswerService) {}

  @Post('answer')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Answer a question about how the platform works, from the knowledge base',
    description:
      'Answers only from documentation the caller may read, cites what it used, and returns ' +
      '`no_answer` when the documentation does not say. 503 while no model is configured.',
  })
  answer(
    @CurrentActor() actor: Actor,
    @Body() dto: AskKnowledgeDto,
    @Req() req: Request,
  ): Promise<KnowledgeAnswer> {
    return this.answers.answer(
      actor,
      { question: dto.question, locale: dto.locale },
      requestContext(req),
    );
  }
}
