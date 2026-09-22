import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import {
  CreateTaxonomyNodeDto,
  SetTaxonomyLabelDto,
  TaxonomyReadQuery,
  UpdateTaxonomyNodeDto,
} from './taxonomy.dto';
import { TaxonomyService, type TaxonomyNodeView, type TaxonomyTreeNode } from './taxonomy.service';

/**
 * The shared taxonomy (ADR-0007, T-053). Reading is for anyone signed in; changing it is for
 * staff holding the TAXONOMY scope, which the service checks on every write.
 */
@ApiTags('taxonomy')
@Controller('taxonomy')
@UseGuards(ActorGuard)
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get()
  @ApiOperation({
    summary: 'The active taxonomy as a tree, labelled in the locale asked for',
    description:
      'What a customer chooses a mission category from and an investigator declares specialties ' +
      'from. Retired nodes are not in it. A label missing in the locale asked for falls back to ' +
      'English, and `labelLocale` says which was used.',
  })
  tree(@Query() query: TaxonomyReadQuery): Promise<TaxonomyTreeNode[]> {
    return this.taxonomy.tree(query.locale);
  }

  @Get('nodes/:id')
  @ApiOperation({
    summary: 'One node, whether active or retired',
    description:
      'A retired node still resolves: missions and profiles that already name it stay valid ' +
      '(ADR-0007 rule 1).',
  })
  node(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: TaxonomyReadQuery,
  ): Promise<TaxonomyNodeView> {
    return this.taxonomy.node(id, query.locale);
  }

  @Post('nodes')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Add a node (staff, TAXONOMY scope)',
    description:
      'The slug and parent are permanent. The risk band is required: it decides how missions ' +
      'under the node are moderated. Every change carries a reason, recorded in the audit log.',
  })
  create(
    @CurrentActor() actor: Actor,
    @Body() dto: CreateTaxonomyNodeDto,
    @Req() req: Request,
  ): Promise<TaxonomyNodeView> {
    return this.taxonomy.createNode(actor, dto, requestContext(req));
  }

  @Patch('nodes/:id')
  @ApiOperation({
    summary: 'Re-band, reorder, retire or restore a node (staff, TAXONOMY scope)',
    description:
      'A node with active children cannot be retired, and a node cannot be restored under a ' +
      'retired parent: every active node sits under an active parent.',
  })
  update(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaxonomyNodeDto,
    @Req() req: Request,
  ): Promise<TaxonomyNodeView> {
    return this.taxonomy.updateNode(actor, id, dto, requestContext(req));
  }

  @Put('nodes/:id/labels/:locale')
  @ApiOperation({ summary: 'Set a node’s label in one locale (staff, TAXONOMY scope)' })
  setLabel(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('locale') locale: string,
    @Body() dto: SetTaxonomyLabelDto,
    @Req() req: Request,
  ): Promise<TaxonomyNodeView> {
    if (!(TAXONOMY_LOCALES as readonly string[]).includes(locale)) {
      throw AppError.validation([
        { field: 'locale', code: 'UNKNOWN', messageKey: 'error.validation.taxonomy.locale' },
      ]);
    }
    return this.taxonomy.setLabel(actor, id, locale as TaxonomyLocale, dto, requestContext(req));
  }
}
