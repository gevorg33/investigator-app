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
import { CreateTaskDto, TransitionTaskDto, UpdateTaskDto } from './investigation-workspace.dto';
import { TasksService, type TaskView } from './tasks.service';

/** The work plan within one assignment (T-032). Private to its creator unless shared. */
@ApiTags('investigation-workspace')
@Controller('assignments/:assignmentId/tasks')
@UseGuards(ActorGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({
    summary: 'The assignment’s work plan, in order',
    description:
      'Your own tasks if you created them; the shared ones if you are the assignment’s customer. ' +
      'Anyone else gets 404.',
  })
  list(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Req() req: Request,
  ): Promise<TaskView[]> {
    return this.tasks.list(actor, assignmentId, requestContext(req));
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Add a task (the assignment’s investigator, while the work is live)',
    description: 'TODO and PRIVATE; placed last unless `position` is given.',
  })
  create(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() dto: CreateTaskDto,
    @Req() req: Request,
  ): Promise<TaskView> {
    return this.tasks.create(actor, assignmentId, dto, requestContext(req));
  }

  @Patch(':taskId')
  @ApiOperation({
    summary: 'Edit a task, or share or unshare it',
    description: 'Not its status — that moves through `transition`. `null` clears a field.',
  })
  update(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateTaskDto,
    @Req() req: Request,
  ): Promise<TaskView> {
    return this.tasks.update(actor, assignmentId, taskId, dto, requestContext(req));
  }

  @Post(':taskId/transition')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Move a task to another status',
    description:
      'TODO → IN_PROGRESS, DONE or CANCELLED; IN_PROGRESS → TODO, DONE or CANCELLED; DONE or ' +
      'CANCELLED → TODO. Any other move is 403.',
  })
  transition(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: TransitionTaskDto,
    @Req() req: Request,
  ): Promise<TaskView> {
    return this.tasks.transition(actor, assignmentId, taskId, dto, requestContext(req));
  }

  @Delete(':taskId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a task',
    description: 'Out of every view and kept for retention. A deletion is final.',
  })
  async remove(
    @CurrentActor() actor: Actor,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.tasks.remove(actor, assignmentId, taskId, requestContext(req));
  }
}
