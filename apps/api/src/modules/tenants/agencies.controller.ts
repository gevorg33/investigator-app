import { Body, Controller, Get, Header, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { idempotencyKey } from '../../common/http/idempotency-key';
import { requestContext } from '../../common/http/request-context';
import { CreateAgencyDto, UpdateAgencyDetailsDto } from './agencies.dto';
import { AgenciesService, type AgencyDetails, type AgencyView } from './agencies.service';

/**
 * Creating an agency (T-083).
 *
 * Any active account may create one — an agency owner is not necessarily an investigator — and it
 * does not matter which workspace the request is acting in: the new agency belongs to the person,
 * not to the workspace their tab happens to be showing.
 */
@ApiTags('agencies')
@Controller('agencies')
@UseGuards(ActorGuard)
export class AgenciesController {
  constructor(private readonly agencies: AgenciesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an agency workspace. Requires an Idempotency-Key header.',
    description:
      'The creator becomes its owner and accepts the agency terms in the same transaction. The ' +
      'workspace is CREATING until the minimum — name, country, business email, time zone and ' +
      'currency — is complete, and ACTIVE from then on; the response says what is still missing. ' +
      'Status, verification and kind are the server’s, and there is no field for them here.',
  })
  async create(
    @CurrentActor() actor: Actor,
    @Body() dto: CreateAgencyDto,
    @Req() req: Request,
  ): Promise<AgencyView> {
    const key = idempotencyKey(req);
    return this.agencies.create(actor, dto, key, requestContext(req));
  }

  @Get('current')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'This agency’s core details and what is still missing. Requires company.read.',
  })
  async readCurrent(@CurrentActor() actor: Actor, @Req() req: Request): Promise<AgencyDetails> {
    return this.agencies.readCurrent(actor, requestContext(req));
  }

  @Patch('current')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Complete or change this agency’s core details. Owner only (company.update_details).',
    description:
      'Name, country, business email, time zone and currency, with the version read. Absent is ' +
      'left alone; none can be cleared. A CREATING agency becomes ACTIVE in the write that ' +
      'completes the minimum. Audited with the names of the fields changed.',
  })
  async updateCurrent(
    @CurrentActor() actor: Actor,
    @Body() dto: UpdateAgencyDetailsDto,
    @Req() req: Request,
  ): Promise<AgencyDetails> {
    return this.agencies.updateCurrent(actor, dto, requestContext(req));
  }
}
