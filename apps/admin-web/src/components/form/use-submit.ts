'use client';

import { useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api/errors';

/**
 * A form's submit: prevents the browser's own post, runs `action` with the form's data once at a
 * time, and keeps the error it failed with. A network failure — no response at all — is an error
 * too, reported like the API's own "something went wrong" rather than swallowed.
 */
export function useSubmit<T>(
  action: (form: FormData) => Promise<T>,
  onSuccess: (result: T) => void,
) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      onSuccess(await action(new FormData(event.currentTarget)));
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal'));
    } finally {
      setPending(false);
    }
  };
  return { pending, error, setError, onSubmit };
}
