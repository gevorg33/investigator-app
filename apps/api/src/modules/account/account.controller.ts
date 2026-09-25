import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/authz/actor.decorator';
import { ActorGuard } from '../../common/authz/actor.guard';
import type { Actor } from '../../common/authz/contract';
import { requestContext } from '../../common/http/request-context';
import { UpdatePreferencesDto } from './account.dto';
import { AccountService, type AccountView } from './account.service';

/** The signed-in account (T-127). There is no `/users/:id` — only "me". */
@ApiTags('account')
@Controller('me')
@UseGuards(ActorGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  @ApiOperation({
    summary: 'The signed-in account: who, which roles, and its language and time zone.',
  })
  me(@CurrentActor() actor: Actor): Promise<AccountView> {
    return this.account.me(actor);
  }

  @Patch('preferences')
  @ApiOperation({
    summary: 'Save the account’s language and time zone. Only the fields sent change.',
  })
  updatePreferences(
    @CurrentActor() actor: Actor,
    @Body() dto: UpdatePreferencesDto,
    @Req() req: Request,
  ): Promise<AccountView> {
    return this.account.updatePreferences(
      actor,
      { locale: dto.locale, timezone: dto.timezone },
      requestContext(req),
    );
  }
}
