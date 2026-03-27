import { getEligiblePositions } from '@/utils/rosterSlots';

const formatPosition = (position?: string | null): string => {
  if (!position) return '—';
  const parts = position.split('-');
  if (parts.length <= 1) return parts[0] ?? '—';
  // Keep DB order (primary position first), expand the range between them
  const eligible = getEligiblePositions(position);
  const primary = parts[0];
  // Move the DB's primary position to the front
  const reordered = [primary, ...eligible.filter(p => p !== primary)];
  return reordered.join('/');
};

export { formatPosition };
