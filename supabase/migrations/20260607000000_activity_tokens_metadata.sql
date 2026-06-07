-- Adds activity_tokens.metadata jsonb to carry per-activity ancillary state that
-- the Live Activity widget needs on every push (e.g., file:// URIs for team logos
-- pre-staged in the App Group container). contentState REPLACES on every APNs
-- push, so the dispatch sites must re-include these fields each time — they
-- read them back from this column rather than requiring the client to send
-- updates whenever any non-stat detail changes.

ALTER TABLE public.activity_tokens
  ADD COLUMN IF NOT EXISTS metadata jsonb;

COMMENT ON COLUMN public.activity_tokens.metadata IS
  'Per-activity payload echoed into each push contentState — currently { myLogoFileUri, opponentLogoFileUri } for App Group logo paths. Nullable; widget falls back to tricode pills when absent.';
