-- ============================================================
-- Database webhook triggers using pg_net + Vault secrets
-- These fire AFTER INSERT and call the webhook-notify edge function.
-- Additive only — does not replace any existing notification logic.
-- To disable: ALTER TABLE <table> DISABLE TRIGGER <trigger_name>;
-- ============================================================

-- Store webhook secret in Vault (used to authenticate trigger calls to edge function)
-- Must match the WEBHOOK_SECRET env var set on the webhook-notify edge function
SELECT vault.create_secret('7d3aef8c-2e43-4073-bc45-262b85ab1411', 'webhook_secret');

-- Helper to retrieve secrets from Vault (avoids repeating the query)
CREATE OR REPLACE FUNCTION get_vault_secret(secret_name text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public', 'vault', 'extensions' AS $$
DECLARE
  secret_value text;
BEGIN
  SELECT decrypted_secret INTO secret_value
  FROM vault.decrypted_secrets WHERE name = secret_name;
  RETURN secret_value;
END $$;

-- 1. Trade proposal webhook: notify other teams when a trade is proposed
CREATE OR REPLACE FUNCTION notify_trade_proposed()
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

CREATE TRIGGER webhook_trade_proposed
  AFTER INSERT ON public.trade_proposals
  FOR EACH ROW
  EXECUTE FUNCTION notify_trade_proposed();

-- 2. Chat message webhook: push notify offline conversation members
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

CREATE TRIGGER webhook_chat_message
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_chat_message();
