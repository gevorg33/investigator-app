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
import {
  CreateReviewDto,
  ReportReviewTextDto,
  RespondToReviewDto,
  ReviewListQuery,
} from './reviews.dto';
import {
  ReviewsService,
  type PublicReviewView,
  type RatingSummary,
  type ReviewView,
} from './reviews.service';

/** A completed assignment's review, for its two parties; and a profile's reviews, for anyone (T-037). */
@ApiTags('reviews')
@Controller()
@UseGuards(ActorGuard)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('assignments/:assignmentId/review')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Review a completed assignment (its customer, once)',
    description:
      'A rating from 1 to 5, and words if wanted. The words are moderated before anyone but the ' +
      'two parties can read them; the rating counts at once. A review is not a dispute: it moves ' +
      'no money and reopens nothing — raise a dispute for that. 409 if already reviewed.',
  })
  create(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: CreateReviewDto,
    @Req() req: Request,
  ): Promise<ReviewView> {
    return this.reviews.create(actor, assignmentId, dto, requestContext(req));
  }

  @Get('assignments/:assignmentId/review')
  @ApiOperation({
    summary: 'The assignment’s review (either party)',
    description: 'Both texts in whatever state they are, and why one was hidden. 404 if none.',
  })
  get(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Req() req: Request,
  ): Promise<ReviewView> {
    return this.reviews.getForParty(actor, assignmentId, requestContext(req));
  }

  @Post('assignments/:assignmentId/review/response')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Respond to the review (the assignment’s investigator, once)',
    description:
      'Moderated like the review. 409 if already responded; 403 if the review was removed.',
  })
  respond(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: RespondToReviewDto,
    @Req() req: Request,
  ): Promise<ReviewView> {
    return this.reviews.respond(actor, assignmentId, dto, requestContext(req));
  }

  @Post('assignments/:assignmentId/review/report')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Report the other party’s published words back to moderation',
    description:
      'The investigator reports the review, the customer reports the response. The words leave ' +
      'public view until a moderator decides again.',
  })
  report(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: ReportReviewTextDto,
    @Req() req: Request,
  ): Promise<ReviewView> {
    return this.reviews.report(actor, assignmentId, dto, requestContext(req));
  }

  @Get('profiles/investigator/:profileId/reviews')
  @ApiOperation({
    summary: 'A published investigator’s reviews, newest first, with the rating summary',
    description:
      'Standing reviews only, with published words only, and no reviewer. The summary is computed ' +
      'from the standing reviews. 404 for a profile the caller cannot see.',
  })
  forProfile(
    @CurrentActor() actor: Actor,
    @Param('profileId', ParseUUIDPipe) profileId: string,
    @Query() query: ReviewListQuery,
    @Req() req: Request,
  ): Promise<{
    summary: RatingSummary;
    items: PublicReviewView[];
    pageInfo: { nextCursor: string | null; hasNextPage: boolean };
  }> {
    return this.reviews.forProfile(
      actor,
      profileId,
      { limit: query.limit, cursor: query.cursor },
      requestContext(req),
    );
  }
}
