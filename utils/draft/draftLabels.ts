/**
 * Naming for the two drafts a league can run.
 *
 * Every league has a `drafts` row of `type='initial'`, but what that draft IS
 * depends on the league type: a dynasty league runs it once to stock the
 * league (a startup draft), while redraft/keeper leagues clear rosters and
 * rebuild through the same row every year (a season draft). Dynasty leagues
 * additionally run an annual `type='rookie'` draft.
 *
 * Settings surfaces mix both drafts' fields, so the label has to say which one
 * is being configured — a bare "Draft Order" is ambiguous when a league has two.
 */

/** Display name for a league's `type='initial'` draft. */
export function initialDraftLabel(leagueType: string | null | undefined): string {
  return (leagueType ?? 'dynasty').toLowerCase() === 'dynasty' ? 'Startup Draft' : 'Season Draft';
}
