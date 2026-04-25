-- B4 follow-ups from the postgres advisor + the type-error sweep:
--
-- 1. Allow pending_transactions.player_id to be NULL. Trade rows in this table
--    don't reference a single player (they're a placeholder for a delayed multi-
--    asset trade), but the column is currently NOT NULL. The execute-trade
--    function works around this by inserting an as-any cast, which is a code
--    smell — the schema should match the data shape.
--
-- 2. Add covering indexes on four foreign keys flagged by `db_advisor_perf` as
--    causing seq scans on parent-row deletes / lookups. These are all real:
--      - activity_tokens.draft_id      → activity tokens deleted on draft delete
--      - chat_conversations.trade_proposal_id → chat lookup for a given trade
--      - chat_reactions.conversation_id → reactions filtered by conversation
--      - watchlist.player_id           → watchlist deletes when a player is removed

alter table public.pending_transactions
  alter column player_id drop not null;

create index if not exists idx_activity_tokens_draft_id
  on public.activity_tokens(draft_id);

create index if not exists idx_chat_conversations_trade_proposal_id
  on public.chat_conversations(trade_proposal_id);

create index if not exists idx_chat_reactions_conversation_id
  on public.chat_reactions(conversation_id);

create index if not exists idx_watchlist_player_id
  on public.watchlist(player_id);
