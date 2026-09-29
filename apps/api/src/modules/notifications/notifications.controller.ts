import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import { emailCopy, escape } from '../../common/mail/email';
import { ListNotificationsQuery, SetPreferenceDto } from './notifications.dto';
import {
  NotificationsService,
  type NotificationView,
  type Preference,
} from './notifications.service';

/**
 * A small page of the API's own, for the unsubscribe link (T-036): the link is opened from an email
 * client, often by a scanner before a person, so opening it only asks; the button does it.
 */
async function page(
  res: Response,
  locale: string | undefined,
  build: (copy: Awaited<ReturnType<typeof emailCopy>>['copy']) => string,
): Promise<void> {
  const { lang, copy } = await emailCopy(locale);
  res
    .status(200)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
    })
    .send(
      `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
        `<meta name="robots" content="noindex"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>Investigator</title></head><body>${build(copy)}</body></html>`,
    );
}

/**
 * The in-app notification centre, preferences and unsubscribe (T-036). The centre and preferences
 * are the caller's own, in the workspace the request is in. Unsubscribing needs no session: the
 * signed link is the authority, and it can do one thing — stop one category of email.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @UseGuards(ActorGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The caller’s notifications, newest first, a page at a time.' })
  list(
    @CurrentActor() actor: Actor,
    @Query() query: ListNotificationsQuery,
    @Req() req: Request,
  ): Promise<{ items: NotificationView[]; nextCursor: string | null }> {
    return this.notifications.list(actor, query.cursor, requestContext(req));
  }

  @Get('unread')
  @UseGuards(ActorGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'How many of the caller’s notifications are unread.' })
  async unread(@CurrentActor() actor: Actor, @Req() req: Request): Promise<{ count: number }> {
    return { count: await this.notifications.unread(actor, requestContext(req)) };
  }

  @Post('read-all')
  @UseGuards(ActorGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark every notification of the caller’s read.' })
  async readAll(@CurrentActor() actor: Actor, @Req() req: Request): Promise<void> {
    await this.notifications.markAllRead(actor, requestContext(req));
  }

  @Post(':id/read')
  @UseGuards(ActorGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'Mark one of the caller’s notifications read.' })
  async read(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.notifications.markRead(actor, id, requestContext(req));
  }

  @Get('preferences')
  @UseGuards(ActorGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'What the caller receives by email, defaults included.' })
  async preferences(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<{ preferences: Preference[] }> {
    return { preferences: await this.notifications.preferences(actor, requestContext(req)) };
  }

  @Put('preferences')
  @UseGuards(ActorGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Turn a category of email on or off. In-app is always on.' })
  async setPreference(
    @CurrentActor() actor: Actor,
    @Body() dto: SetPreferenceDto,
    @Req() req: Request,
  ): Promise<{ preferences: Preference[] }> {
    return {
      preferences: await this.notifications.setPreference(actor, dto, requestContext(req)),
    };
  }

  @Get('unsubscribe')
  @ApiOperation({ summary: 'The page an unsubscribe link opens: it asks, and changes nothing.' })
  async unsubscribePage(@Query('token') token: unknown, @Res() res: Response): Promise<void> {
    const locale = await this.notifications.localeFor(token);
    const action = `?token=${encodeURIComponent(String(token ?? ''))}`;
    await page(res, locale, (c) =>
      locale === undefined
        ? `<p>${escape(c.unsubscribe.invalid)}</p>`
        : `<h1>${escape(c.unsubscribe.title)}</h1><p>${escape(c.unsubscribe.body)}</p>` +
          `<form method="post" action="${escape(action)}"><button type="submit">${escape(c.unsubscribe.confirm)}</button></form>`,
    );
  }

  @Post('unsubscribe')
  @ApiOperation({
    summary:
      'Stop a category of email: the page’s button, and one-click (RFC 8058) from mail clients.',
  })
  async unsubscribe(
    @Query('token') token: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const outcome = await this.notifications.unsubscribe(token, requestContext(req));
    const locale = outcome === 'done' ? await this.notifications.localeFor(token) : undefined;
    await page(res, locale, (c) => `<p>${escape(c.unsubscribe[outcome])}</p>`);
  }
}
