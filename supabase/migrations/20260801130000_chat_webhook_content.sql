-- Carry the message body in the chat webhook payload.
--
-- Chat pushes were being sent TWICE: once client-side from useSendMessage's
-- fan-out (to every other member, no offline filter) and once from
-- webhook-notify's handleChatMessage (to offline members only). The webhook is
-- the better sender — it runs regardless of whether the app backgrounds
-- mid-send, and it knows the conversation type so DMs can route to their own
-- notification category. The only thing it lacked was the message text, so its
-- body was a generic "New message" while the client's had a real preview.
--
-- With content + the sender's team name available here, the client fan-out is
-- removed and this becomes the single sender.
--
-- content is truncated to 200 chars in SQL: the push body is clipped to ~100
-- anyway, and there's no reason to ship a long message through net.http_post.

CREATE OR REPLACE FUNCTION notify_chat_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'vault', 'net', 'extensions' AS $$
BEGIN
  PERFORM net.http_post(
    url := get_vault_secret('project_url') || '/functions/v1/webhook-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', get_vault_secret('webhook_secret')
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'chat_messages',
      'schema', 'public',
      'record', jsonb_build_object(
        'id', NEW.id,
        'conversation_id', NEW.conversation_id,
        'team_id', NEW.team_id,
        'league_id', NEW.league_id,
        'type', NEW.type,
        'content', left(coalesce(NEW.content, ''), 200)
      )
    ),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
END $$;
