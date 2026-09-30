import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import { BlockDto } from './blocks.dto';
import {
  BlocksService,
  type BlockResult,
  type BlockSignal,
  type BlockView,
  type LiveAssignmentFlag,
} from './blocks.service';

/** The caller's own blocks (T-052). */
@ApiTags('blocks')
@Controller('blocks')
@UseGuards(ActorGuard)
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Block someone, from their profile, a mission or an assignment',
    description:
      'Governs what happens next: their missions, quotes and listing stop reaching you, and yours ' +
      'them. An assignment already under way continues, and goes to staff. Blocking again is ' +
      'harmless.',
  })
  block(
    @CurrentActor() actor: Actor,
    @Body() dto: BlockDto,
    @Req() req: Request,
  ): Promise<BlockResult> {
    return this.blocks.block(actor, dto, requestContext(req));
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The people the caller has blocked, newest first' })
  async list(@CurrentActor() actor: Actor, @Req() req: Request): Promise<{ items: BlockView[] }> {
    return { items: await this.blocks.list(actor, requestContext(req)) };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Unblock' })
  async unblock(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.blocks.unblock(actor, id, requestContext(req));
  }
}

/** Blocks as staff see them: what needs a decision, and what forms a pattern (T-052). */
@ApiTags('block-review')
@Controller('block-review')
@UseGuards(ActorGuard)
export class BlockReviewController {
  constructor(private readonly blocks: BlocksService) {}

  @Get('live-assignments')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Blocks between the parties to an assignment still under way (disputes staff)',
  })
  async liveAssignments(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<{ items: LiveAssignmentFlag[] }> {
    return { items: await this.blocks.liveAssignments(actor, requestContext(req)) };
  }

  @Get('signals')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Accounts blocked by several people (enforcement staff)' })
  async signals(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<{ items: BlockSignal[] }> {
    return { items: await this.blocks.signals(actor, requestContext(req)) };
  }
}
