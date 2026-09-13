import type { Params } from 'nestjs-pino';
import { CORRELATION_HEADER, resolveCorrelationId } from '../correlation/correlation';

/**
 * Structured JSON logs with correlation ids.
 *
 * Redaction is not decoration. audit-logging forbids passwords, tokens, card data,
 * signed URLs and evidence content in logs, and the cheapest enforcement is to make
 * the logger incapable of emitting them.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  '*.password',
  '*.passwordHash',
  'token',
  '*.token',
  'refreshToken',
  '*.refreshToken',
  'sessionSecret',
  '*.sessionSecret',
  'secret',
  '*.secret',
  'signedUrl',
  '*.signedUrl',
  'cardNumber',
  '*.cardNumber',
  // Personal data, not a credential — and it was not listed. A logged object carrying an
  // address wrote it in the clear; found by logging a real payload through the configured
  // logger rather than checking this list for strings (T-063). The audit log records who
  // acted by id, so an address never needs to be in a log line.
  'email',
  '*.email',
];

export function loggerOptions(level: string, pretty: boolean): Params {
  return {
    pinoHttp: {
      level,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      genReqId: (req, res) => {
        const id = resolveCorrelationId(req);
        res.setHeader(CORRELATION_HEADER, id);
        return id;
      },
      customProps: (req) => ({ correlationId: (req as { id?: string }).id }),
      // Query strings can carry personal data; never log them (privacy rules).
      serializers: {
        req(req: { id: string; method: string; url: string }) {
          return { id: req.id, method: req.method, path: req.url.split('?')[0] };
        },
      },
      ...(pretty ? { transport: { target: 'pino-pretty' } } : {}),
    },
  };
}
