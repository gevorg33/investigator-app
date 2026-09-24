import { BadRequestException, HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from './app-error';
import { ErrorCode, ERROR_MESSAGE_KEY, ERROR_STATUS } from './error-codes';
import { AppExceptionFilter } from './http-exception.filter';

describe('error taxonomy', () => {
  it('defines every code the conventions require', () => {
    // docs/api/errors.md — codes that must exist before the first module.
    for (const c of [
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'VALIDATION_FAILED',
      'STATE_CONFLICT',
      'RATE_LIMITED',
      'IDEMPOTENCY_KEY_REUSED',
      'INTERNAL_ERROR',
    ]) {
      expect(ErrorCode).toHaveProperty(c);
    }
  });

  it('maps every code to a translation key, never an English sentence', () => {
    for (const key of Object.values(ERROR_MESSAGE_KEY)) {
      expect(key).toMatch(/^error\.[a-z_]+\.[a-z_]+$/);
    }
  });

  it('maps every code to a status', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it('carries the status on the thrown error', () => {
    expect(AppError.notFound().status).toBe(404);
    expect(AppError.forbidden().status).toBe(403);
    expect(AppError.stateConflict().status).toBe(409);
  });

  it('distinguishes 403 from 404 — an enumeration oracle otherwise', () => {
    expect(ERROR_STATUS.FORBIDDEN).not.toBe(ERROR_STATUS.NOT_FOUND);
  });
});

/** Runs the filter against a stand-in response and returns what it wrote. */
const respond = (exception: unknown, requestId?: string) => {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => (requestId === undefined ? {} : { id: requestId }),
    }),
  };
  new AppExceptionFilter().catch(exception, host as never);
  return {
    status: (status.mock.calls[0] as unknown[] | undefined)?.[0] as number,
    body: (json.mock.calls[0] as unknown[] | undefined)?.[0] as { error: Record<string, unknown> },
  };
};

describe('the error filter', () => {
  it('passes a domain error through with its own code and status', () => {
    const { status, body } = respond(AppError.notFound(), 'corr-1');
    expect(status).toBe(404);
    expect(body.error).toEqual({
      code: 'NOT_FOUND',
      messageKey: 'error.common.not_found',
      correlationId: 'corr-1',
    });
  });

  it('carries field issues on a domain validation error', () => {
    const details = [
      { field: 'email', code: 'INVALID', messageKey: 'error.validation.email.invalid' },
    ];
    const { status, body } = respond(AppError.validation(details));
    expect(status).toBe(422);
    expect(body.error['details']).toEqual(details);
  });

  it('omits details entirely rather than sending an empty key', () => {
    expect(respond(AppError.forbidden()).body.error).not.toHaveProperty('details');
  });

  it('reports a null correlation id when the request has none', () => {
    expect(respond(AppError.notFound()).body.error['correlationId']).toBeNull();
  });

  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'STATE_CONFLICT'],
    [429, 'RATE_LIMITED'],
    [418, 'INTERNAL_ERROR'],
    [503, 'SERVICE_UNAVAILABLE'],
    [502, 'INTERNAL_ERROR'],
  ])('maps a framework %i to %s', (httpStatus, code) => {
    const { status, body } = respond(new HttpException('x', httpStatus));
    expect(status).toBe(httpStatus);
    expect(body.error['code']).toBe(code);
  });

  it('turns the validation pipe’s messages into field issues', () => {
    const { body } = respond(
      new BadRequestException({
        message: ['email must be an email', 'password must be longer than 12 characters'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );
    expect(body.error['code']).toBe('VALIDATION_FAILED');
    expect((body.error['details'] as Array<{ field: string }>).map((d) => d.field)).toEqual([
      'email',
      'password',
    ]);
  });

  it('keeps a one-word message whole, and an empty one empty', () => {
    const { body } = respond(new BadRequestException({ message: ['required', ''] }));
    expect((body.error['details'] as Array<{ field: string }>).map((d) => d.field)).toEqual([
      'required',
      '',
    ]);
  });

  it('treats a 422 as a validation failure even with a single message', () => {
    const { body } = respond(new HttpException({ message: 'not a list' }, 422));
    expect(body.error['code']).toBe('VALIDATION_FAILED');
    expect(body.error).not.toHaveProperty('details');
  });

  it('adds no details when a 400 body has no messages', () => {
    expect(respond(new HttpException({ reason: 'x' }, 400)).body.error).not.toHaveProperty(
      'details',
    );
    expect(respond(new HttpException('plain text', 400)).body.error).not.toHaveProperty('details');
  });

  it('answers anything unrecognised as a 500 that reveals nothing', () => {
    const { status, body } = respond(new Error('SELECT * FROM users WHERE email = $1'));
    expect(status).toBe(500);
    expect(body.error['code']).toBe('INTERNAL_ERROR');
    // No SQL, no stack, no upstream text reaches the client.
    expect(JSON.stringify(body)).not.toContain('SELECT');
    expect(Object.keys(body)).toEqual(['error']);
  });
});
