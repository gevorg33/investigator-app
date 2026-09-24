import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../../common/authz/actor.decorator';
import { ActorGuard } from '../../../common/authz/actor.guard';
import type { Actor } from '../../../common/authz/contract';
import { requestContext } from '../../../common/http/request-context';
import { FindInvestigatorsDto } from './discovery-answer.dto';
import { type DiscoveryAnswer, DiscoveryAnswerService } from './discovery-answer.service';

/** The assistant finding investigators from live data (T-018). Signed-in callers only. */
@ApiTags('ai')
@Controller('ai/discovery')
@UseGuards(ActorGuard)
export class DiscoveryAnswerController {
  constructor(private readonly discovery: DiscoveryAnswerService) {}

  // POST: a location travels in the body, never in a URL.
  @Post('answer')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Find investigators for a request in plain language',
    description:
      'Turns the request into typed filters, searches verified investigators who are accepting ' +
      'work, and explains each match from the data that matched. Asks one question only when ' +
      'the answer depends on it; refuses a request the lawful-use rules match. 503 while no ' +
      'model is configured.',
  })
  answer(
    @CurrentActor() actor: Actor,
    @Body() dto: FindInvestigatorsDto,
    @Req() req: Request,
  ): Promise<DiscoveryAnswer> {
    return this.discovery.answer(
      actor,
      {
        question: dto.question,
        locale: dto.locale,
        near: dto.near === undefined ? undefined : { lon: dto.near.lon, lat: dto.near.lat },
        radiusKm: dto.radiusKm,
        taxonomyNodeIds: dto.taxonomyNodeIds,
        purpose: dto.purpose,
      },
      requestContext(req),
    );
  }
}
