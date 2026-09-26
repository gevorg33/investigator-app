import { Module } from '@nestjs/common';
import { LegalModule } from '../legal/legal.module';
import { MediaModule } from '../media/media.module';
import { AgenciesController } from './agencies.controller';
import { AgenciesService } from './agencies.service';
import { AgencyProfileController } from './profile/agency-profile.controller';
import { AgencyProfileService } from './profile/agency-profile.service';
import { AgencySettingsController } from './settings/agency-settings.controller';
import { AgencySettingsService } from './settings/agency-settings.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

import { AuthModule } from '../auth/auth.module';
import {
  AcceptInvitationController,
  InvitationsController,
  MembersController,
} from './employees/employees.controller';
import { EmployeeRoles } from './employees/employee-roles';
import { InvitationsService } from './employees/invitations.service';
import { MembersService } from './employees/members.service';

// Employees (T-085) use the auth module's token issuer and rate limits.
// Creating an agency records the terms its owner accepted, in the same transaction (T-021). Its
// profile's logo and cover are signed by the one place that issues media links (T-084).
@Module({
  imports: [LegalModule, MediaModule, AuthModule],
  controllers: [
    WorkspacesController,
    MembersController,
    InvitationsController,
    AcceptInvitationController,
    AgenciesController,
    AgencyProfileController,
    AgencySettingsController,
  ],
  providers: [
    WorkspacesService,
    AgenciesService,
    AgencyProfileService,
    AgencySettingsService,
    EmployeeRoles,
    MembersService,
    InvitationsService,
  ],
})
export class TenantsModule {}
