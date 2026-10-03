import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import { requestContext } from '../../common/http/request-context';
import { TAXONOMY_LOCALES, type TaxonomyLocale } from '../../database/schema';
import { TaxonomyReadQuery } from './taxonomy.dto';
import { CreateTagDto, DeprecateTagDto, MergeTagDto, SetTagLabelDto } from './tags.dto';
import { TagsService, type TagOption, type TagView } from './tags.service';

/**
 * The curated tag vocabulary (T-055). Reading is for anyone signed in; changing it is for staff
 * holding the TAXONOMY scope, which the service checks on every write.
 */
@ApiTags('tags')
@Controller('tags')
@UseGuards(ActorGuard)
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @ApiOperation({
    summary: 'The active tags, labelled in the locale asked for',
    description:
      'What a customer suggests tags from and an investigator filters by. Retired and merged ' +
      'tags are not in it. A label missing in the locale asked for falls back to English.',
  })
  list(@Query() query: TaxonomyReadQuery): Promise<TagOption[]> {
    return this.tags.list(query.locale);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Add a tag (staff, TAXONOMY scope)',
    description: 'The slug is permanent. Every change carries a reason, recorded in the audit log.',
  })
  create(
    @CurrentActor() actor: Actor,
    @Body() dto: CreateTagDto,
    @Req() req: Request,
  ): Promise<TagView> {
    return this.tags.create(actor, dto, requestContext(req));
  }

  @Put(':id/labels/:locale')
  @ApiOperation({ summary: 'Set a tag’s label in one locale (staff, TAXONOMY scope)' })
  setLabel(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('locale') locale: string,
    @Body() dto: SetTagLabelDto,
    @Req() req: Request,
  ): Promise<TagView> {
    if (!(TAXONOMY_LOCALES as readonly string[]).includes(locale)) {
      throw AppError.validation([
        { field: 'locale', code: 'UNKNOWN', messageKey: 'error.validation.taxonomy.locale' },
      ]);
    }
    return this.tags.setLabel(actor, id, locale as TaxonomyLocale, dto, requestContext(req));
  }

  @Post(':id/deprecate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Retire a tag (staff, TAXONOMY scope)',
    description:
      'Gone from every picker; still on every mission that carries it. 409 if already retired.',
  })
  deprecate(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeprecateTagDto,
    @Req() req: Request,
  ): Promise<TagView> {
    return this.tags.deprecate(actor, id, dto, requestContext(req));
  }

  @Post(':id/merge')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Merge a tag into another (staff, TAXONOMY scope)',
    description:
      'The tag is retired and names the one it became; a filter on that one finds every mission ' +
      'that carried either. The target must be active; a tag is merged once (409 otherwise).',
  })
  merge(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MergeTagDto,
    @Req() req: Request,
  ): Promise<TagView> {
    return this.tags.merge(actor, id, dto, requestContext(req));
  }
}
