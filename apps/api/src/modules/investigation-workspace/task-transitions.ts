import { investigationTaskStatus } from '../../database/schema';

export type TaskStatus = (typeof investigationTaskStatus.enumValues)[number];

export const TASK_STATUSES: readonly TaskStatus[] = investigationTaskStatus.enumValues;

/**
 * How a task in an assignment's work plan may move (T-032). Only its creator moves it, so unlike
 * the assignment's machine there is no "by whom" — just which edges exist.
 *
 * A work plan is the investigator's own, and a plan changes: anything open can be started, finished
 * or dropped, work under way can be put back, and a task closed by mistake — done or cancelled —
 * can be reopened, to TODO. What is never possible is a jump that skips the reopening: a cancelled
 * task is not suddenly done.
 *
 * `keep_investigation_task_record()` (migration 0027) holds the same edges in the database, and
 * `task-transitions.spec.ts` walks every pair against both, so the two cannot drift.
 */
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  TODO: ['IN_PROGRESS', 'DONE', 'CANCELLED'],
  IN_PROGRESS: ['TODO', 'DONE', 'CANCELLED'],
  DONE: ['TODO'],
  CANCELLED: ['TODO'],
};

export function canMove(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}
