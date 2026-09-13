import { ErrorCode, ERROR_STATUS, type ErrorCodeValue } from './error-codes';

export interface FieldIssue {
  field: string;
  code: string;
  messageKey: string;
}

/** Domain error carrying a stable code. Modules throw this, never a raw HttpException. */
export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly status: number;
  readonly details: FieldIssue[] | undefined;

  constructor(code: ErrorCodeValue, details?: FieldIssue[]) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }

  static notFound(): AppError {
    return new AppError(ErrorCode.NOT_FOUND);
  }
  static forbidden(): AppError {
    return new AppError(ErrorCode.FORBIDDEN);
  }
  static validation(details: FieldIssue[]): AppError {
    return new AppError(ErrorCode.VALIDATION_FAILED, details);
  }
  static stateConflict(): AppError {
    return new AppError(ErrorCode.STATE_CONFLICT);
  }
}
