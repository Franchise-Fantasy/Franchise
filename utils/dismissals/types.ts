/**
 * The one-time UI surfaces that persist "already seen" state per account.
 * Mirrors the `kind` CHECK constraint on `public.user_dismissals` — the two
 * move together or an insert fails at the DB.
 */
export type DismissalKind =
  | 'announcement'
  | 'matchup_result'
  | 'home_banner'
  | 'coach_mark';

/** Cache-set membership key. Kinds have independent id spaces. */
export function dismissalKey(kind: DismissalKind, itemId: string): string {
  return `${kind}:${itemId}`;
}

/**
 * The roster tap-to-move hint is scoped per team — joining a new league is a
 * fresh context worth re-explaining, unlike the app-wide CoachMark ids.
 */
export function rosterTapHintId(teamId: string): string {
  return `roster-tap-move:${teamId}`;
}
