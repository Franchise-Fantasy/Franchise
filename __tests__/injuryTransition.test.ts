import {
  INJURY_STATUS_LABEL,
  describeInjuryTransition,
} from '../supabase/functions/_shared/injuryStatus';

describe('describeInjuryTransition', () => {
  it('says "upgraded" when the player gets closer to playing', () => {
    expect(describeInjuryTransition('Darius Acuff', 'QUES', 'PROB')).toBe(
      'Darius Acuff upgraded from Questionable to Probable',
    );
    expect(describeInjuryTransition('Jalen Green', 'OUT', 'DOUBT')).toBe(
      'Jalen Green upgraded from Out to Doubtful',
    );
  });

  it('says "downgraded" when the player gets further from playing', () => {
    expect(describeInjuryTransition('Darius Acuff', 'QUES', 'OUT')).toBe(
      'Darius Acuff downgraded from Questionable to Out',
    );
    expect(describeInjuryTransition('Jalen Green', 'PROB', 'DOUBT')).toBe(
      'Jalen Green downgraded from Probable to Doubtful',
    );
  });

  it('announces a new injury on a previously healthy player', () => {
    expect(describeInjuryTransition('Darius Acuff', 'active', 'QUES')).toBe(
      'Darius Acuff listed as Questionable',
    );
    expect(describeInjuryTransition('Jalen Green', 'active', 'OUT')).toBe(
      'Jalen Green listed as Out',
    );
  });

  it('announces a recovery with the status the player came back from', () => {
    expect(describeInjuryTransition('Darius Acuff', 'OUT', 'active')).toBe(
      'Darius Acuff cleared to play (was Out)',
    );
    expect(describeInjuryTransition('Jalen Green', 'QUES', 'active')).toBe(
      'Jalen Green cleared to play (was Questionable)',
    );
  });

  it('avoids upgrade/downgrade wording between equally-severe statuses', () => {
    // OUT and SUSP both mean "not playing" — neither is a downgrade of the other.
    expect(describeInjuryTransition('Darius Acuff', 'OUT', 'SUSP')).toBe(
      'Darius Acuff now Suspended',
    );
    expect(describeInjuryTransition('Darius Acuff', 'SUSP', 'OUT')).toBe(
      'Darius Acuff now Out',
    );
  });

  it('falls back to the raw token for an unknown status', () => {
    expect(describeInjuryTransition('Darius Acuff', 'QUES', 'GTD')).toBe(
      'Darius Acuff upgraded from Questionable to GTD',
    );
  });

  it('labels every status poll-injuries can write', () => {
    for (const status of ['OUT', 'SUSP', 'DOUBT', 'QUES', 'PROB', 'active']) {
      expect(INJURY_STATUS_LABEL[status]).toBeTruthy();
    }
  });
});
