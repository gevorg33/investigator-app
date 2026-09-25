import { catalogs } from '@investigator/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiError } from '@/test/api';
import { application } from '@/test/fixtures';
import { renderIntl } from '@/test/intl';
import { router } from '@/test/navigation';
import {
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS,
  uploadDocument,
  VerificationSection,
} from './verification-section';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).nextNavigation);

const en = catalogs.en.investigator.verification;
const STORAGE = 'https://storage.test/upload';

/** A file of this type and size; its bytes are never read. */
const file = (name: string, type = 'application/pdf', size = 1_000) => {
  const f = new File(['x'], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

/** What the storage provider was sent, and how it answers. */
const storage = { sent: [] as FormData[], status: 200 };

/** The API stand-in, and storage beside it: an upload goes straight to storage, never the API. */
const install = () => {
  api.install();
  storage.sent = [];
  storage.status = 200;
  const toApi = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (!String(input).startsWith(STORAGE)) return toApi(input, init);
      storage.sent.push(init!.body as FormData);
      return new Response(null, { status: storage.status });
    }),
  );
};

/** The API authorising one upload, and hearing it has finished. */
const authorise = (assetId: string) => {
  api.on('POST /media/uploads', 201, {
    assetId,
    upload: { url: STORAGE, fields: { signature: `sig-${assetId}`, timestamp: '1' } },
  });
  api.on(`POST /media/uploads/${assetId}/complete`, 200, { id: assetId });
};

const section = (applications = [] as ReturnType<typeof application>[]) =>
  renderIntl(<VerificationSection applications={applications} />);
const input = () => document.querySelector<HTMLInputElement>('input[type=file]')!;
const choose = (...files: File[]) => userEvent.setup({ applyAccept: false }).upload(input(), files);
const submit = () => userEvent.setup().click(screen.getByRole('button', { name: en.submit }));

beforeEach(() => {
  install();
  router.reset();
});

describe('a verification document upload', () => {
  it('is authorised by the API, sent straight to storage, then confirmed', async () => {
    authorise('asset-9');
    const pdf = file('passport.pdf', 'application/pdf', 2_048);
    expect(await uploadDocument(pdf)).toBe('asset-9');
    expect(api.calls.map((c) => [c.path, c.body])).toEqual([
      [
        '/media/uploads',
        { category: 'VERIFICATION_DOCUMENT', mimeType: 'application/pdf', bytes: 2_048 },
      ],
      ['/media/uploads/asset-9/complete', undefined],
    ]);
    const sent = storage.sent[0]!;
    expect(sent.get('signature')).toBe('sig-asset-9');
    expect(sent.get('timestamp')).toBe('1');
    expect((sent.get('file') as File).name).toBe('passport.pdf');
  });

  it('fails, and is never confirmed, when storage refuses the file', async () => {
    authorise('asset-9');
    storage.status = 400;
    await expect(uploadDocument(file('passport.pdf'))).rejects.toMatchObject({
      status: 400,
      code: 'UPLOAD_FAILED',
    });
    expect(api.calls.map((c) => c.path)).toEqual(['/media/uploads']);
  });

  it('takes what the media policy takes', () => {
    expect(DOCUMENT_TYPES).toEqual(['application/pdf', 'image/jpeg', 'image/png']);
    expect(MAX_DOCUMENT_BYTES).toBe(15 * 1024 * 1024);
    expect(MAX_DOCUMENTS).toBe(10);
  });
});

