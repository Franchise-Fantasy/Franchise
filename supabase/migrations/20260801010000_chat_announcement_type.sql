-- League-wide announcements in league chat (season over / champion crowned).
--
-- These were previously posted as type='text' with team_id = the champion's
-- team, so "🏆 SICKUNTS won the 2026 championship!" rendered as a normal chat
-- bubble attributed to SICKUNTS — it read as that team bragging rather than as
-- a league notice. Announcements now post with team_id NULL (the existing
-- system-message path used by 'rumor'/'trade_update') under their own type so
-- the client can render them as a centered banner.
ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_type_check;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_type_check
  CHECK (type = ANY (ARRAY[
    'text'::text,
    'poll'::text,
    'trade'::text,
    'rumor'::text,
    'survey'::text,
    'image'::text,
    'gif'::text,
    'trade_update'::text,
    'announcement'::text
  ]));

-- Retro-fit the ones already posted. The match is deliberately narrow: the
-- message must be the exact string advance-season generated — trophy, the
-- sending team's own name, then "won the … championship!" — so a human message
-- can't be swept up.
UPDATE chat_messages m
SET type = 'announcement', team_id = NULL
FROM teams t
WHERE m.team_id = t.id
  AND m.type = 'text'
  AND starts_with(m.content, '🏆 ' || t.name || ' won the ')
  AND m.content LIKE '%championship!%';
