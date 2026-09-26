import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../../common/authz/actor.decorator';
import { ActorGuard } from '../../../common/authz/actor.guard';
import type { Actor } from '../../../common/authz/contract';
import { AppError } from '../../../common/errors/app-error';
import { requestContext } from '../../../common/http/request-context';
import { UpdateSettingsSectionDto } from './agency-settings.dto';
import {
  AgencySettingsService,
  type SectionView,
  type SettingsView,
} from './agency-settings.service';
import { isSection } from './sections';

/** The settings of the agency the request acts in (T-084). */
@ApiTags('agencies')
@Controller('agencies/current/settings')
@UseGuards(ActorGuard)
export class AgencySettingsController {
  constructor(private readonly settings: AgencySettingsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Every settings section, with its defaults where none was saved. Requires settings.read.',
  })
  async read(@CurrentActor() actor: Actor, @Req() req: Request): Promise<SettingsView> {
    return this.settings.read(actor, requestContext(req));
  }

  @Patch(':section')
  @ApiOperation({
    summary: 'Change some of one section’s values. Requires settings.update and the version read.',
  })
  async update(
    @CurrentActor() actor: Actor,
    @Param('section') section: string,
    @Body() dto: UpdateSettingsSectionDto,
    @Req() req: Request,
  ): Promise<SectionView> {
    // A section that does not exist is a resource that does not exist.
    if (!isSection(section)) throw AppError.notFound();
    return this.settings.update(actor, section, dto, requestContext(req));
  }
}
