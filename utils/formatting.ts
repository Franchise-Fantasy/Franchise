import { getEligiblePositions } from '@/utils/rosterSlots';

const formatPosition = (position?: string | null): string => {
  if (!position) return '—';
  return getEligiblePositions(position).join('/');
};

export { formatPosition };
