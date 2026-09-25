import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { navigate } from '@/lib/navigate';
import { FormError } from './form-error';
import { useSubmit } from './use-submit';

function Probe({ action }: { action: () => Promise<unknown> }) {
  const { pending, error, onSubmit } = useSubmit(action, () => undefined);
  return (
    <form onSubmit={onSubmit}>
      <FormError error={error} />
      <button type="submit">{pending ? 'busy' : 'go'}</button>
    </form>
  );
}

describe('console forms', () => {
  it('shows a key the catalog lacks as the generic message — never the raw key', () => {
    render(<FormError error={new ApiError(400, 'ODD', 'error.somewhere.else')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on our side.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('error.somewhere.else');
  });

  it('sends once at a time, and reports a dropped connection as an error', async () => {
    let release!: () => void;
    const action = vi.fn(
      () =>
        new Promise((_, reject) => {
          release = () => reject(new TypeError('Failed to fetch'));
        }),
    );
    render(<Probe action={action} />);
    await userEvent.click(screen.getByRole('button'));
    await userEvent.click(screen.getByRole('button', { name: 'busy' }));
    expect(action).toHaveBeenCalledTimes(1);
    release();
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side.');
  });

  it('navigates with a full page load', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { assign });
    navigate('/sign-in');
    expect(assign).toHaveBeenCalledWith('/sign-in');
    vi.unstubAllGlobals();
  });
});
