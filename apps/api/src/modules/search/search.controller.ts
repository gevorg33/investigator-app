import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import { SearchInvestigatorsDto } from './search.dto';
import { SearchService, type SearchPage } from './search.service';

/**
 * Investigator discovery.
 *
 * `POST`, not `GET`, and deliberately: a location search carries coordinates, and T-009
 * established that coordinates travel in request bodies — never in a URL, where they would
 * reach access logs, referrers and analytics. The trade is cacheability, which a personalised,
 * eligibility-filtered search does not get anyway.
 */
@ApiTags('search')
@Controller('search')
@UseGuards(ActorGuard)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Post('investigators')
  // 200, not 201: this creates nothing. It is a query whose arguments are too sensitive for a URL.
  @HttpCode(200)
  @ApiOperation({
    summary: 'Find investigators matching typed filters, nearest first.',
    description:
      'Hard filters and eligibility are applied in SQL before any ranking. An unverified, ' +
      'suspended, unpublished or not-accepting investigator cannot appear through any filter ' +
      'combination. Results are public projections and carry a rounded distance, never geometry.',
  })
  async investigators(
    @CurrentActor() actor: Actor,
    @Body() dto: SearchInvestigatorsDto,
    @Req() req: Request,
  ): Promise<SearchPage> {
    return this.search.searchInvestigators(actor, dto, requestContext(req));
  }
}
