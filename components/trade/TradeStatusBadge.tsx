import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import type { TradeStatus } from '@/types/trade';

interface TradeStatusBadgeProps {
  status: TradeStatus | string;
  size?: 'default' | 'small';
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  in_review: 'In Review',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  vetoed: 'Vetoed',
  pending_drops: 'Pending Drops',
};

// Variant rationale: solid turf/merlot for "actively in flight" states
// (accepted, vetoed) so they read with strong contrast; muted tinted chips
// for settled outcomes (completed, rejected, cancelled). The previous
// `success` variant for accepted was green-on-green on the card surface
// and hard to read.
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'warning',
  accepted: 'turf',
  in_review: 'warning',
  completed: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
  vetoed: 'merlot',
  pending_drops: 'warning',
};

/**
 * Single source of truth for a trade-status pill. Wraps the brand `Badge`
 * with the project's TradeStatus → label/variant mapping so every trade
 * surface (TradeCard, TradeDetailModal, TradeHistory, chat, etc.) reads
 * the same chrome.
 *
 * Counteroffer is a separate flag on a proposal (not a status), so it
 * renders as its own `<Badge variant="gold" label="Counteroffer" />`
 * alongside this badge — see TradeCard for the pattern.
 */
export function TradeStatusBadge({ status, size }: TradeStatusBadgeProps) {
  return (
    <Badge
      label={STATUS_LABEL[status] ?? status}
      variant={STATUS_VARIANT[status] ?? 'neutral'}
      size={size}
    />
  );
}
