import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { OwnInvestigatorProfileRepository } from '../profiles/profiles.repository';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  // MediaModule for the delivery path: documents are opened through the one place that signs
  // links and re-checks scan status, never a second one.
  imports: [MediaModule],
  controllers: [VerificationController],
  // The repository is stateless; declared here as QuotesModule does, rather than widening
  // ProfilesModule's exports.
  providers: [VerificationService, OwnInvestigatorProfileRepository],
})
export class VerificationModule {}
