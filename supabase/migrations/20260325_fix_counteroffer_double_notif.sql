-- Skip webhook notification for counteroffers — the client already sends
-- a "Counteroffer Received" notification with the correct message.
-- Without this guard, counteroffers fire TWO push notifications (one from
-- the DB trigger and one from the client).

CREATE OR REPLACE FUNCTION notify_trade_proposed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'vault', 'net', 'extensions' AS $$
BEGIN
  -- Counteroffers are handled by the client with a dedicated message
  IF NEW.counteroffer_of IS NOT NULL THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := get_vault_secret('project_url') || '/functions/v1/webhook-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', get_vault_secret('webhook_secret')
    ),
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'trade_proposals',
      'schema', 'public',
      'record', jsonb_build_object(
        'id', NEW.id,
        'league_id', NEW.league_id,
        'proposed_by_team_id', NEW.proposed_by_team_id
      )
    ),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
END $$;
