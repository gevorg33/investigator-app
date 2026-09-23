import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import { PolicyReviewQueueQuery, ResolvePolicyReviewDto } from './assignments.dto';
import {
  PolicyRefusalService,
  type PolicyReviewView,
  type ResponseRecord,
} from './policy-refusal.service';

/** Staff review of investigators' policy refusals, and an investigator's own standing (T-050). */
@ApiTags('policy-reviews')
@Controller('policy-reviews')
@UseGuards(ActorGuard)
export class PolicyReviewsController {
  constructor(private readonly refusal: PolicyRefusalService) {}

  @Get()
  @ApiOperation({ summary: 'Open reviews, oldest first (moderation staff)' })
  queue(
    @CurrentActor() actor: Actor,
    @Query() query: PolicyReviewQueueQuery,
    @Req() req: Request,
  ): Promise<{
    items: PolicyReviewView[];
    pageInfo: { nextCursor: string | null; hasNextPage: boolean };
  }> {
    return this.refusal.queue(
      actor,
      { limit: query.limit, cursor: query.cursor },
      requestContext(req),
    );
  }

  // Declared before `:id` so that "response-record" is never read as a review id.
  @Get('response-record/me')
  @ApiOperation({
    summary: 'The caller’s standing on refusals',
    description:
      'Counted: declines and unsubstantiated halts. Excused: refusals staff found substantiated. ' +
      'Pending: still under review.',
  })
  myRecord(@CurrentActor() actor: Actor, @Req() req: Request): Promise<ResponseRecord> {
    return this.refusal.myResponseRecord(actor, requestContext(req));
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Decide a review, once (moderation staff)',
    description:
      'Substantiated or not, with reasoning. For a halt, resume or cancel — and when cancelling, ' +
      'the money decision, which is recorded separately and carried out by payments.',
  })
  resolve(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolvePolicyReviewDto,
    @Req() req: Request,
  ): Promise<PolicyReviewView> {
    return this.refusal.resolve(actor, id, dto, requestContext(req));
  }
}
