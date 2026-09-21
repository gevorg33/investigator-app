import { Module } from '@nestjs/common';
import { LegalModule } from '../legal/legal.module';
import { AgenciesController } from './agencies.controller';
import { AgenciesService } from './agencies.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

// Creating an agency records the terms its owner accepted, in the same transaction (T-021).
@Module({
  imports: [LegalModule],
  controllers: [WorkspacesController, AgenciesController],
  providers: [WorkspacesService, AgenciesService],
})
export class TenantsModule {}
