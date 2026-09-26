import { Module } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

/** An agency's teams (T-086). */
@Module({
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
