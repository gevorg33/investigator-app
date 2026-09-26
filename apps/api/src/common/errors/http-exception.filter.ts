import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from './app-error';
import { ErrorCode, ERROR_MESSAGE_KEY, type ErrorCodeValue } from './error-codes';

/**
 * One error shape for every failure, from every module (docs/api/errors.md).
 * No stack trace, no SQL, no upstream provider text — those go to the log against
 * the correlation id, never to the client.
 */
@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();

    let code: ErrorCodeValue = ErrorCode.INTERNAL_ERROR;
    let status = 500;
    let details: unknown;

    if (exception instanceof AppError) {
      code = exception.code;
      status = exception.status;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = mapStatus(status);
      const body = exception.getResponse();
      if (status === 400 || status === 422) {
        code = ErrorCode.VALIDATION_FAILED;
        details = extractValidationDetails(body);
      }
    }

    res.status(status).json({
      error: {
        code,
        messageKey: ERROR_MESSAGE_KEY[code],
        correlationId: req.id ?? null,
        ...(details ? { details } : {}),
      },
    });
  }
}

function mapStatus(status: number): ErrorCodeValue {
  switch (status) {
    case 401:
      return ErrorCode.UNAUTHENTICATED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.STATE_CONFLICT;
    case 429:
      return ErrorCode.RATE_LIMITED;
    case 503:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}

/**
 * The field issues `validationPipe()` attached to its 400 (`common/validation/pipe.ts`), passed on
 * as they are. Any other 400 — a malformed id from `ParseUUIDPipe`, unparseable JSON — has none,
 * and says only that the request was refused.
 *
 * Issues are never recovered from the text of a message: a message can be a catalog key, which
 * names no property (T-157).
 */
function extractValidationDetails(body: unknown): unknown {
  if (typeof body === 'object' && body !== null && 'details' in body) {
    const details = (body as { details: unknown }).details;
    if (Array.isArray(details) && details.length > 0) return details;
  }
  return undefined;
}
