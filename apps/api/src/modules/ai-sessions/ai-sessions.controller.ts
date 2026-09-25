import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
  CreateSessionDto,
  ListMessagesQuery,
  ListSessionsQuery,
  RenameSessionDto,
  SearchSessionsQuery,
} from './ai-sessions.dto';
import {
  AiSessionsService,
  type MessageView,
  type Page,
  type SessionView,
} from './ai-sessions.service';

/**
 * The caller's conversations with the assistant (ADR-0006, T-045). Every route is the caller's own,
 * in the workspace the request is in; any other session is a 404.
 */
@ApiTags('ai-sessions')
@Controller('ai/sessions')
@UseGuards(ActorGuard)
export class AiSessionsController {
  constructor(private readonly sessions: AiSessionsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Start a conversation, untitled unless a title is given' })
  create(
    @CurrentActor() actor: Actor,
    @Body() dto: CreateSessionDto,
    @Req() req: Request,
  ): Promise<SessionView> {
    return this.sessions.create(actor, { title: dto.title }, requestContext(req));
  }

  @Get()
  @ApiOperation({ summary: 'The caller’s conversations in this workspace, most recent first' })
  list(
    @CurrentActor() actor: Actor,
    @Query() query: ListSessionsQuery,
    @Req() req: Request,
  ): Promise<Page<SessionView>> {
    return this.sessions.list(
      actor,
      { archived: query.archived === 'true', limit: query.limit, cursor: query.cursor },
      requestContext(req),
    );
  }

  // Declared before `:id` so that "search" is never read as a session id.
  @Get('search')
  @ApiOperation({ summary: 'The caller’s conversations whose title or messages match' })
  search(
    @CurrentActor() actor: Actor,
    @Query() query: SearchSessionsQuery,
    @Req() req: Request,
  ): Promise<Array<SessionView & { firstMatchSequence: number | null }>> {
    return this.sessions.search(actor, query.q, requestContext(req));
  }

  @Get(':id')
  open(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<SessionView> {
    return this.sessions.open(actor, id, requestContext(req));
  }

  @Post(':id/resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Back to work: out of the archive, and active from now' })
  resume(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<SessionView> {
    return this.sessions.resume(actor, id, requestContext(req));
  }

  @Get(':id/messages')
  @ApiOperation({
    summary: 'The conversation a page at a time — from the start, or newest first (`order=newest`)',
  })
  messages(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesQuery,
    @Req() req: Request,
  ): Promise<Page<MessageView>> {
    return this.sessions.messages(
      actor,
      id,
      { limit: query.limit, cursor: query.cursor, order: query.order },
      requestContext(req),
    );
  }

  @Patch(':id')
  rename(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameSessionDto,
    @Req() req: Request,
  ): Promise<SessionView> {
    return this.sessions.rename(actor, id, dto.title, requestContext(req));
  }

  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<SessionView> {
    return this.sessions.archive(actor, id, requestContext(req));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a conversation',
    description:
      'Erases every message now, in one transaction, and keeps a record that the conversation ' +
      'existed — whose it was and when it went — with no title and no content.',
  })
  async delete(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.sessions.delete(actor, id, requestContext(req));
  }
}
