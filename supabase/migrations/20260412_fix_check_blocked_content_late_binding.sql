-- Fix latent bug in check_blocked_content() trigger function.
--
-- The prior version referenced NEW.content / NEW.type / NEW.team_id /
-- NEW.conversation_id directly inside the chat_messages branch. PL/pgSQL
-- validates those field references against the actual trigger row type at
-- parse time — which blew up on the first insert into any non-chat_messages
-- table (leagues, teams, commissioner_polls, commissioner_surveys,
-- survey_questions) with: ERROR 42703 "record 'new' has no field 'content'".
--
-- Fix: cast NEW to jsonb once and use ->> field access. jsonb field lookup
-- is late-bound and tolerant of missing keys, so unreachable branches no
-- longer poison expression parsing.

CREATE OR REPLACE FUNCTION public.check_blocked_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  normalized text;
  no_spaces text;
  check_text text;
  recent_concat text;
  new_json jsonb := to_jsonb(NEW);
  blocked_pattern text := '\m(nigger|nigga|niggas|niga|nigg|chink|gook|spic|wetback|kike|beaner|coon|darkie|raghead|towelhead|sandnigger|faggot|faggit|fag|fags|dyke|retard|retarded|retards|tranny|cunt|heil hitler|sieg heil|white power|white supremacy|gas the jews)\M';
  blocked_substring text := '(nigger|nigga|niggas|niga|nigg|chink|gook|spic|wetback|kike|beaner|coon|darkie|raghead|towelhead|sandnigger|faggot|faggit|fag|fags|dyke|retard|retarded|retards|tranny|cunt)';
  opt text;
BEGIN
  IF TG_TABLE_NAME = 'chat_messages' THEN
    check_text := new_json->>'content';
    IF (new_json->>'type') IS DISTINCT FROM 'text' THEN
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'teams' THEN
    check_text := new_json->>'name';
  ELSIF TG_TABLE_NAME = 'leagues' THEN
    check_text := new_json->>'name';
  ELSIF TG_TABLE_NAME = 'commissioner_polls' THEN
    check_text := new_json->>'question';
    IF (new_json->'options') IS NOT NULL THEN
      FOR opt IN SELECT jsonb_array_elements_text(new_json->'options')
      LOOP
        check_text := check_text || ' ' || opt;
      END LOOP;
    END IF;
  ELSIF TG_TABLE_NAME = 'commissioner_surveys' THEN
    check_text := coalesce(new_json->>'title', '') || ' ' || coalesce(new_json->>'description', '');
  ELSIF TG_TABLE_NAME = 'survey_questions' THEN
    check_text := coalesce(new_json->>'prompt', '');
    IF (new_json->'options') IS NOT NULL THEN
      FOR opt IN SELECT jsonb_array_elements_text(new_json->'options')
      LOOP
        check_text := check_text || ' ' || opt;
      END LOOP;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  IF check_text IS NULL OR trim(check_text) = '' THEN
    RETURN NEW;
  END IF;

  IF lower(check_text) ~* blocked_pattern THEN
    RAISE EXCEPTION 'Content contains prohibited language' USING ERRCODE = 'check_violation';
  END IF;

  normalized := lower(check_text);
  normalized := translate(normalized, '01345@!|$+({<7l', 'oieasaiistcccti');
  normalized := regexp_replace(normalized, '(.)\1{2,}', '\1\1', 'g');
  normalized := regexp_replace(normalized, '[^a-z0-9\s]', '', 'g');
  normalized := regexp_replace(normalized, '\s+', ' ', 'g');
  normalized := trim(normalized);

  IF normalized ~* blocked_pattern THEN
    RAISE EXCEPTION 'Content contains prohibited language' USING ERRCODE = 'check_violation';
  END IF;

  no_spaces := regexp_replace(normalized, '\s', '', 'g');
  IF no_spaces ~* blocked_substring THEN
    RAISE EXCEPTION 'Content contains prohibited language' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_TABLE_NAME = 'chat_messages' AND length(trim(new_json->>'content')) <= 3 THEN
    SELECT string_agg(content, '' ORDER BY created_at ASC)
    INTO recent_concat
    FROM (
      SELECT content, created_at
      FROM chat_messages
      WHERE conversation_id = (new_json->>'conversation_id')::uuid
        AND team_id = (new_json->>'team_id')::uuid
        AND type = 'text'
        AND length(trim(content)) <= 3
        AND created_at > now() - interval '2 minutes'
      ORDER BY created_at DESC
      LIMIT 10
    ) sub;

    recent_concat := lower(coalesce(recent_concat, '') || (new_json->>'content'));
    recent_concat := regexp_replace(recent_concat, '[^a-z]', '', 'g');

    IF recent_concat ~* blocked_substring THEN
      RAISE EXCEPTION 'Content contains prohibited language' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
