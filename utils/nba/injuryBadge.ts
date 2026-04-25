import { INJURY_COLORS } from '@/constants/StatusColors';

export function getInjuryBadge(
  status: string,
): { label: string; color: string } | null {
  switch (status) {
    case 'OUT':
      return { label: 'OUT', color: INJURY_COLORS.out };
    case 'SUSP':
      return { label: 'SUSP', color: INJURY_COLORS.suspended };
    case 'DOUBT':
      return { label: 'DOUBT', color: INJURY_COLORS.doubtful };
    case 'QUES':
      return { label: 'QUES', color: INJURY_COLORS.questionable };
    case 'PROB':
      return { label: 'PROB', color: INJURY_COLORS.probable };
    default:
      return null;
  }
}
