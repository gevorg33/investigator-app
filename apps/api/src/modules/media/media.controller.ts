import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { AuthorizeUploadDto } from './media.dto';
import {
  MediaService,
  type CompletedUpload,
  type DeliveryUrl,
  type UploadAuthorization,
} from './media.service';

@ApiTags('media')
@Controller('media')
@UseGuards(ActorGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  @ApiOperation({ summary: 'Authorize an upload. Returns signed fields for a direct upload.' })
  async authorize(
    @CurrentActor() actor: Actor,
    @Body() dto: AuthorizeUploadDto,
    @Req() req: Request,
  ): Promise<UploadAuthorization> {
    return this.media.authorizeUpload(actor, dto, requestContext(req));
  }

  @Post('uploads/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm an upload. The server reads the asset back and validates it.' })
  async complete(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<CompletedUpload> {
    return this.media.completeUpload(actor, id, requestContext(req));
  }

  @Get(':id/delivery-url')
  // A signed link must not survive in a browser or proxy cache past the request.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'A five-minute link to a file the caller may see. Audited.' })
  async deliveryUrl(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
  ): Promise<DeliveryUrl> {
    return this.media.getDeliveryUrl(actor, id, requestContext(req));
  }
}
