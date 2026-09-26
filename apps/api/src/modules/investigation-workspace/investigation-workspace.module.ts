import { Module } from '@nestjs/common';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

/** The investigator's notes and work plan inside an assignment (plan.md §8, T-032). */
@Module({
  controllers: [NotesController, TasksController],
  providers: [NotesService, TasksService],
})
export class InvestigationWorkspaceModule {}
