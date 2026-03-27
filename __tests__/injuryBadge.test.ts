import { getInjuryBadge } from '@/utils/injuryBadge';

describe('getInjuryBadge', () => {
  it('returns red badge for OUT', () => {
    const badge = getInjuryBadge('OUT');
    expect(badge).toEqual({ label: 'OUT', color: '#dc3545' });
  });

  it('returns red badge for SUSP', () => {
    const badge = getInjuryBadge('SUSP');
    expect(badge).toEqual({ label: 'SUSP', color: '#dc3545' });
  });

  it('returns dark orange badge for DOUBT', () => {
    const badge = getInjuryBadge('DOUBT');
    expect(badge).toEqual({ label: 'DOUBT', color: '#e8590c' });
  });

  it('returns amber badge for QUES', () => {
    const badge = getInjuryBadge('QUES');
    expect(badge).toEqual({ label: 'QUES', color: '#f59f00' });
  });

  it('returns green badge for PROB', () => {
    const badge = getInjuryBadge('PROB');
    expect(badge).toEqual({ label: 'PROB', color: '#51cf66' });
  });

  it('returns null for active status', () => {
    expect(getInjuryBadge('active')).toBeNull();
  });

  it('returns null for unknown status', () => {
    expect(getInjuryBadge('HEALTHY')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(getInjuryBadge('')).toBeNull();
  });
});
