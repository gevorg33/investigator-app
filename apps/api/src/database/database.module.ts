import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { assertRuntimeRole } from './runtime-role';
import { scopedClient } from './scoped-client';
import * as schema from './schema';

export const DB = Symbol('DB');
export type Db = PostgresJsDatabase<typeof schema>;

/** The handle inside `db.transaction(...)`. Writes that must commit together all take this. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The one connection pool. The drizzle client and the shutdown hook both resolve this
 * token, so the pool that serves queries is the pool that gets closed.
 */
export const SQL = Symbol('SQL');
export type Sql = postgres.Sql;

/** Exported so the test suite's connection budget uses the real number, not a copy of it. */
export const POOL_MAX = 10;

export function createPool(url: string | undefined): Sql {
  if (!url) throw new Error('DATABASE_URL is required');
  return postgres(url, {
    max: POOL_MAX,
    // Query text can contain personal data; never let the driver log it.
    onnotice: () => {},
  });
}

/**
 * Ends the pool when the application stops.
 *
 * It previously built a second pool of its own (`max: 1`) and closed that one, leaving the
 * ten-connection pool drizzle actually used open after shutdown — verified by closing the
 * application and running a query through the drizzle client, which still succeeded. On a
 * deploy that is connections outliving the process that owned them.
 */
@Injectable()
export class PoolLifecycle implements OnModuleDestroy {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async onModuleDestroy(): Promise<void> {
    // Let in-flight queries finish, but never hold shutdown open indefinitely.
    await this.sql.end({ timeout: 5 });
  }
}

/**
 * The API does not start as a role row-level security would not apply to (T-073). See
 * `runtime-role.ts` for why this fails closed rather than warning.
 */
@Injectable()
export class RuntimeRoleCheck implements OnApplicationBootstrap {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async onApplicationBootstrap(): Promise<void> {
    await assertRuntimeRole(this.sql);
  }
}

@Global()
@Module({
  providers: [
    { provide: SQL, useFactory: (): Sql => createPool(process.env['DATABASE_URL']) },
    // Every query carries the execution context, when there is one (T-075).
    {
      provide: DB,
      inject: [SQL],
      useFactory: (sql: Sql): Db => drizzle(scopedClient(sql), { schema }),
    },
    PoolLifecycle,
    RuntimeRoleCheck,
  ],
  exports: [DB],
})
export class DatabaseModule {}
