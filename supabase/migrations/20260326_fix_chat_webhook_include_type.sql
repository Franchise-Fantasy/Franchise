-- Include message type in the chat webhook payload so webhook-notify can
-- skip trade/poll/survey messages (they send their own notifications).
-- Without this, record.type is always undefined and the guard never fires,
-- causing duplicate push notifications.

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
        'type', NEW.type
      )
    ),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
END $$;
