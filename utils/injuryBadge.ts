export function getInjuryBadge(
  status: string,
): { label: string; color: string } | null {
  switch (status) {
    case 'OUT':
      return { label: 'OUT', color: '#dc3545' };
    case 'SUSP':
      return { label: 'SUSP', color: '#dc3545' };
    case 'DOUBT':
      return { label: 'DOUBT', color: '#e8590c' };
    case 'DTD':
      return { label: 'DTD', color: '#fd7e14' };
    case 'GTD':
      return { label: 'GTD', color: '#f59f00' };
    case 'QUES':
      return { label: 'QUES', color: '#f59f00' };
    default:
      return null;
  }
}
