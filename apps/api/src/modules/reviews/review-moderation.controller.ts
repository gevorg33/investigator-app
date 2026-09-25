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
import { ModerateReviewTextDto, RemoveReviewDto, ReviewListQuery } from './reviews.dto';
import { ReviewsService, type ModerationItem, type ReviewView } from './reviews.service';

/** Moderation staff: pre-moderating review words, and removing reviews (T-037). */
@ApiTags('review-moderation')
@Controller('review-moderation')
@UseGuards(ActorGuard)
export class ReviewModerationController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Words awaiting moderation, oldest first (moderation staff)' })
  queue(
    @CurrentActor() actor: Actor,
    @Query() query: ReviewListQuery,
    @Req() req: Request,
  ): Promise<{
    items: ModerationItem[];
    pageInfo: { nextCursor: string | null; hasNextPage: boolean };
  }> {
    return this.reviews.queue(
      actor,
      { limit: query.limit, cursor: query.cursor },
      requestContext(req),
    );
  }

  @Post('texts/:textId')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Publish or hide a review’s words or a response (moderation staff)',
    description: 'Hiding needs a reason, which the author is shown.',
  })
  moderate(
    @CurrentActor() actor: Actor,
    @Param('textId', ParseUUIDPipe) textId: string,
    @Body() dto: ModerateReviewTextDto,
    @Req() req: Request,
  ): Promise<{ id: string; status: 'PENDING' | 'PUBLISHED' | 'HIDDEN' }> {
    return this.reviews.moderate(actor, textId, dto, requestContext(req));
  }

  @Post('reviews/:reviewId/remove')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Remove a review from public view, once (moderation staff)',
    description:
      'The reason is audited and kept. Both parties still see the review, marked removed.',
  })
  remove(
    @CurrentActor() actor: Actor,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: RemoveReviewDto,
    @Req() req: Request,
  ): Promise<ReviewView> {
    return this.reviews.remove(actor, reviewId, dto, requestContext(req));
  }
}
