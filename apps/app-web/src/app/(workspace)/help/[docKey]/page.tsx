import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { ArticleBody } from '@/components/help/article-body';
import { Page } from '@/components/page';
import { getLocale, getT } from '@/i18n/server';
import { ApiError } from '@/lib/api/errors';
import { serverApi } from '@/lib/api/server';
import type { HelpArticle } from '@/lib/api/types';
import { slug } from '@/lib/slug';

type Params = Promise<{ docKey: string }>;

/**
 * One help article (T-059) — where the assistant's citations lead. What the reader may open is
 * the API's decision, by the same rule the assistant retrieves with: another audience's article
 * is not found, exactly like one that does not exist. Each section can be linked to by its
 * heading; the first, which carries the article's own title, is its introduction. Read once per
 * request, for the title and the page alike.
 */
const read = cache(async (docKey: string): Promise<HelpArticle> => {
  const { locale } = await getLocale();
  try {
    return (await serverApi<HelpArticle>(
      `/knowledge/documents/${encodeURIComponent(docKey)}?locale=${locale}`,
    ))!;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  return { title: (await read((await params).docKey)).title };
}

export default async function HelpArticlePage({ params }: { params: Params }) {
  const [t, article] = await Promise.all([getT(), read((await params).docKey)]);
  return (
    <Page title={article.title}>
      {article.fallback && <p className="mt-2 text-sm text-text-muted">{t('help.fallback')}</p>}
      <article lang={article.locale} className="mt-6 grid gap-8">
        {article.sections.map((s, i) =>
          i === 0 && s.heading === article.title ? (
            <ArticleBody key={i} markdown={s.content} />
          ) : (
            <section
              key={i}
              id={slug(s.heading)}
              aria-labelledby={`${slug(s.heading)}-h`}
              className="grid gap-3 scroll-mt-6"
            >
              <h2 id={`${slug(s.heading)}-h`} className="text-lg font-semibold">
                {s.heading}
              </h2>
              <ArticleBody markdown={s.content} />
            </section>
          ),
        )}
      </article>
    </Page>
  );
}
