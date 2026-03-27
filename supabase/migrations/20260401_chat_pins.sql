-- Pinned messages in chat (commissioner-only action)
CREATE TABLE chat_pins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  pinned_by UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(message_id)
);

-- Index for fetching pins per conversation
CREATE INDEX idx_chat_pins_conversation ON chat_pins(conversation_id, created_at DESC);

-- RLS
ALTER TABLE chat_pins ENABLE ROW LEVEL SECURITY;

-- All conversation members can read pins
CREATE POLICY "Members can read pins" ON chat_pins
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.conversation_id = chat_pins.conversation_id
        AND cm.team_id IN (
          SELECT t.id FROM teams t WHERE t.user_id = auth.uid()
        )
    )
  );

-- Only commissioner can insert/delete pins
CREATE POLICY "Commissioner can pin" ON chat_pins
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_conversations cc
      JOIN leagues l ON l.id = cc.league_id
      WHERE cc.id = chat_pins.conversation_id
        AND l.created_by = auth.uid()
    )
  );

CREATE POLICY "Commissioner can unpin" ON chat_pins
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM chat_conversations cc
      JOIN leagues l ON l.id = cc.league_id
      WHERE cc.id = chat_pins.conversation_id
        AND l.created_by = auth.uid()
    )
  );
