import { supabase } from '@/lib/supabase';

export interface ScoreUpdatePayload {
  schedule_id?: string;
  team_id?: string;
  score?: number;
}

type Handler = (row: ScoreUpdatePayload) => void;

interface TopicEntry {
  channel: ReturnType<typeof supabase.channel>;
  handlers: Set<Handler>;
  teardownTimer: ReturnType<typeof setTimeout> | null;
}

const topics = new Map<string, TopicEntry>();

// Teardown is DELAYED after the last release: navigation commonly releases
// and re-acquires the same topic within seconds (week swipe, screen
// pop→push), and `supabase.removeChannel()` resolves asynchronously — an
// immediate teardown races the leave handshake, `supabase.channel(topic)`
// returns the dying channel (client dedupes by topic), its `.subscribe()`
// no-ops, and the topic would be silently dead for the rest of the session.
const TEARDOWN_GRACE_MS = 30_000;

function createEntry(topic: string): TopicEntry {
  const handlers = new Set<Handler>();
  const channel = supabase
    .channel(topic)
    .on('broadcast', { event: 'score_update' }, (message) => {
      // The trigger sends one changed row per message:
      // { schedule_id, team_id, score }.
      const row = message.payload as ScoreUpdatePayload | undefined;
      if (!row?.team_id) return;
      for (const h of handlers) h(row);
    })
    .subscribe();
  return { channel, handlers, teardownTimer: null };
}

/**
 * Ref-counted subscription to the deterministic `scores:<schedule_id>`
 * broadcast topic (fed by the week_scores DB triggers).
 *
 * Multiple screens (matchup, roster, scoreboard, playoff bracket) can listen
 * to the same schedule at once, and `supabase.channel(topic)` returns the
 * SAME underlying channel object for a repeated topic — so with naive
 * per-screen subscriptions, the first unmount's removeChannel() silently
 * killed every other screen's live score updates. One channel per topic
 * lives here; it's only torn down after a grace period with no subscribers.
 *
 * The deterministic topic is REQUIRED (it must match the DB trigger's send)
 * — broadcast channels are exempt from the uniqueChannelTopic rule.
 */
export function subscribeScoreTopic(scheduleId: string, handler: Handler): () => void {
  const topic = `scores:${scheduleId}`;
  let entry = topics.get(topic);

  // Self-heal: a closed/errored channel has already left the client's
  // registry, so building a fresh channel for the topic is safe.
  if (entry && (entry.channel.state === 'closed' || entry.channel.state === 'errored')) {
    if (entry.teardownTimer) clearTimeout(entry.teardownTimer);
    topics.delete(topic);
    supabase.removeChannel(entry.channel);
    entry = undefined;
  }

  if (!entry) {
    entry = createEntry(topic);
    topics.set(topic, entry);
  }
  if (entry.teardownTimer) {
    clearTimeout(entry.teardownTimer);
    entry.teardownTimer = null;
  }

  const active = entry;
  active.handlers.add(handler);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    active.handlers.delete(handler);
    if (active.handlers.size === 0 && topics.get(topic) === active) {
      if (active.teardownTimer) clearTimeout(active.teardownTimer);
      active.teardownTimer = setTimeout(() => {
        // Re-check under the timer: an acquire during the grace period
        // clears the timer, but guard anyway against interleavings.
        if (active.handlers.size === 0 && topics.get(topic) === active) {
          topics.delete(topic);
          supabase.removeChannel(active.channel);
        }
      }, TEARDOWN_GRACE_MS);
    }
  };
}
