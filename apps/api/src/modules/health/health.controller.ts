import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../../database/database.module';

type DependencyStatus = 'up' | 'down' | 'not_configured';

interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  uptimeSeconds: number;
  dependencies: Record<string, DependencyStatus>;
}

/**
 * How long the database may take before it counts as down. A health check that hangs for
 * the driver's thirty-second connect timeout is no use to whatever is polling it.
 */
export const DATABASE_CHECK_TIMEOUT_MS = 2000;

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  @ApiOperation({ summary: 'Service and dependency status' })
  async check(): Promise<HealthResponse> {
    const dependencies: Record<string, DependencyStatus> = {
      database: await this.database(),
      // Nothing in the application talks to Redis yet, so there is nothing to check.
      // 'not_configured' stays the truthful answer until a client exists.
      redis: 'not_configured',
    };

    const anyDown = Object.values(dependencies).includes('down');

    return {
      status: anyDown ? 'degraded' : 'ok',
      service: 'investigator-api',
      version: process.env['npm_package_version'] ?? '0.0.0',
      uptimeSeconds: Math.floor(process.uptime()),
      dependencies,
    };
  }

  /**
   * A real round trip. It reported `not_configured` until T-063, a leftover from before
   * T-003 provisioned the database — while the application was using it. Reporting a
   * dependency's state without checking it makes this endpoint a liar in either direction.
   */
  private async database(): Promise<DependencyStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<DependencyStatus>((resolve) => {
      timer = setTimeout(() => resolve('down'), DATABASE_CHECK_TIMEOUT_MS);
    });
    const probe = this.db.execute(sql`select 1`).then(
      (): DependencyStatus => 'up',
      (): DependencyStatus => 'down',
    );
    try {
      return await Promise.race([probe, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }
}
