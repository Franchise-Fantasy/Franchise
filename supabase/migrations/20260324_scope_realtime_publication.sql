-- Scope the realtime publication to only tables with active subscriptions.
-- This eliminates WAL processing overhead for the other ~30 tables.
-- Tables confirmed via codebase audit of .channel() / postgres_changes usage:
--   hooks/useWeekScores.ts         → week_scores
--   hooks/useAnnouncements.ts      → commissioner_announcements
--   hooks/chat/useConversations.ts  → chat_messages
--   hooks/chat/useMessages.ts       → chat_messages
--   hooks/chat/useReactions.ts      → chat_reactions
--   hooks/chat/usePolls.ts          → poll_votes
--   components/draft/DraftOrder.tsx  → drafts, draft_picks
--   components/draft/AvailablePlayers.tsx → league_players
--   components/home/DraftSection.tsx → drafts
--   hooks/usePlayoffBracket.ts        → playoff_seed_picks

DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime FOR TABLE
  week_scores,
  commissioner_announcements,
  chat_messages,
  chat_reactions,
  poll_votes,
  drafts,
  draft_picks,
  league_players,
  playoff_seed_picks;
