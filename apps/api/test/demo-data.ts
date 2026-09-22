import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/database/schema';
import { testPool } from './db';
import { assignment, investigationSource } from './assignment-fixtures';
import { customerProfile } from './profile-fixtures';
import { eligibleInvestigator, quotableMission, submittedQuote } from './quote-fixtures';
import { agency, member } from './workspace-fixtures';

/**
 * `pnpm fixtures:load` — a small, coherent world, built by the factories the tests use (T-042).
 *
 * Two jobs, and the second is the reason it runs in CI. Locally it gives a database with
 * something in it to click through. In CI it is the only thing that exercises the factories
 * against a database that was migrated from empty minutes earlier, so a factory that has
 * drifted from a constraint — a mission the database now calls incomplete, an agency missing a
 * field T-083 made mandatory — fails here, loudly, instead of in whichever spec happens to
 * touch it next.
 *
 * It writes as the owner, because that is what a fixture does (T-073), and it goes to whatever
 * `MIGRATION_DATABASE_URL` names: the real development or CI database, never a worker's copy.
 * Nothing here is a test double. Every row satisfies the same constraints a real one does.
 *
 * **No real or realistic personal data.** Names are obviously invented and every address is on
 * `example.test`, which cannot resolve or receive mail (RFC 2606). `demo-data.spec.ts` enforces it.
 */
export async function loadDemoData(): Promise<Record<string, string>> {
  const owner = testPool({ role: 'owner', max: 2 });
  const db = drizzle(owner, { schema });
  try {
    const mission = await quotableMission(db);
    await customerProfile(db, { userId: mission.customerId });
    const investigator = await eligibleInvestigator(db);
    const quote = await submittedQuote(db, {
      missionId: mission.missionId,
      investigatorProfileId: investigator.profileId,
    });

    const hired = await assignment(db, {
      quoteId: quote.id,
      customerId: mission.customerId,
      status: 'IN_PROGRESS',
    });
    // One shared with the customer and one kept back, so both views have something to show.
    await investigationSource(db, {
      assignmentId: hired.id,
      addedBy: investigator.userId,
      shared: true,
    });
    await investigationSource(db, {
      assignmentId: hired.id,
      addedBy: investigator.userId,
      type: 'WITNESS',
      title: 'Former colleague of the subject',
    });

    // A workspace with more than one person in it, which a personal workspace cannot show.
    const employee = await member(owner, { roles: ['INVESTIGATOR'] });
    const firm = await agency(owner, [
      { userId: investigator.userId },
      { userId: employee.actor.userId, role: 'MEMBER' },
    ]);

    return {
      customer: mission.customerId,
      mission: mission.missionId,
      investigator: investigator.userId,
      quote: quote.id,
      assignment: hired.id,
      agency: firm.tenantId,
      employee: employee.actor.userId,
    };
  } finally {
    await owner.end();
  }
}

/* c8 ignore start -- the entry point; `loadDemoData` is what the spec calls. */
if (require.main === module) {
  loadDemoData()
    .then((made) => {
      for (const [what, id] of Object.entries(made)) process.stdout.write(`${what}: ${id}\n`);
    })
    .catch((e: unknown) => {
      process.stderr.write(`${String(e)}\n`);
      process.exitCode = 1;
    });
}
/* c8 ignore stop */
