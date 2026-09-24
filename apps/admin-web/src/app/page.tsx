import { Button } from '@/components/ui/button';
import { t } from '@/i18n/messages';

/**
 * The console's front door until staff sign-in and the first queue exist (T-070). It says what
 * will be here; sign-in is shown disabled rather than as a control that does nothing.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-6 px-4 py-10 md:px-8">
      <h1 className="text-2xl font-semibold">{t('home.title')}</h1>
      <p className="text-text-muted">{t('home.body')}</p>
      <Button className="self-start" disabled>
        {t('home.sign_in')}
      </Button>
    </main>
  );
}
