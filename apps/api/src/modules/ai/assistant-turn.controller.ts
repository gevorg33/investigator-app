import { Body, Controller, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext, type RequestContext } from '../../common/http/request-context';
import { AskTurnDto, RetryTurnDto } from './assistant-turn.dto';
import { AssistantTurnService, type Turn, type TurnEvent } from './assistant-turn.service';

/** One server-sent event: its type as the event name, the rest as JSON. */
export const sseFrame = ({ type, ...data }: TurnEvent): string =>
  `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

const STREAM_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  // Never cached, never transformed, never buffered by a proxy on the way: each event is news
  // the moment it is written.
  'cache-control': 'no-cache, no-transform',
  'x-accel-buffering': 'no',
};

/**
 * Talking to the assistant inside a conversation (T-056).
 *
 * Both routes refuse — with the usual JSON error and status — before anything is stored. Once a
 * turn is under way the response is a stream of server-sent events ({@link TurnEvent}); a client
 * that closes it has pressed Stop, and nothing more is stored for that turn.
 */
@ApiTags('ai-sessions')
@Controller('ai/sessions')
@UseGuards(ActorGuard)
export class AssistantTurnController {
  constructor(private readonly turns: AssistantTurnService) {}

  @Post(':id/turns')
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: 'Ask the assistant something in this conversation, and follow the answer as it forms',
    description:
      'Stores the question, then streams `message` (the question as stored), `session`, `step` ' +
      '(searching; writing from N sources), `message` (the reply, citations checked) and `done` ' +
      '— or `error` in place of the reply. 503 before anything is stored while no model is configured.',
  })
  async ask(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AskTurnDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const r = requestContext(req);
    await this.stream(res, actor, await this.turns.ask(actor, id, dto, r), r);
  }

  @Post(':id/turns/retry')
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: 'Answer the question a failed or stopped turn left unanswered',
    description: '409 when the conversation’s last message is not an unanswered question.',
  })
  async retry(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RetryTurnDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const r = requestContext(req);
    await this.stream(res, actor, await this.turns.retry(actor, id, dto, r), r);
  }

  private async stream(res: Response, actor: Actor, turn: Turn, r: RequestContext): Promise<void> {
    res.status(200).set(STREAM_HEADERS).flushHeaders();
    const stop = new AbortController();
    // A closed connection before the end is a Stop, and the turn stops with it.
    res.on('close', () => stop.abort());
    const send = (event: TurnEvent): void => {
      if (!stop.signal.aborted) res.write(sseFrame(event));
    };
    for (const event of turn.opening) send(event);
    await this.turns.run(actor, turn, r, send, stop.signal);
    send({ type: 'done' });
    res.end();
  }
}
