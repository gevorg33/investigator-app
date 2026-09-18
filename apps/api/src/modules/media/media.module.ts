import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { storageFromEnv } from './cloudinary.storage';
import { MediaController } from './media.controller';
import { OwnMediaRepository, ViewableMediaRepository } from './media.repository';
import { MediaService } from './media.service';
import { MEDIA_STORAGE } from './media.storage';

@Module({
  // For the shared rate limiter.
  imports: [AuthModule],
  controllers: [MediaController],
  providers: [
    MediaService,
    OwnMediaRepository,
    ViewableMediaRepository,
    { provide: MEDIA_STORAGE, useFactory: () => storageFromEnv(process.env) },
  ],
  // Verification review opens documents through the same authorized, audited delivery path as
  // everything else — one place that issues signed links, not a second one beside it.
  exports: [MediaService],
})
export class MediaModule {}
