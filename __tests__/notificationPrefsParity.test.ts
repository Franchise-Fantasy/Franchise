import { readFileSync } from 'fs';
import { join } from 'path';

import {
  CHILD_KEYS,
  NOTIFICATION_CATEGORIES,
} from '@/constants/NotificationCategories';
import { DEFAULT_PREFERENCES } from '@/constants/NotificationPrefs';

/**
 * The notification category list exists in four places that must agree:
 *
 *   1. PushPreferences / DEFAULT_PREFERENCES  (lib/notifications.ts)
 *   2. NotifCategory / DEFAULT_PREFS          (supabase/functions/_shared/push.ts)
 *   3. NOTIFICATION_CATEGORIES enum           (supabase/functions/send-notification/index.ts)
 *   4. The settings UI                        (constants/NotificationCategories.ts)
 *
 * Drift is silent and user-visible in the worst way: a category the client shows
 * as ON that the server treats as OFF (or vice versa), or a toggle for something
 * that no longer sends. The edge files are Deno modules with remote imports, so
 * they're read as source text and parsed rather than imported.
 */

const EDGE_PUSH = readFileSync(
  join(__dirname, '../supabase/functions/_shared/push.ts'),
  'utf8',
);
const EDGE_SEND = readFileSync(
  join(__dirname, '../supabase/functions/send-notification/index.ts'),
  'utf8',
);

/** Extracts the `const DEFAULT_PREFS: Record<string, boolean> = { ... }` block. */
function parseEdgeDefaults(source: string): Record<string, boolean> {
  const block = source.match(/const DEFAULT_PREFS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!block) throw new Error('Could not locate DEFAULT_PREFS in _shared/push.ts');
  const out: Record<string, boolean> = {};
  for (const [, key, value] of block[1].matchAll(/^\s*(\w+):\s*(true|false),/gm)) {
    out[key] = value === 'true';
  }
  return out;
}

/** Extracts the union members of `type NotifCategory = 'a' | 'b' | …`. */
function parseEdgeCategories(source: string): string[] {
  const block = source.match(/type NotifCategory\s*=([\s\S]*?);/);
  if (!block) throw new Error('Could not locate NotifCategory in _shared/push.ts');
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** Extracts the Zod enum source list in send-notification. */
function parseSendNotificationCategories(source: string): string[] {
  const block = source.match(/const NOTIFICATION_CATEGORIES = \[([\s\S]*?)\] as const;/);
  if (!block) throw new Error('Could not locate NOTIFICATION_CATEGORIES in send-notification');
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

const clientKeys = Object.keys(DEFAULT_PREFERENCES).sort();

describe('notification preference parity', () => {
  it('edge DEFAULT_PREFS has exactly the client PushPreferences keys', () => {
    expect(Object.keys(parseEdgeDefaults(EDGE_PUSH)).sort()).toEqual(clientKeys);
  });

  it('edge DEFAULT_PREFS values match the client defaults', () => {
    // A mismatch means a user who never opened settings gets a different answer
    // from the server than the toggle they were shown.
    expect(parseEdgeDefaults(EDGE_PUSH)).toEqual({ ...DEFAULT_PREFERENCES });
  });

  it('NotifCategory covers exactly the client keys', () => {
    expect(parseEdgeCategories(EDGE_PUSH).sort()).toEqual(clientKeys);
  });

  it("send-notification's enum covers exactly the client keys", () => {
    expect(parseSendNotificationCategories(EDGE_SEND).sort()).toEqual(clientKeys);
  });
});

describe('notification settings UI', () => {
  it('renders a row for every preference key, with no extras', () => {
    expect(NOTIFICATION_CATEGORIES.map((c) => c.key).sort()).toEqual(clientKeys);
  });

  it('gives every category a non-empty label and description', () => {
    for (const cat of NOTIFICATION_CATEGORIES) {
      expect(cat.label.length).toBeGreaterThan(0);
      expect(cat.description.length).toBeGreaterThan(0);
    }
  });

  it('has no duplicate keys', () => {
    const keys = NOTIFICATION_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('points every parentKey at a real, top-level category', () => {
    for (const cat of NOTIFICATION_CATEGORIES) {
      if (!cat.parentKey) continue;
      const parent = NOTIFICATION_CATEGORIES.find((p) => p.key === cat.parentKey);
      expect(parent).toBeDefined();
      // A parent that is itself a child would need recursive gating in the UI.
      expect(parent!.parentKey).toBeUndefined();
    }
  });

  it("mirrors the edge PARENT_OF map, so the server gates what the UI greys out", () => {
    const block = EDGE_PUSH.match(/const PARENT_OF[^=]*=\s*\{([\s\S]*?)\n\};/);
    if (!block) throw new Error('Could not locate PARENT_OF in _shared/push.ts');
    const edgeParents: Record<string, string> = {};
    for (const [, child, parent] of block[1].matchAll(/^\s*(\w+):\s*'([a-z_]+)',/gm)) {
      edgeParents[child] = parent;
    }

    const uiParents: Record<string, string> = {};
    for (const cat of NOTIFICATION_CATEGORIES) {
      if (cat.parentKey) uiParents[cat.key] = cat.parentKey;
    }
    expect(edgeParents).toEqual(uiParents);
  });

  it('derives CHILD_KEYS from the parent wiring', () => {
    expect(CHILD_KEYS.trades?.sort()).toEqual(['trade_block', 'trade_rumors']);
    expect(CHILD_KEYS.matchups).toEqual(['matchup_closeup']);
  });
});
