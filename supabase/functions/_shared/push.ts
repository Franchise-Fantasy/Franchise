import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type NotifCategory =
  | 'draft' | 'trades' | 'trade_rumors' | 'trade_block' | 'matchups' | 'matchup_daily' | 'waivers'
  | 'injuries' | 'playoffs' | 'commissioner' | 'league_activity'
  | 'roster_reminders' | 'lottery' | 'chat' | 'roster_moves' | 'player_news';

// Server-side mirror of DEFAULT_PREFERENCES from lib/notifications.ts.
// Used as fallback when a stored push_tokens row is missing newer keys.
const DEFAULT_PREFS: Record<string, boolean> = {
  draft: true,
  trades: true,
  trade_rumors: false,
  trade_block: true,
  matchups: true,
  matchup_daily: false,
  waivers: true,
  injuries: true,
  playoffs: true,
  commissioner: true,
  league_activity: false,
  roster_reminders: false,
  lottery: false,
  chat: false,
  roster_moves: false,
  player_news: true,
};

const CHANNEL_MAP: Record<string, string> = {
  matchup_daily: 'matchups',
  league_activity: 'league',
  roster_reminders: 'roster',
  roster_moves: 'roster_moves',
};

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
  sound?: string;
  subtitle?: string;
  priority?: 'default' | 'normal' | 'high';
}

export async function getTokensForUsers(
  supabase: SupabaseClient,
  userIds: string[],
  category: NotifCategory,
  excludeUserIds?: string[],
  leagueId?: string,
): Promise<string[]> {
  const filtered = excludeUserIds?.length
    ? userIds.filter(id => !excludeUserIds.includes(id))
    : userIds;
  if (filtered.length === 0) return [];
  const { data, error } = await supabase
    .from('push_tokens')
    .select('user_id, token, preferences, mute_all')
    .in('user_id', filtered);
  if (error || !data) return [];

  // Fetch per-league overrides if a league is specified
  let overridesMap: Record<string, Record<string, boolean>> = {};
  if (leagueId) {
    const { data: leaguePrefs } = await supabase
      .from('league_notification_prefs')
      .select('user_id, overrides')
      .eq('league_id', leagueId)
      .in('user_id', filtered);
    if (leaguePrefs) {
      for (const row of leaguePrefs) {
        overridesMap[row.user_id] = row.overrides ?? {};
      }
    }
  }

  return data
    .filter((row: any) => {
      if (row.mute_all) return false;
      const stored = row.preferences?.[category];
      const globalEnabled = stored !== undefined ? stored === true : (DEFAULT_PREFS[category] ?? false);
      const leagueOverride = overridesMap[row.user_id]?.[category];
      // League override can only disable, not enable past global
      // If global is off, notification is off regardless
      // If global is on, league override can turn it off
      if (!globalEnabled) return false;
      if (leagueOverride === false) return false;
      return true;
    })
    .map((row: any) => row.token);
}

export async function getTokensForTeams(
  supabase: SupabaseClient,
  teamIds: string[],
  category: NotifCategory,
  excludeUserIds?: string[],
  leagueId?: string,
): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const { data: teams } = await supabase.from('teams').select('user_id, league_id').in('id', teamIds);
  if (!teams || teams.length === 0) return [];
  const resolvedLeagueId = leagueId ?? teams[0]?.league_id;
  return getTokensForUsers(supabase, teams.map((t: any) => t.user_id), category, excludeUserIds, resolvedLeagueId);
}

export async function getTokensForLeague(
  supabase: SupabaseClient,
  leagueId: string,
  category: NotifCategory,
  excludeUserIds?: string[],
): Promise<string[]> {
  const { data: teams } = await supabase.from('teams').select('user_id').eq('league_id', leagueId);
  if (!teams || teams.length === 0) return [];
  return getTokensForUsers(supabase, teams.map((t: any) => t.user_id), category, excludeUserIds, leagueId);
}

export async function sendPush(messages: PushMessage | PushMessage[]): Promise<string[]> {
  const arr = Array.isArray(messages) ? messages : [messages];
  if (arr.length === 0) return [];
  const withDefaults = arr.map(m => ({ ...m, sound: m.sound ?? 'default' }));
  const deadTokens: string[] = [];
  for (let i = 0; i < withDefaults.length; i += 100) {
    const batch = withDefaults.slice(i, i + 100);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
      const json = await res.json();
      const tickets = json?.data ?? [];
      for (let j = 0; j < tickets.length; j++) {
        if (tickets[j]?.details?.error === 'DeviceNotRegistered') {
          deadTokens.push(batch[j].to);
        }
      }
    } catch (err) {
      console.warn('Push send failed (non-fatal):', err);
    }
  }
  return deadTokens;
}

async function cleanDeadTokens(supabase: SupabaseClient, tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await supabase.from('push_tokens').delete().in('token', tokens);
}

export interface NotifyOptions {
  subtitle?: string;
  priority?: 'default' | 'normal' | 'high';
}

export async function notifyTeams(
  supabase: SupabaseClient,
  teamIds: string[],
  category: NotifCategory,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  excludeUserIds?: string[],
  opts?: NotifyOptions,
): Promise<void> {
  let leagueId = data?.league_id as string | undefined;
  if (!leagueId && teamIds.length > 0) {
    const { data: team } = await supabase.from('teams').select('league_id').eq('id', teamIds[0]).single();
    leagueId = team?.league_id;
  }
  const tokens = await getTokensForTeams(supabase, teamIds, category, excludeUserIds, leagueId);
  if (tokens.length === 0) return;
  const channelId = CHANNEL_MAP[category] ?? category;
  const dead = await sendPush(tokens.map(to => ({
    to, title, body,
    data: { ...data, league_id: leagueId, channelId },
    channelId,
    ...(opts?.subtitle ? { subtitle: opts.subtitle } : {}),
    ...(opts?.priority ? { priority: opts.priority } : {}),
  })));
  await cleanDeadTokens(supabase, dead);
}

export async function notifyLeague(
  supabase: SupabaseClient,
  leagueId: string,
  category: NotifCategory,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  excludeUserIds?: string[],
  opts?: NotifyOptions,
): Promise<void> {
  const tokens = await getTokensForLeague(supabase, leagueId, category, excludeUserIds);
  if (tokens.length === 0) return;
  const channelId = CHANNEL_MAP[category] ?? category;
  const dead = await sendPush(tokens.map(to => ({
    to, title, body,
    data: { ...data, league_id: leagueId, channelId },
    channelId,
    ...(opts?.subtitle ? { subtitle: opts.subtitle } : {}),
    ...(opts?.priority ? { priority: opts.priority } : {}),
  })));
  await cleanDeadTokens(supabase, dead);
}
