import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
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
import type { DeliveryUrl } from '../media/media.service';
import { DecideVerificationDto, QueueQueryDto, SubmitVerificationDto } from './verification.dto';
import {
  VerificationService,
  type ApplicantRequestView,
  type QueuePage,
  type ReviewView,
  type TrailEntry,
} from './verification.service';

/**
 * Investigator verification: the applicant's two routes and the reviewer's four.
 *
 * The reviewer's routes live under `verification/requests` and require the VERIFICATION staff
 * scope; the console that uses them is its own task. Nothing here lists applications across
 * profiles for anyone else.
 */
@ApiTags('verification')
@Controller('verification')
@UseGuards(ActorGuard)
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post('me/requests')
  @ApiOperation({
    summary: 'Apply for verification with uploaded documents.',
    description:
      'Documents are the caller’s own finished VERIFICATION_DOCUMENT uploads. What was declared ' +
      '— specialties and service areas — is read from the profile and frozen onto the ' +
      'application. One open application at a time.',
  })
  async submit(
    @CurrentActor() actor: Actor,
    @Body() dto: SubmitVerificationDto,
    @Req() req: Request,
  ): Promise<ApplicantRequestView> {
    return this.verification.submit(actor, dto, requestContext(req));
  }

  @Get('me/requests')
  @ApiOperation({ summary: 'The caller’s own applications, newest first, with decision reasons.' })
  async listMine(
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<ApplicantRequestView[]> {
    return this.verification.listMine(actor, requestContext(req));
  }

  @Get('requests')
  @ApiOperation({ summary: 'Open applications, oldest first. VERIFICATION staff scope.' })
  async queue(
    @CurrentActor() actor: Actor,
    @Query() query: QueueQueryDto,
    @Req() req: Request,
  ): Promise<QueuePage> {
    return this.verification.queue(actor, query, requestContext(req));
  }

  @Get('requests/:id')
  @ApiOperation({
    summary: 'One application, its documents and the profile’s full decision trail.',
  })
  async getForReview(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<ReviewView> {
    return this.verification.getForReview(actor, id, requestContext(req));
  }

  @Post('requests/:id/decision')
  @ApiOperation({
    summary: 'Approve or reject an application, whole, with a reason the applicant is shown.',
    description: 'A reviewer cannot decide their own application. A request is decided once.',
  })
  async decide(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecideVerificationDto,
    @Req() req: Request,
  ): Promise<TrailEntry> {
    return this.verification.decide(actor, id, dto, requestContext(req));
  }

  @Get('requests/:id/documents/:assetId/delivery-url')
  // A signed link must not survive in a browser or proxy cache past the request.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'A five-minute link to one document of one application. Audited.' })
  async openDocument(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Req() req: Request,
  ): Promise<DeliveryUrl> {
    return this.verification.openDocument(actor, id, assetId, requestContext(req));
  }
}
