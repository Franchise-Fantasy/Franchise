-- Add message-level read tracking for read receipts
ALTER TABLE public.chat_members
ADD COLUMN IF NOT EXISTS last_read_message_id uuid REFERENCES public.chat_messages(id);

CREATE INDEX IF NOT EXISTS idx_chat_members_last_read_msg
ON public.chat_members(conversation_id, last_read_message_id);
