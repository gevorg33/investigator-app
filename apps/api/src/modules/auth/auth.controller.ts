import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { requestContext } from '../../common/http/request-context';
import { CredentialsDto, RegisterDto, EmailOnlyDto, ResetPasswordDto, TokenDto } from './auth.dto';
import type { SessionSummary } from './auth.service';
import { ActorGuard } from '../../common/authz/actor.guard';
import { CurrentActor } from '../../common/authz/actor.decorator';
import type { Actor } from '../../common/authz/contract';
import { REFRESH_TTL_DAYS } from './session.service';

const COOKIE = 'investigator_session';

/**
 * Host-only cookie: no Domain attribute, so it is never sent to another subdomain
 * (ADR-0002). SameSite=Strict is viable because the API is same-origin with the app.
 */
const cookieOptions = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] !== 'development',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(202)
  @ApiOperation({ summary: 'Register. Always 202 — never reveals whether the address exists.' })
  async register(@Body() dto: RegisterDto, @Req() req: Request): Promise<{ status: string }> {
    await this.auth.register(
      dto.email,
      dto.password,
      requestContext(req),
      dto.acceptedDocumentIds ?? [],
      { locale: dto.locale, timezone: dto.timezone },
    );
    // Identical response whether or not the address was already registered.
    return { status: 'accepted' };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: CredentialsDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: string }> {
    const r = await this.auth.login(dto.email, dto.password, requestContext(req));
    res.cookie(COOKIE, r.refreshToken, cookieOptions);
    return { userId: r.userId };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ userId: string }> {
    const token = String(req.cookies?.[COOKIE] ?? '');
    const r = await this.auth.refresh(token, requestContext(req));
    res.cookie(COOKIE, r.refreshToken, cookieOptions);
    return { userId: r.userId };
  }

  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Redeem an email verification token. Single use.' })
  async verifyEmail(@Body() dto: TokenDto, @Req() req: Request): Promise<{ status: string }> {
    await this.auth.verifyEmail(dto.token, requestContext(req));
    return { status: 'verified' };
  }

  @Post('verify-email/resend')
  @HttpCode(202)
  @ApiOperation({ summary: 'Re-send verification. Always 202 — never reveals the address state.' })
  async resendVerification(
    @Body() dto: EmailOnlyDto,
    @Req() req: Request,
  ): Promise<{ status: string }> {
    await this.auth.requestEmailVerification(dto.email, requestContext(req));
    return { status: 'accepted' };
  }

  @Post('password-reset')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request a reset link. Always 202, registered or not.' })
  async requestPasswordReset(
    @Body() dto: EmailOnlyDto,
    @Req() req: Request,
  ): Promise<{ status: string }> {
    await this.auth.requestPasswordReset(dto.email, requestContext(req));
    return { status: 'accepted' };
  }

  @Post('password-reset/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Set a new password. Revokes every existing session.' })
  async confirmPasswordReset(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: string }> {
    await this.auth.resetPassword(dto.token, dto.password, requestContext(req));
    // Every session was just revoked, this one included — drop the stale cookie rather
    // than leave the browser holding a token that can no longer work.
    res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
    return { status: 'reset' };
  }

  @Get('sessions')
  @UseGuards(ActorGuard)
  @ApiOperation({ summary: "List the caller's own active sessions." })
  async listSessions(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<{ sessions: SessionSummary[] }> {
    return { sessions: await this.auth.listSessions(actor, requestContext(req)) };
  }

  @Delete('sessions/:id')
  @UseGuards(ActorGuard)
  @HttpCode(204)
  @ApiOperation({ summary: "Revoke one of the caller's own sessions. Takes effect at once." })
  async revokeSession(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.revokeSession(actor, id, requestContext(req));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = String(req.cookies?.[COOKIE] ?? '');
    if (token) await this.auth.revoke(token, requestContext(req));
    res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
  }
}
