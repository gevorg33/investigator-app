'use client';

import { ImageUp, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { useLocale, useTranslations } from 'use-intl';
import { FormError } from '@/components/form/form-error';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import type { OwnImage } from '@/lib/api/types';

/** An empty alternative: the image is decoration, and the name beside it says whose it is. */
const DECORATIVE = '';

/** What the API takes for an agency's images (media.policy.ts: `AGENCY_LOGO`, `AGENCY_COVER`). */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = { logo: 2 * 1024 * 1024, cover: 5 * 1024 * 1024 } as const;

type Kind = keyof typeof MAX_IMAGE_BYTES;

/**
 * The agency's logo or cover (T-094). The file is checked here for what the API would refuse —
 * type and size — before anything is sent, then uploaded privately and named on the profile by
 * `onChoose`. Until the upload has passed its safety check it has no link, so it is not shown —
 * here or to customers — and the field says it is waiting.
 */
export function ImageField({
  kind,
  image,
  onChoose,
  onRemove,
}: {
  kind: Kind;
  image: OwnImage | null;
  onChoose: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const t = useTranslations('agency.images');
  const locale = useLocale();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const size = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'megabyte',
    maximumFractionDigits: 0,
  }).format(MAX_IMAGE_BYTES[kind] / (1024 * 1024));

  const run = async (what: 'upload' | 'remove', action: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    setRefusal(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal'));
    } finally {
      setBusy(null);
    }
  };

  const chosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // The same file can be chosen again after a failure.
    event.target.value = '';
    if (file === undefined) return;
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setRefusal(t('wrong_type'));
      return;
    }
    if (file.size > MAX_IMAGE_BYTES[kind]) {
      setRefusal(t('too_large', { size }));
      return;
    }
    void run('upload', () => onChoose(file));
  };

  const label = kind === 'logo' ? t('logo') : t('cover');
  return (
    <div className="grid gap-2" role="group" aria-labelledby={`${id}-label`}>
      <p id={`${id}-label`} className="text-sm font-medium">
        {label}
      </p>
      <p id={`${id}-hint`} className="text-sm text-text-muted">
        {kind === 'logo' ? t('logo_hint', { size }) : t('cover_hint', { size })}
      </p>
      {image?.link != null && (
        <div
          className={
            kind === 'logo'
              ? 'relative size-16 overflow-hidden rounded-md border border-border bg-surface-raised'
              : 'relative aspect-3/1 w-full overflow-hidden rounded-md bg-surface-sunken'
          }
        >
          <Image
            src={image.link.signedUrl}
            alt={DECORATIVE}
            fill
            unoptimized
            sizes={kind === 'logo' ? '4rem' : '100vw'}
            className={kind === 'logo' ? 'object-contain' : 'object-cover'}
          />
        </div>
      )}
      {image !== null && image.link === null && (
        <p role="status" className="text-sm">
          {t('checking')}
        </p>
      )}
      <FormError error={error} />
      {refusal !== null && (
        <p role="alert" className="text-sm text-danger">
          {refusal}
        </p>
      )}
      <input
        ref={input}
        id={`${id}-file`}
        type="file"
        accept={IMAGE_TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={chosen}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null}
          aria-busy={busy === 'upload'}
          aria-describedby={`${id}-hint`}
          // Names the image as well as the action: a page has two of these buttons.
          aria-label={`${busy === 'upload' ? t('uploading') : image === null ? t('upload') : t('replace')} ${label}`}
          onClick={() => input.current?.click()}
        >
          <ImageUp aria-hidden />
          {busy === 'upload' ? t('uploading') : image === null ? t('upload') : t('replace')}
        </Button>
        {image !== null && (
          <Button
            type="button"
            variant="ghost"
            disabled={busy !== null}
            aria-busy={busy === 'remove'}
            aria-label={`${t('remove')} ${label}`}
            onClick={() => void run('remove', onRemove)}
          >
            <Trash2 aria-hidden />
            {t('remove')}
          </Button>
        )}
      </div>
    </div>
  );
}
