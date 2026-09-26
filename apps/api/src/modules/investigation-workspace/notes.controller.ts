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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import { CreateNoteDto, UpdateNoteDto } from './investigation-workspace.dto';
import { NotesService, type NoteView } from './notes.service';

/** Notes within one assignment (T-032). Private to their author unless shared. */
@ApiTags('investigation-workspace')
@Controller('assignments/:assignmentId/notes')
@UseGuards(ActorGuard)
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @ApiOperation({
    summary: 'The assignment’s notes',
    description:
      'Your own notes if you wrote them; the shared ones if you are the assignment’s customer. ' +
      'A private note is readable by its author alone. Anyone else gets 404.',
  })
  list(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Req() req: Request,
  ): Promise<NoteView[]> {
    return this.notes.list(actor, assignmentId, requestContext(req));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Write a note (the assignment’s investigator, while the work is live)',
    description: 'PRIVATE unless `visibility` is SHARED.',
  })
  create(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: CreateNoteDto,
    @Req() req: Request,
  ): Promise<NoteView> {
    return this.notes.create(actor, assignmentId, dto, requestContext(req));
  }

  @Patch(':noteId')
  @ApiOperation({
    summary: 'Edit a note, or share or unshare it',
    description: 'A change of visibility is audited on its own, with who made it.',
  })
  update(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Body() dto: UpdateNoteDto,
    @Req() req: Request,
  ): Promise<NoteView> {
    return this.notes.update(actor, assignmentId, noteId, dto, requestContext(req));
  }

  @Delete(':noteId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a note',
    description: 'Out of every view and kept for retention. A deletion is final.',
  })
  async remove(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.notes.remove(actor, assignmentId, noteId, requestContext(req));
  }
}
