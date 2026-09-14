import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

/**
 * Authentication failures collapse to ONE error, deliberately.
 *
 * "No such account", "wrong password" and "account suspended" must be
 * indistinguishable to a caller, or the error itself enumerates registered
 * addresses. The real reason goes to the audit log, keyed by correlation id.
 */
export const invalidCredentials = (): AppError => new AppError(ErrorCode.UNAUTHENTICATED);
