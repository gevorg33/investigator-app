import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService, type RequestContext } from './auth.service';
import { CredentialsDto } from './auth.dto';
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
  async register(@Body() dto: CredentialsDto, @Req() req: Request): Promise<{ status: string }> {
    await this.auth.register(dto.email, dto.password, ctx(req));
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
    const r = await this.auth.login(dto.email, dto.password, ctx(req));
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
    const r = await this.auth.refresh(token, ctx(req));
    res.cookie(COOKIE, r.refreshToken, cookieOptions);
    return { userId: r.userId };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = String(req.cookies?.[COOKIE] ?? '');
    if (token) await this.auth.revoke(token, ctx(req));
    res.clearCookie(COOKIE, { ...cookieOptions, maxAge: undefined });
  }
}

function ctx(req: Request): RequestContext {
  // pino-http sets req.id, typed as string | number. Normalised to string here so
  // the correlation id has one shape everywhere it travels.
  const id: unknown = (req as unknown as { id?: unknown }).id;
  return {
    ip: req.ip,
    userAgent: req.get('user-agent'),
    correlationId: typeof id === 'string' || typeof id === 'number' ? String(id) : undefined,
  };
}
