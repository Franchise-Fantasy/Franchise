import { generateInviteCode } from '@/utils/league/inviteCode';

describe('generateInviteCode', () => {
  it('returns a string of the default length (8)', () => {
    expect(generateInviteCode()).toHaveLength(8);
  });

  it('respects an explicit length argument', () => {
    expect(generateInviteCode(4)).toHaveLength(4);
    expect(generateInviteCode(12)).toHaveLength(12);
    expect(generateInviteCode(0)).toBe('');
  });

  it('only uses unambiguous characters (no 0, O, 1, I, l)', () => {
    const allowed = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]+$/;
    for (let i = 0; i < 100; i++) {
      const code = generateInviteCode(20);
      expect(code).toMatch(allowed);
    }
  });

  it('is reasonably random across many calls', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) codes.add(generateInviteCode(8));
    // 200 codes from a 32^8 space should virtually never collide.
    expect(codes.size).toBeGreaterThanOrEqual(199);
  });
});
