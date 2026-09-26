'use client';

import { Eye, ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useTranslations } from 'use-intl';
import { fieldErrorKeys, type LooseT } from '@/components/form/errors';
import { Field } from '@/components/form/field';
import { FormError } from '@/components/form/form-error';
import { useSubmit } from '@/components/form/use-submit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Textarea } from '@/components/ui/textarea';
import { callApi } from '@/lib/api/browser';
import { uploadMedia } from '@/lib/api/media';
import type { OwnAgencyProfile } from '@/lib/api/types';
import { AgencyProfileCard } from './agency-profile-card';
import { ImageField } from './image-field';
import { clean, isDirty, projection, savedText, type ProfileText } from './projection';

const PROFILE = '/agencies/current/profile';

/** What each thing publishing still needs is called — written out whole for the catalog check. */
const MISSING: Readonly<Record<OwnAgencyProfile['missing'][number], string>> = {
  agency_setup: 'error.validation.agency_profile.agency_setup',
  headline: 'error.validation.agency_profile.headline',
};

/**
 * The agency's public profile (T-094): its text, logo and cover, whether it is published, and a
 * preview of exactly what customers see — the public projection, built from the saved profile and
 * the text as typed, drawn by the component the public page uses.
 *
 * Every write names the version read. Each answer is the profile as saved, and becomes the version
 * the next write names; a write refused because someone else saved first says to reload.
 */
export function ProfileEditor({
  initial,
  registeredName,
}: {
  initial: OwnAgencyProfile;
  /** What customers see while no display name is set. */
  registeredName: string;
}) {
  const t = useTranslations('agency.profile');
  const tl = useTranslations() as unknown as LooseT;
  const router = useRouter();
  const aboutId = useId();
  const [profile, setProfile] = useState(initial);
  const [text, setText] = useState<ProfileText>(() => savedText(initial));
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = isDirty(profile, text);
  const published = profile.publishedAt !== null;

  const saved = (next: OwnAgencyProfile, message: string) => {
    setProfile(next);
    setNotice(message);
    router.refresh();
  };

  const patch = (body: Record<string, unknown>) =>
    callApi<OwnAgencyProfile>(PROFILE, {
      method: 'PATCH',
      body: { version: profile.version, ...body },
    });

  const edit = useSubmit(
    () =>
      patch({
        displayName: clean(text.displayName),
        headline: clean(text.headline),
        about: clean(text.about),
      }),
    (next) => {
      setText(savedText(next!));
      saved(next!, t('saved'));
    },
  );

  const publishing = useSubmit(
    () =>
      callApi<OwnAgencyProfile>(`${PROFILE}/${published ? 'unpublish' : 'publish'}`, {
        body: { version: profile.version },
      }),
    (next) => saved(next!, next!.publishedAt === null ? t('unpublished_now') : t('published_now')),
  );

  const image = (
    field: 'logoMediaId' | 'coverMediaId',
    category: 'AGENCY_LOGO' | 'AGENCY_COVER',
  ) => ({
    onChoose: async (file: File) => {
      setNotice(null);
      const id = await uploadMedia(file, category);
      const next = await patch({ [field]: id });
      saved(next!, t('saved'));
    },
    onRemove: async () => {
      setNotice(null);
      const next = await patch({ [field]: null });
      saved(next!, t('saved'));
    },
  });

  const fields = fieldErrorKeys(edit.error, tl);
  const set = (key: keyof ProfileText) => (value: string) => {
    setNotice(null);
    setText((current) => ({ ...current, [key]: value }));
  };
  const blocked = profile.missing.length > 0 || dirty;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={published ? 'secondary' : 'outline'}>
          {published ? t('published') : t('draft')}
        </Badge>
        {published && (
          <Link
            href={`/agencies/${profile.id}`}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            <ExternalLink aria-hidden className="size-4" />
            {t('open_public')}
          </Link>
        )}
      </div>

      {notice !== null && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}

      <form onSubmit={edit.onSubmit} className="grid gap-4">
        <FormError error={edit.error} shown={['displayName', 'headline', 'about']} />
        <Field
          label={t('display_name')}
          hint={t('display_name_hint', { name: registeredName })}
          name="displayName"
          autoComplete="organization"
          maxLength={120}
          value={text.displayName}
          onChange={(e) => set('displayName')(e.target.value)}
          error={fields['displayName'] && tl(fields['displayName'])}
        />
        <Field
          label={t('headline')}
          hint={t('headline_hint')}
          name="headline"
          maxLength={160}
          value={text.headline}
          onChange={(e) => set('headline')(e.target.value)}
          error={fields['headline'] && tl(fields['headline'])}
        />
        <div className="grid gap-1.5">
          <label htmlFor={aboutId} className="text-sm font-medium">
            {t('about')}
          </label>
          <Textarea
            id={aboutId}
            name="about"
            maxLength={3000}
            rows={6}
            value={text.about}
            onChange={(e) => set('about')(e.target.value)}
            aria-invalid={fields['about'] ? true : undefined}
            aria-describedby={fields['about'] ? `${aboutId}-error` : undefined}
          />
          {fields['about'] && (
            <p id={`${aboutId}-error`} className="text-sm text-danger">
              {tl(fields['about'])}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={edit.pending || !dirty} aria-busy={edit.pending}>
            {t('save')}
          </Button>
          <Drawer direction="bottom">
            <DrawerTrigger asChild>
              <Button type="button" variant="outline">
                <Eye aria-hidden />
                {t('preview')}
              </Button>
            </DrawerTrigger>
            <DrawerContent aria-describedby="agency-preview-body">
              <DrawerHeader>
                <DrawerTitle>{t('preview_title')}</DrawerTitle>
                <DrawerClose asChild>
                  <Button variant="ghost" size="icon" aria-label={t('close')}>
                    <X aria-hidden />
                  </Button>
                </DrawerClose>
              </DrawerHeader>
              <DrawerDescription id="agency-preview-body" className="px-4">
                {t('preview_body')}
              </DrawerDescription>
              <div className="overflow-y-auto p-4">
                <div className="mx-auto max-w-2xl rounded-lg border border-border p-4">
                  <AgencyProfileCard profile={projection(profile, text, registeredName)} />
                </div>
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      </form>

      <ImageField kind="logo" image={profile.logo} {...image('logoMediaId', 'AGENCY_LOGO')} />
      <ImageField kind="cover" image={profile.cover} {...image('coverMediaId', 'AGENCY_COVER')} />

      <form onSubmit={publishing.onSubmit} className="grid gap-3 border-t border-border pt-6">
        <FormError error={publishing.error} />
        {!published && profile.missing.length > 0 && (
          <div className="grid gap-1 text-sm">
            <p className="font-medium">{t('missing')}</p>
            <ul className="list-disc ps-5">
              {profile.missing.map((m) => (
                <li key={m}>{tl(MISSING[m])}</li>
              ))}
            </ul>
          </div>
        )}
        {!published && dirty && (
          <p id="agency-publish-unsaved" className="text-sm text-text-muted">
            {t('unsaved')}
          </p>
        )}
        <Button
          type="submit"
          variant={published ? 'outline' : 'default'}
          className="sm:justify-self-start"
          disabled={publishing.pending || (!published && blocked)}
          aria-busy={publishing.pending}
          aria-describedby={!published && dirty ? 'agency-publish-unsaved' : undefined}
        >
          {published ? t('unpublish') : t('publish')}
        </Button>
      </form>
    </div>
  );
}
