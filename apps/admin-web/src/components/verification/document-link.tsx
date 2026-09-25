'use client';

import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { FormError } from '@/components/form/form-error';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';
import { callApi } from '@/lib/api/browser';

/**
 * Opening one document of one application (T-070) — only through the audited, per-application
 * route, which records the opening and hands back a five-minute link.
 *
 * The link is used and forgotten: never rendered, never kept in state, never cached (the request
 * is the browser's, uncached). A tab is opened on the click itself — a popup opened after an
 * `await` is blocked — cut off from this page (`opener = null`, so the document cannot reach
 * back), and sent to the link when it arrives; if none arrives, the tab is closed. If the browser
 * blocks the tab, no link is asked for at all.
 */
export function DocumentLink({ requestId, assetId, n }: { requestId: string; assetId: string; n: number }) {
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState(false);

  const open = async () => {
    setError(null);
    setPending(true);
    const tab = window.open('about:blank', '_blank');
    // Blocked: ask for no link — each one is an audited opening, and this one would open nothing.
    if (tab === null) {
      setError(new ApiError(0, 'POPUP_BLOCKED', 'review.documents.blocked'));
      setPending(false);
      return;
    }
    tab.opener = null;
    try {
      const { signedUrl } = (await callApi<{ signedUrl: string }>(
        `/verification/requests/${encodeURIComponent(requestId)}/documents/${encodeURIComponent(assetId)}/delivery-url`,
        { method: 'GET' },
      ))!;
      tab.location.href = signedUrl;
    } catch (e) {
      tab.close();
      setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'error.common.internal'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-2">
      <Button variant="outline" onClick={() => void open()} disabled={pending} aria-busy={pending} className="self-start">
        <ExternalLink aria-hidden />
        {t('review.documents.open', { n })}
      </Button>
      <FormError error={error} />
    </div>
  );
}