describe('verification', () => {
  it('invites a first application', () => {
    section();
    expect(screen.getByText(en.none)).toBeVisible();
    expect(screen.getByRole('heading', { name: en.apply_title })).toBeVisible();
    expect(screen.getByRole('button', { name: en.submit })).toBeDisabled();
    expect(input()).toHaveAttribute('accept', 'application/pdf,image/jpeg,image/png');
  });

  it('shows each decision with its date and reason, and never who made it', () => {
    section([
      application({
        id: 'v-1',
        status: 'REJECTED',
        decision: {
          outcome: 'REJECTED',
          reason: 'The document was unreadable.',
          decidedAt: '2026-09-21T08:00:00.000Z',
        },
      }),
      application({
        id: 'v-2',
        status: 'APPROVED',
        submittedAt: '2026-09-22T08:00:00.000Z',
        decision: {
          outcome: 'APPROVED',
          reason: 'Licence confirmed.',
          decidedAt: '2026-09-23T08:00:00.000Z',
        },
      }),
    ]);
    const [rejected, approved] = within(
      screen.getByRole('region', { name: en.history }),
    ).getAllByRole('listitem');
    expect(rejected).toHaveTextContent('Submitted Sep 20, 2026');
    expect(rejected).toHaveTextContent('Decided Sep 21, 2026');
    expect(within(rejected!).getByText(en.outcome_REJECTED)).toHaveAttribute(
      'data-variant',
      'warning',
    );
    expect(within(rejected!).getByRole('definition')).toHaveTextContent(
      'The document was unreadable.',
    );
    expect(within(approved!).getByText(en.outcome_APPROVED)).toHaveAttribute(
      'data-variant',
      'default',
    );
    // Decided applications only: another may be made.
    expect(screen.getByRole('heading', { name: en.apply_title })).toBeVisible();
  });

  it('says an open application is under review, and offers no second one', () => {
    section([application()]);
    expect(screen.getByText(en.pending, { selector: '[data-slot=badge]' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(en.open);
    expect(screen.queryByRole('button', { name: en.submit })).toBeNull();
  });

  it('refuses a file it cannot take, says which and why, and keeps the rest', async () => {
    section();
    await choose(
      file('notes.txt', 'text/plain'),
      file('scan.png', 'image/png', MAX_DOCUMENT_BYTES + 1),
      file('passport.pdf'),
      file('licence.jpg', 'image/jpeg'),
    );
    const problems = screen.getByRole('alert');
    expect(
      within(problems)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['notes.txt is not a PDF, JPG or PNG.', 'scan.png is over 15 MB.']);
    expect(screen.getByText('passport.pdf')).toBeVisible();
    expect(screen.getByText('licence.jpg')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove passport.pdf' }));
    expect(screen.queryByText('passport.pdf')).toBeNull();
    // A good choice clears what the last one said.
    await choose(file('id.png', 'image/png'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the first ten documents', async () => {
    section();
    await choose(...Array.from({ length: 11 }, (_, i) => file(`page-${i}.pdf`)));
    expect(screen.getByRole('alert')).toHaveTextContent(en.too_many);
    expect(screen.getAllByRole('button', { name: /^Remove page-/ })).toHaveLength(10);
    expect(screen.queryByText('page-10.pdf')).toBeNull();
  });

  it('does nothing when the picker is closed without a choice', () => {
    section();
    fireEvent.change(input(), { target: { files: null } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: en.submit })).toBeDisabled();
  });

  it('uploads each document, then applies with them all', async () => {
    authorise('asset-1');
    api.on('POST /verification/me/requests', 201, application());
    section();
    await choose(file('passport.pdf'), file('licence.png', 'image/png'));
    await submit();
    expect(api.calls.at(-1)).toMatchObject({
      path: '/verification/me/requests',
      body: { documentIds: ['asset-1', 'asset-1'] },
    });
    expect(storage.sent).toHaveLength(2);
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByText('passport.pdf')).toBeNull();
  });

  it('shows which document is uploading, and nothing can be removed meanwhile', async () => {
    api.on('POST /media/uploads', 201, { assetId: 'a', upload: { url: STORAGE, fields: {} } });
    const release = api.hold('POST /media/uploads/a/complete', 200, {});
    api.on('POST /verification/me/requests', 201, application());
    section();
    await choose(file('passport.pdf'), file('licence.pdf'));
    await submit();
    expect(await screen.findByRole('status')).toHaveTextContent('Uploading passport.pdf');
    expect(screen.getByRole('button', { name: 'Remove licence.pdf' })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.submit })).toHaveAttribute('aria-busy', 'true');
    release();
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('says an upload failed, with a reference, and lets it be tried again', async () => {
    api.on(
      'POST /media/uploads',
      500,
      apiError('INTERNAL_ERROR', 'error.common.internal', { correlationId: 'ref-42' }),
    );
    section();
    await choose(file('passport.pdf'));
    await submit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(catalogs.en.error.common.internal);
    expect(alert).toHaveTextContent('ref-42');
    // Never left looking like it is still uploading.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove passport.pdf' })).toBeEnabled();
    expect(api.calls.map((c) => c.path)).toEqual(['/media/uploads']);
  });
});
