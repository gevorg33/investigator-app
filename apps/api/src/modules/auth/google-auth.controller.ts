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
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { appUrl } from '@investigator/config';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { AppError } from '../../common/errors/app-error';
import { requestContext } from '../../common/http/request-context';
import { COOKIE, cookieOptions } from './auth.controller';
import { CompleteGoogleSignupDto } from './auth.dto';
import {
  ATTEMPT_TTL_MS,
  GoogleAuthService,
  SIGNUP_TTL_MS,
  type CallbackOutcome,
  type LinkedIdentity,
} from './google-auth.service';

/** The browser's half of a trip to Google: state and PKCE verifier. */
export const OAUTH_COOKIE = 'investigator_oauth';
/** A first Google sign-in waiting on the documents. */
export const SIGNUP_COOKIE = 'investigator_signup';
const GOOGLE_PATH = '/api/v1/auth/google';

const secure = () => process.env['NODE_ENV'] !== 'development';

/**
 * Lax, not Strict: it must come back on Google's top-level redirect to the callback, which is a
 * cross-site navigation. httpOnly, ten minutes, and sent to the Google routes only.
 */
const oauthCookie = () => ({
  httpOnly: true,
  secure: secure(),
  sameSite: 'lax' as const,
  path: GOOGLE_PATH,
  maxAge: ATTEMPT_TTL_MS,
});
const signupCookie = () => ({
  httpOnly: true,
  secure: secure(),
  sameSite: 'strict' as const,
  path: GOOGLE_PATH,
  maxAge: SIGNUP_TTL_MS,
});

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Leaves the callback for the app by a navigation the page itself makes. A redirect would carry
 * Google's cross-site context with it, and the session cookie — SameSite=Strict (ADR-0002) — would
 * not be sent on the page it lands on; a navigation started here, on the app's own site, sends it.
 * No script: a meta refresh, and a link for a browser that does not follow one.
 */
function continueTo(res: Response, path: string): void {
  const url = escapeHtml(appUrl(path));
  res
    .status(200)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // The callback's address carries the code and state: never passed on as a referrer.
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    })
    .send(
      `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex">` +
        `<meta http-equiv="refresh" content="0;url=${url}"><title>Investigator</title></head>` +
        `<body><a href="${url}">Continue</a></body></html>`,
    );
}

/** Where each outcome sends the browser on the app. */
function destination(outcome: CallbackOutcome): string {
  const next = (to: string) => `next=${encodeURIComponent(to)}`;
  switch (outcome.kind) {
    case 'session':
      return `/session/start?${next(outcome.returnTo)}`;
    case 'signup':
      return `/sign-up/google?${next(outcome.returnTo)}`;
    case 'linked':
      return '/account?google=linked#sign-in';
    case 'failed':
      return outcome.intent === 'LINK'
        ? `/account?google=${outcome.reason}#sign-in`
        : `/sign-in?google=${outcome.reason}`;
  }
}

/**
 * Sign in with Google (T-062). The browser goes to Google and comes back to `callback`; the code
 * is exchanged here, server to server, and what the app receives is the platform's own session —
 * never a Google token. Connecting Google to a signed-in account goes the same way from `link`.
 */
@ApiTags('auth')
@Controller('auth')
export class GoogleAuthController {
  constructor(private readonly google: GoogleAuthService) {}

  @Get('providers')
  @ApiOperation({
    summary: 'Which sign-in providers are configured, so the app offers only those.',
  })
  providers(): { google: boolean } {
    return { google: this.google.enabled };
  }

  @Get('google/start')
  @ApiOperation({ summary: 'Leave for Google to sign in. A top-level navigation, not a fetch.' })
  async start(
    @Query('next') next: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { url, cookie } = await this.google.start({ returnTo: next }, requestContext(req));
    res.cookie(OAUTH_COOKIE, cookie, oauthCookie()).redirect(303, url);
  }

  @Get('google/link')
  @UseGuards(ActorGuard)
  @ApiOperation({ summary: 'Leave for Google to connect it to the signed-in account.' })
  async link(
    @CurrentActor() actor: Actor,
    @Query('next') next: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { url, cookie } = await this.google.start({ returnTo: next, actor }, requestContext(req));
    res.cookie(OAUTH_COOKIE, cookie, oauthCookie()).redirect(303, url);
  }

  @Get('google/callback')
  @ApiOperation({ summary: 'Where Google returns. Believed only with this browser’s state.' })
  async callback(
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const outcome = await this.google.callback(
      query,
      req.cookies?.[OAUTH_COOKIE] as string | undefined,
      requestContext(req),
    );
    // Spent either way: the attempt it named can never be used again.
    res.clearCookie(OAUTH_COOKIE, { ...oauthCookie(), maxAge: undefined });
    if (outcome.kind === 'session') res.cookie(COOKIE, outcome.session.refreshToken, cookieOptions);
    if (outcome.kind === 'signup') res.cookie(SIGNUP_COOKIE, outcome.signupToken, signupCookie());
    continueTo(res, destination(outcome));
  }

  @Get('google/pending')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The address a first Google sign-in will create its account with.' })
  async pending(@Req() req: Request): Promise<{ email: string }> {
    const found = await this.google.pending(req.cookies?.[SIGNUP_COOKIE] as string | undefined);
    if (found === null) throw new AppError('NOT_FOUND');
    return found;
  }

  @Post('google/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Create the account for a first Google sign-in, accepting the required documents.',
  })
  async complete(
    @Body() dto: CompleteGoogleSignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: string }> {
    const session = await this.google.complete(
      req.cookies?.[SIGNUP_COOKIE] as string | undefined,
      dto.acceptedDocumentIds ?? [],
      { locale: dto.locale, timezone: dto.timezone },
      requestContext(req),
    );
    res.clearCookie(SIGNUP_COOKIE, { ...signupCookie(), maxAge: undefined });
    res.cookie(COOKIE, session.refreshToken, cookieOptions);
    return { userId: session.userId };
  }

  @Get('identities')
  @UseGuards(ActorGuard)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'The caller’s sign-in methods: a password or not, and linked identities.',
  })
  async methods(
    @CurrentActor() actor: Actor,
  ): Promise<{ password: boolean; identities: LinkedIdentity[] }> {
    return this.google.methods(actor);
  }

  @Delete('identities/:id')
  @UseGuards(ActorGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'Disconnect a linked identity. Never the account’s last way in.' })
  async unlink(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.google.unlink(actor, id, requestContext(req));
  }
}
