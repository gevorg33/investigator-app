import { TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { t } from '@/i18n/messages';
import type { RiskBand } from '@/lib/api/types';

const VARIANT = {
  STANDARD: 'outline',
  ELEVATED: 'secondary',
  HIGH: 'warning',
  RESTRICTED: 'warning',
} as const satisfies Record<RiskBand, 'outline' | 'secondary' | 'warning'>;

/**
 * A mission's risk band (T-051), in words first: the colour only repeats what the label says, and
 * the two highest bands carry a warning mark as well, so it is never colour alone.
 */
export function BandBadge({ band }: { band: RiskBand }) {
  return (
    <Badge variant={VARIANT[band]}>
      {VARIANT[band] === 'warning' && <TriangleAlert aria-hidden />}
      {t(`moderation.band.${band}`)}
    </Badge>
  );
}
