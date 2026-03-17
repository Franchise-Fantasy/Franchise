import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type NotifCategory =
  | 'draft' | 'trades' | 'trade_block' | 'matchups' | 'matchup_daily' | 'waivers'
  | 'injuries' | 'playoffs' | 'commissioner' | 'league_activity'
  | 'roster_reminders' | 'lottery' | 'chat' | 'roster_moves';

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
}

export async function getTokensForUsers(
  supabase: SupabaseClient,
  userIds: string[],
  category: NotifCategory,
  excludeUserIds?: string[],
): Promise<string[]> {
  const filtered = excludeUserIds?.length
    ? userIds.filter(id => !excludeUserIds.includes(id))
    : userIds;
  if (filtered.length === 0) return [];
  const { data, error } = await supabase
    .from('push_tokens')
    .select('token, preferences')
    .in('user_id', filtered);
  if (error || !data) return [];
  return data
    .filter((row: any) => row.preferences?.[category] === true)
    .map((row: any) => row.token);
}

export async function getTokensForTeams(
  supabase: SupabaseClient,
  teamIds: string[],
  category: NotifCategory,
  excludeUserIds?: string[],
): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const { data: teams } = await supabase.from('teams').select('user_id').in('id', teamIds);
  if (!teams || teams.length === 0) return [];
  return getTokensForUsers(supabase, teams.map((t: any) => t.user_id), category, excludeUserIds);
}

export async function getTokensForLeague(
  supabase: SupabaseClient,
  leagueId: string,
  category: NotifCategory,
  excludeUserIds?: string[],
): Promise<string[]> {
  const { data: teams } = await supabase.from('teams').select('user_id').eq('league_id', leagueId);
  if (!teams || teams.length === 0) return [];
  return getTokensForUsers(supabase, teams.map((t: any) => t.user_id), category, excludeUserIds);
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

export async function notifyTeams(
  supabase: SupabaseClient,
  teamIds: string[],
  category: NotifCategory,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  excludeUserIds?: string[],
): Promise<void> {
  const tokens = await getTokensForTeams(supabase, teamIds, category, excludeUserIds);
  if (tokens.length === 0) return;
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
  excludeUserIds?: string[],
): Promise<void> {
  const tokens = await getTokensForLeague(supabase, leagueId, category, excludeUserIds);
  if (tokens.length === 0) return;
  const channelId = CHANNEL_MAP[category] ?? category;
  const dead = await sendPush(tokens.map(to => ({ to, title, body, data: { ...data, league_id: leagueId, channelId }, channelId })));
  await cleanDeadTokens(supabase, dead);
}
