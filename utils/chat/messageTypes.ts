import type { ChatMessageType } from '@/types/chat';

/**
 * Chat message types that carry a `team_id` but are NOT personal speech.
 *
 * Two distinct kinds land here:
 *   - Official league artifacts — `poll` / `survey` (inserted with the
 *     commissioner's team_id by create-poll / create-survey) and
 *     `trade` / `trade_update` (auditable league history).
 *   - Anonymous posts — `rumor`, attributed in the UI to a "league source"
 *     but stored with the submitter's team_id so a commissioner can moderate.
 *
 * `announcement` is deliberately absent: it already stores `team_id: null`,
 * so every team_id-keyed code path skips it without needing this list.
 *
 * Consumers must treat these as authorless:
 *   - No Report / Block in the message action menu — there is no
 *     user-authored text behind them, reporting a poll only notifies the
 *     commissioner about themselves, and blocking off the back of one would
 *     silently hide league business (or, for a rumor, deanonymize the author).
 *   - Exempt from the blocked-user read filter, so blocking a member never
 *     hides league business or leaks who wrote a rumor.
 *
 * PAIRED WITH SQL: the same list is inlined into the chat read paths in
 * supabase/migrations/20260801140000_block_filter_official_exemption.sql
 * (the chat_messages SELECT policy, get_messages_page, get_conversations and
 * get_total_unread). Postgres can't import this file, so the two are kept
 * honest by the parity test in __tests__/chatMessageTypes.test.ts, which reads
 * the migration as text. Change both sides in the same commit.
 */
export const SYSTEM_AUTHORED_TYPES = [
  'poll',
  'survey',
  'trade',
  'trade_update',
  'rumor',
] as const satisfies readonly ChatMessageType[];

export function isSystemAuthored(type: ChatMessageType | undefined): boolean {
  return (SYSTEM_AUTHORED_TYPES as readonly string[]).includes(type ?? '');
}
