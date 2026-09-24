import type { ReactNode } from 'react';
import { LanguageChoice } from '@/components/language-choice';
import { getT } from '@/i18n/server';

/**
 * The signed-out screens: sign in, sign up, and the links email sends. No navigation — there is
 * nowhere to go yet — one readable column, and the language choice, which a reader needs before
 * they can read anything else.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getT();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-4 pt-6 md:px-8">
        <p className="text-lg font-semibold">{t('app.name')}</p>
      </header>
      <main id="content" className="flex flex-1 justify-center px-4 py-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="px-4 pb-safe">
        <div className="pb-6">
          <LanguageChoice compact />
        </div>
      </footer>
    </div>
  );
}
