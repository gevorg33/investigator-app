import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

type DependencyStatus = 'up' | 'down' | 'not_configured';

interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  uptimeSeconds: number;
  dependencies: Record<string, DependencyStatus>;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Service and dependency status' })
  check(): HealthResponse {
    // Dependencies are reported as not_configured until T-003 provisions them.
    // Reporting 'up' for something unverified would make this endpoint a liar.
    const dependencies: Record<string, DependencyStatus> = {
      database: 'not_configured',
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
}
