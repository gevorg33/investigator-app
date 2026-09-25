'use client';

import { formatDateTime, type Locale } from '@investigator/i18n';
import { FileText, Upload, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ChangeEvent } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { callApi } from '@/lib/api/browser';
import { ApiError } from '@/lib/api/errors';
import type { VerificationApplication } from '@/lib/api/types';

/** What the API accepts for a verification document (media.policy.ts). */
export const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
export const MAX_DOCUMENTS = 10;

interface Authorization {
  assetId: string;
  upload: { url: string; fields: Record<string, string> };
}

/**
 * One document through the private flow (cloudinary-media): the API authorises an upload and signs
 * it; the file goes straight to storage; the API is told it is finished and checks it there. The
 * file never passes through our servers, and nothing about it is public.
 */
export async function uploadDocument(file: File): Promise<string> {
  const auth = await callApi<Authorization>('/media/uploads', {
    body: { category: 'VERIFICATION_DOCUMENT', mimeType: file.type, bytes: file.size },
  });
  const form = new FormData();
  for (const [key, value] of Object.entries(auth!.upload.fields)) form.append(key, value);
  form.append('file', file);
  const res = await fetch(auth!.upload.url, { method: 'POST', body: form });
  if (!res.ok) throw new ApiError(res.status, 'UPLOAD_FAILED', 'error.common.internal');
  await callApi(`/media/uploads/${encodeURIComponent(auth!.assetId)}/complete`);
  return auth!.assetId;
}

/**
 * Verification (T-123, T-013): every application with its decision and the reason given — never who
 * decided — and, when none is open, a way to apply with documents.
 */
export function VerificationSection({
  applications,
}: {
  applications: readonly VerificationApplication[];
}) {
  const t = useTranslations('investigator.verification');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const open = applications.some((a) => a.status === 'SUBMITTED');
  const date = (iso: string) => formatDateTime(iso, { locale, timeZone: 'UTC', style: 'date' });

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = [...(event.target.files ?? [])];
    event.target.value = '';
    const issues: string[] = [];
    const ok = chosen.filter((f) => {
      if (!(DOCUMENT_TYPES as readonly string[]).includes(f.type)) {
        issues.push(t('wrong_type', { name: f.name }));
        return false;
      }
      if (f.size > MAX_DOCUMENT_BYTES) {
        issues.push(t('too_big', { name: f.name }));
        return false;
      }
      return true;
    });
    const next = [...files, ...ok];
    if (next.length > MAX_DOCUMENTS) issues.push(t('too_many'));
    setFiles(next.slice(0, MAX_DOCUMENTS));
    setProblems(issues);
  };

  const { pending, error, onSubmit } = useSubmit(
    async () => {
      const ids: string[] = [];
      try {
        for (const file of files) {
          setUploading(file.name);
          ids.push(await uploadDocument(file));
        }
      } finally {
        // A failed upload is reported as the form's error, never left looking like it is running.
        setUploading(null);
      }
      return callApi('/verification/me/requests', { body: { documentIds: ids } });
    },
    () => {
      setFiles([]);
      router.refresh();
    },
  );

  return (
    <div className="grid gap-6">
      {applications.length === 0 ? (
        <p className="text-sm text-text-muted">{t('none')}</p>
      ) : (
        <section aria-labelledby="applications-title" className="grid gap-2">
          <h3 id="applications-title" className="text-sm font-semibold">
            {t('history')}
          </h3>
          <ul className="grid gap-2">
            {applications.map((a) => (
              <li key={a.id} className="grid gap-1 rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-text-muted">
                    {t('submitted', { date: date(a.submittedAt) })}
                  </span>
                  {a.decision === null ? (
                    <Badge variant="outline">{t('pending')}</Badge>
                  ) : (
                    <Badge variant={a.decision.outcome === 'APPROVED' ? 'default' : 'warning'}>
                      {t(`outcome_${a.decision.outcome}`)}
                    </Badge>
                  )}
                </div>
                {a.decision !== null && (
                  <>
                    <p className="text-text-muted">
                      {t('decided', { date: date(a.decision.decidedAt) })}
                    </p>
                    <dl className="grid gap-0.5">
                      <dt className="font-medium">{t('reason')}</dt>
                      <dd>{a.decision.reason}</dd>
                    </dl>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {open ? (
        <p role="status" className="rounded-md bg-primary-subtle p-3 text-sm text-primary">
          {t('open')}
        </p>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4 rounded-lg border border-border p-4">
          <div className="grid gap-1">
            <h3 className="font-semibold">{t('apply_title')}</h3>
            <p className="text-sm text-text-muted">{t('apply_body')}</p>
          </div>
          <FormError error={error} />
          {problems.length > 0 && (
            <ul role="alert" className="grid gap-1 text-sm text-danger">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border-control px-4 text-sm font-medium hover:bg-surface-sunken">
            <Upload aria-hidden className="size-4" />
            {t('files')}
            <input
              type="file"
              multiple
              accept={DOCUMENT_TYPES.join(',')}
              onChange={choose}
              className="sr-only"
            />
          </label>
          {files.length > 0 && (
            <ul className="grid gap-2">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-3 rounded-md border border-border p-2 pl-3 text-sm"
                >
                  <FileText aria-hidden className="size-4 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {uploading === f.name ? (
                    <span role="status" className="text-text-muted">
                      {t('uploading', { name: f.name })}
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={pending}
                      aria-label={t('remove', { name: f.name })}
                      onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}
                    >
                      <X aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Button type="submit" disabled={files.length === 0 || pending} aria-busy={pending}>
            {t('submit')}
          </Button>
        </form>
      )}
    </div>
  );
}
