-- Allow users to delete (unsend) their own chat messages.

-- Fix FK constraints that block message deletion (NO ACTION → SET NULL)
ALTER TABLE chat_members
  DROP CONSTRAINT chat_members_last_read_message_id_fkey,
  ADD CONSTRAINT chat_members_last_read_message_id_fkey
    FOREIGN KEY (last_read_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL;

ALTER TABLE commissioner_surveys
  DROP CONSTRAINT commissioner_surveys_message_id_fkey,
  ADD CONSTRAINT commissioner_surveys_message_id_fkey
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE SET NULL;

-- RLS policy: users can only delete messages from their own teams
CREATE POLICY "Members can unsend own messages"
  ON chat_messages
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM teams t
      WHERE t.id = chat_messages.team_id
        AND t.user_id = (SELECT auth.uid())
    )
  );
