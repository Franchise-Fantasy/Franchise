import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type NotifCategory =
  | 'draft' | 'trades' | 'matchups' | 'matchup_daily' | 'waivers'
  | 'injuries' | 'playoffs' | 'commissioner' | 'league_activity'
  | 'roster_reminders' | 'lottery' | 'chat';

const CHANNEL_MAP: Record<string, string> = {
  matchup_daily: 'matchups',
  league_activity: 'league',
  roster_reminders: 'roster',
};

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
  sound?: string;
}

export async function getTokensForUsers(
  supabase: SupabaseClient,
  userIds: string[],
  category: NotifCategory,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token, preferences')
    .in('user_id', userIds);
  if (error || !data) return [];
  return data
    .filter((row: any) => row.preferences?.[category] === true)
    .map((row: any) => row.token);
}

export async function getTokensForTeams(
  supabase: SupabaseClient,
  teamIds: string[],
  category: NotifCategory,
): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const { data: teams } = await supabase.from('teams').select('user_id').in('id', teamIds);
  if (!teams || teams.length === 0) return [];
  return getTokensForUsers(supabase, teams.map((t: any) => t.user_id), category);
}

export async function getTokensForLeague(
  supabase: SupabaseClient,
  leagueId: string,
  category: NotifCategory,
): Promise<string[]> {
  const { data: teams } = await supabase.from('teams').select('user_id').eq('league_id', leagueId);
  if (!teams || teams.length === 0) return [];
  return getTokensForUsers(supabase, teams.map((t: any) => t.user_id), category);
}

// Sends push messages and returns any tokens that Expo reports as invalid.
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

export async function notifyTeams(
  supabase: SupabaseClient,
  teamIds: string[],
  category: NotifCategory,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const tokens = await getTokensForTeams(supabase, teamIds, category);
  if (tokens.length === 0) return;
  // Auto-resolve league_id so notification taps can switch league context
  let leagueId = data?.league_id;
  if (!leagueId && teamIds.length > 0) {
    const { data: team } = await supabase.from('teams').select('league_id').eq('id', teamIds[0]).single();
    leagueId = team?.league_id;
  }
  const channelId = CHANNEL_MAP[category] ?? category;
  const dead = await sendPush(tokens.map(to => ({ to, title, body, data: { ...data, league_id: leagueId, channelId }, channelId })));
  await cleanDeadTokens(supabase, dead);
}

export async function notifyLeague(
  supabase: SupabaseClient,
  leagueId: string,
  category: NotifCategory,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const tokens = await getTokensForLeague(supabase, leagueId, category);
  if (tokens.length === 0) return;
  const channelId = CHANNEL_MAP[category] ?? category;
  const dead = await sendPush(tokens.map(to => ({ to, title, body, data: { ...data, league_id: leagueId, channelId }, channelId })));
  await cleanDeadTokens(supabase, dead);
}
