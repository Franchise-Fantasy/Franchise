import { readFileSync } from 'fs';
import { join } from 'path';

import { SYSTEM_AUTHORED_TYPES, isSystemAuthored } from '../utils/chat/messageTypes';

const MIGRATION = join(
  __dirname,
  '../supabase/migrations/20260801140000_block_filter_official_exemption.sql',
);

describe('isSystemAuthored', () => {
  it('classifies official league artifacts as system-authored', () => {
    expect(isSystemAuthored('poll')).toBe(true);
    expect(isSystemAuthored('survey')).toBe(true);
    expect(isSystemAuthored('trade')).toBe(true);
    expect(isSystemAuthored('trade_update')).toBe(true);
  });

  it('classifies anonymous rumors as system-authored', () => {
    // Rumors carry the submitter's team_id; treating them as personal speech
    // is what let Block deanonymize the author.
    expect(isSystemAuthored('rumor')).toBe(true);
  });

  it('leaves personal speech reportable and blockable', () => {
    expect(isSystemAuthored('text')).toBe(false);
    expect(isSystemAuthored('image')).toBe(false);
    expect(isSystemAuthored('gif')).toBe(false);
  });

  it('does not list announcement — it already stores team_id null', () => {
    expect(isSystemAuthored('announcement')).toBe(false);
    expect(SYSTEM_AUTHORED_TYPES).not.toContain('announcement');
  });

  it('handles an undefined type (message not found in the page)', () => {
    expect(isSystemAuthored(undefined)).toBe(false);
  });
});

describe('SQL parity: block-filter exemption migration', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  // Every `type IN (...)` exemption in the migration must name exactly the
  // types in SYSTEM_AUTHORED_TYPES. Postgres can't import the TS module, so a
  // one-sided edit would silently re-hide league business (or re-open the
  // rumor deanonymization channel) with no other test failing.
  // The negative lookahead skips the unrelated, pre-existing sender-name
  // redaction (`WHEN msg.type IN (...) THEN NULL ELSE t.name`), which shares
  // the `type IN (...)` shape but hides the team NAME, not the row.
  const predicates = sql.match(/\btype IN \(([^)]*)\)(?!\s*THEN)/g) ?? [];

  it('finds the exemption predicate at every read path', () => {
    // chat_messages SELECT policy, get_messages_page, get_conversations
    // (preview CTE + unread CTE), get_total_unread.
    expect(predicates).toHaveLength(5);
  });

  it.each(predicates.map((p, i) => [i, p] as const))(
    'predicate %i matches SYSTEM_AUTHORED_TYPES',
    (_i, predicate) => {
      const types = [...predicate.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
      expect(types.sort()).toEqual([...SYSTEM_AUTHORED_TYPES].sort());
    },
  );

  it('redacts the rumor author team_id from get_messages_page', () => {
    expect(sql).toMatch(/CASE WHEN m\.type = 'rumor' THEN NULL ELSE m\.team_id END/);
  });
});

describe('push parity: webhook-notify SELF_NOTIFIED_TYPES', () => {
  const WEBHOOK = join(__dirname, '../supabase/functions/webhook-notify/index.ts');

  // The chat_messages INSERT trigger pushes a "<team>: <content>" preview for
  // any type it doesn't skip. Every system-authored type already gets a push
  // from whatever created it, and none of them store prose in `content` — so a
  // missing entry means a duplicate notification whose body is a raw UUID or
  // JSON blob. `survey` and `rumor` shipped that way.
  it('skips every system-authored type', () => {
    const src = readFileSync(WEBHOOK, 'utf8');
    const block = src.match(/const SELF_NOTIFIED_TYPES = new Set\(\[([\s\S]*?)\]\)/);
    expect(block).not.toBeNull();

    const skipped = [...block![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const type of SYSTEM_AUTHORED_TYPES) {
      expect(skipped).toContain(type);
    }
    // announcement is authorless too, just not in SYSTEM_AUTHORED_TYPES.
    expect(skipped).toContain('announcement');
  });
});
