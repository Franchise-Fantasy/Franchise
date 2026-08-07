-- Fix false positives in check_blocked_content().
--
-- The third matching pass stripped EVERY space from the text and then ran a
-- substring match with no word boundaries. That flags any pair of innocent
-- words whose join happens to straddle a slur. Real casualty (2026-08-06, the
-- "NBA Dynasty" league): a commissioner could not post an offseason survey
-- because "supports picks" and "1.5 hours/pick" both contain "spic". Other
-- live examples: "raccoon"/"tycoon" -> coon, "suspicious" -> spic,
-- "half a game" -> fag, "Chicago okay" -> gook.
--
-- The pass exists to catch a slur deliberately split across whitespace
-- ("f a g g o t", "n igger"). That intent is preserved here by joining runs of
-- ADJACENT WHOLE WORDS and requiring the join to equal a blocked word exactly,
-- rather than substring-matching a fully de-spaced blob. Splitting a slur
-- always produces whole fragments, so nothing that pass caught is lost.
--
-- Mirrors containsSplitBlockedWord() in utils/moderation.ts — change both
-- together (regression coverage: __tests__/moderation.test.ts).
--
-- The chat_messages rapid-fire branch below is deliberately left as a
-- substring match: it only concatenates messages of <= 3 characters, where
-- there are no whole words to anchor on and the fragments ARE the evasion.
--
-- Also fixes a second, unrelated blocker found in the same function: the
-- options loops guarded on `(new_json->'options') IS NOT NULL`, but to_jsonb()
-- renders a NULL column as the jsonb scalar `null`, which passes that guard and
-- makes jsonb_array_elements_text raise 22023 "cannot extract elements from a
-- scalar". survey_questions.options is NULL for every free_text and rating
-- question, so any survey containing one failed to insert with a raw 500. The
-- guard is now jsonb_typeof(...) = 'array'.

CREATE OR REPLACE FUNCTION public.check_blocked_content()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized text;
  check_text text;
  recent_concat text;
  new_json jsonb := to_jsonb(NEW);
  blocked_pattern text := '\m(nigger|nigga|niggas|niga|nigg|chink|gook|spic|wetback|kike|beaner|coon|darkie|raghead|towelhead|sandnigger|faggot|faggit|fag|fags|dyke|retard|retarded|retards|tranny|cunt|heil hitler|sieg heil|white power|white supremacy|gas the jews)\M';
  blocked_substring text := '(nigger|nigga|niggas|niga|nigg|chink|gook|spic|wetback|kike|beaner|coon|darkie|raghead|towelhead|sandnigger|faggot|faggit|fag|fags|dyke|retard|retarded|retards|tranny|cunt)';
  -- Single-word entries only; multi-word phrases can never equal a space-free join.
  blocked_words text[] := ARRAY[
    'nigger','nigga','niggas','niga','nigg','chink','gook','spic','wetback',
    'kike','beaner','coon','darkie','raghead','towelhead','sandnigger',
    'faggot','faggit','fag','fags','dyke','retard','retarded','retards',
    'tranny','cunt'
  ];
  longest_blocked int := 11;  -- length('sandnigger') = 10; headroom for future terms
  words text[];
  joined text;
  i int;
  j int;
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
  ELSIF TG_TABLE_NAME = 'commissioner_announcements' THEN
    check_text := new_json->>'content';
  ELSIF TG_TABLE_NAME = 'commissioner_polls' THEN
    check_text := new_json->>'question';
    -- jsonb_typeof, not IS NOT NULL: to_jsonb() renders a NULL column as the
    -- jsonb scalar `null`, which IS NOT NULL passes, and jsonb_array_elements_text
    -- then raises 22023. survey_questions.options is NULL for free_text/rating.
    IF jsonb_typeof(new_json->'options') = 'array' THEN
      FOR opt IN SELECT jsonb_array_elements_text(new_json->'options')
      LOOP
        check_text := check_text || ' ' || opt;
      END LOOP;
    END IF;
  ELSIF TG_TABLE_NAME = 'commissioner_surveys' THEN
    check_text := coalesce(new_json->>'title', '') || ' ' || coalesce(new_json->>'description', '');
  ELSIF TG_TABLE_NAME = 'survey_questions' THEN
    check_text := coalesce(new_json->>'prompt', '');
    -- jsonb_typeof, not IS NOT NULL: to_jsonb() renders a NULL column as the
    -- jsonb scalar `null`, which IS NOT NULL passes, and jsonb_array_elements_text
    -- then raises 22023. survey_questions.options is NULL for free_text/rating.
    IF jsonb_typeof(new_json->'options') = 'array' THEN
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

  -- Slur split across whitespace: join adjacent whole words, require exact match.
  words := regexp_split_to_array(normalized, '\s+');
  FOR i IN 1 .. coalesce(array_length(words, 1), 0) LOOP
    joined := words[i];
    FOR j IN i + 1 .. coalesce(array_length(words, 1), 0) LOOP
      joined := joined || words[j];
      EXIT WHEN length(joined) > longest_blocked;
      IF joined = ANY(blocked_words) THEN
        RAISE EXCEPTION 'Content contains prohibited language' USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END LOOP;

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
