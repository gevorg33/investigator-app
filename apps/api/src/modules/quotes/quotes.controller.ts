import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { idempotencyKey } from '../../common/http/idempotency-key';
import { requestContext } from '../../common/http/request-context';
import { AcceptQuoteDto, SubmitQuoteDto } from './quotes.dto';
import { QuotesService, type QuoteView } from './quotes.service';

/**
 * Offers on a mission.
 *
 * Both sides are here because a quote has exactly two parties: the investigator who wrote it
 * and the customer whose mission it is. Nobody else can read one, and there is no route that
 * lists quotes across missions.
 */
@ApiTags('quotes')
@Controller()
@UseGuards(ActorGuard)
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post('missions/:missionId/quotes')
  @ApiOperation({
    summary: 'Submit a quote for a mission.',
    description:
      'Only a published, verified investigator who is accepting work may quote, and only on a ' +
      'mission a moderator has published. One live quote per investigator per mission: replacing ' +
      'one means withdrawing it first.',
  })
  async submit(
    @CurrentActor() actor: Actor,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Body() dto: SubmitQuoteDto,
    @Req() req: Request,
  ): Promise<QuoteView> {
    return this.quotes.submit(actor, missionId, dto, requestContext(req));
  }

  @Get('quotes/me')
  @ApiOperation({ summary: 'The caller’s own quotes, newest first.' })
  async listMine(@CurrentActor() actor: Actor, @Req() req: Request): Promise<QuoteView[]> {
    return this.quotes.listMine(actor, requestContext(req));
  }

  @Get('missions/:missionId/quotes')
  @ApiOperation({ summary: 'Every quote on the caller’s own mission, to compare before choosing.' })
  async listForMission(
    @CurrentActor() actor: Actor,
    @Param('missionId', ParseUUIDPipe) missionId: string,
    @Req() req: Request,
  ): Promise<QuoteView[]> {
    return this.quotes.listForMission(actor, missionId, requestContext(req));
  }

  @Post('quotes/:id/withdraw')
  @ApiOperation({ summary: 'Withdraw a live quote. Not possible once it has been accepted.' })
  async withdraw(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<QuoteView> {
    return this.quotes.withdraw(actor, id, requestContext(req));
  }

  @Post('quotes/:id/accept')
  @ApiOperation({
    summary: 'Accept a quote. Requires an Idempotency-Key header.',
    description:
      'Confirms the scope and price and closes the other quotes on the mission. It does not ' +
      'create the assignment: that happens when the payment provider confirms authorization, ' +
      'never on the strength of a client callback.',
  })
  async accept(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: AcceptQuoteDto,
    @Req() req: Request,
  ): Promise<QuoteView> {
    // Read before the work starts: a missing key must fail the request, not half-perform it.
    const key = idempotencyKey(req);
    return this.quotes.accept(actor, id, key, requestContext(req));
  }
}
