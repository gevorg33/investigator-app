import { Global, Module, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const DB = Symbol('DB');
export type Db = PostgresJsDatabase<typeof schema>;

class PoolHolder implements OnModuleDestroy {
  constructor(private readonly sql: postgres.Sql) {}
  async onModuleDestroy(): Promise<void> {
    await this.sql.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Db => {
        const url = process.env['DATABASE_URL'];
        if (!url) throw new Error('DATABASE_URL is required');
        const sql = postgres(url, {
          max: 10,
          // Query text can contain personal data; never let the driver log it.
          onnotice: () => {},
        });
        return drizzle(sql, { schema });
      },
    },
    {
      provide: PoolHolder,
      useFactory: (): PoolHolder => {
        const url = process.env['DATABASE_URL'] ?? '';
        return new PoolHolder(postgres(url, { max: 1 }));
      },
    },
  ],
  exports: [DB],
})
export class DatabaseModule {}
