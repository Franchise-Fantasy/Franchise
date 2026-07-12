// Supabase-coupled news helpers shared by the player-news pollers (poll-news =
// RotoWire RSS, poll-news-google = Google News RSS). The pure, dependency-free
// text/regex helpers live in newsText.ts (unit-tested); this module adds the
// player-name index, article insertion, and push fan-out that need the DB.

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  detectMinutesRestriction,
  extractReturnEstimate,
  hashExternalId,
  matchPlayersInText as matchPlayersInTextRaw,
} from './newsText.ts';
import { normalizeName } from './normalize.ts';
import { notifyUsersBulk, type BulkUserNotification } from './push.ts';

export { extractTag, stripHtml } from './newsText.ts';

// ── Player name matching ───────────────────────

/**
 * Build normalized-name → player IDs. Single-token names are skipped — they're
 * too noisy to match safely (e.g. a last name appearing in unrelated text).
 */
export function buildPlayerNameIndex(players: { id: string; name: string }[]): Map<string, string[]> {
  const nameToIds = new Map<string, string[]>();
  for (const p of players) {
    const norm = normalizeName(p.name);
    if (norm.split(' ').length < 2) continue;
    const existing = nameToIds.get(norm) ?? [];
    existing.push(p.id);
    nameToIds.set(norm, existing);
  }
  return nameToIds;
}

export type PlayerInfo = { name: string; external_id_nba: string | null; status: string };

export interface NewsArticleInput {
  title: string;
  description: string;
  link: string;
  source: string;
  guid: string;
  pubDate: string;
}

export interface InsertArticleResult {
  inserted: boolean;
  matchedPlayerIds: string[];
}

/**
 * Insert one parsed article into player_news + player_news_mentions, matching
 * player names in its text. Shared by both pollers so the row shape, dedup
 * scheme, and matching stay identical across RotoWire and Google rows.
 *
 * `requireMatch` distinguishes the two callers: RotoWire is curated, so a
 * 0-match article is still real news and gets stored (`false`); Google results
 * can drift, so an article matching no roster name is dropped (`true`).
 */
export async function insertNewsArticle(
  supabase: SupabaseClient,
  item: NewsArticleInput,
  sport: string,
  nameToIds: ReadonlyMap<string, string[]>,
  playerById: ReadonlyMap<string, PlayerInfo>,
  requireMatch: boolean,
): Promise<InsertArticleResult> {
  const empty: InsertArticleResult = { inserted: false, matchedPlayerIds: [] };

  const publishedAt = item.pubDate ? new Date(item.pubDate) : new Date();
  if (isNaN(publishedAt.getTime())) return empty;

  const fullText = `${item.title} ${item.description}`;
  const matchedPlayerIds = matchPlayersInTextRaw(normalizeName(fullText), nameToIds);
  if (requireMatch && matchedPlayerIds.length === 0) return empty;

  const externalId = await hashExternalId(item.source, item.guid);
  const mentionedPlayers = matchedPlayerIds.map(pid => playerById.get(pid)).filter(Boolean);

  const { data: newsRow, error: newsErr } = await supabase
    .from('player_news')
    .upsert({
      external_id: externalId,
      sport,
      title: item.title.slice(0, 500),
      description: item.description ? item.description.slice(0, 1000) : null,
      link: item.link,
      source: item.source,
      published_at: publishedAt.toISOString(),
      has_minutes_restriction: detectMinutesRestriction(fullText),
      return_estimate: extractReturnEstimate(fullText),
      mentioned_players: mentionedPlayers,
    }, { onConflict: 'external_id', ignoreDuplicates: true })
    .select('id')
    .single();

  if (newsErr) {
    if (newsErr.code === 'PGRST116') return empty; // duplicate
    console.warn(`Upsert error for "${item.title.slice(0, 50)}":`, newsErr.message);
    return empty;
  }
  if (!newsRow) return empty;

  if (matchedPlayerIds.length > 0) {
    const mentions = matchedPlayerIds.map(pid => ({ news_id: newsRow.id, player_id: pid }));
    const { error: mentionErr } = await supabase
      .from('player_news_mentions')
      .upsert(mentions, { onConflict: 'news_id,player_id', ignoreDuplicates: true });
    if (mentionErr) console.warn('Mention insert error:', mentionErr.message);
  }

  return { inserted: true, matchedPlayerIds };
}

// ── Push notification fan-out ──────────────────

/**
 * Notify every user rostering a player named in a newly-inserted article.
 * Personalized per-user "New Update" notifications, batched into one bulk
 * round-trip. Returns the number of notifications dispatched.
 *
 * Called ONLY by poll-news (RotoWire). poll-news-google inserts into the same
 * feed but deliberately never pushes — its ~40-outlet volume was drowning users
 * — so player-news pushes are curated-source-only. `playerById` only needs
 * `.name`; callers pass their richer map directly (ReadonlyMap so a
 * `{ name, ...extra }` value map is still assignable).
 */
export async function notifyRosteredPlayerNews(
  supabase: SupabaseClient,
  playerIds: string[],
  playerById: ReadonlyMap<string, { name: string }>,
  articleTitleByPlayerName: ReadonlyMap<string, string>,
): Promise<number> {
  if (playerIds.length === 0) return 0;

  const { data: rosteredRows } = await supabase
    .from('league_players')
    .select('player_id, team_id, league_id')
    .in('player_id', playerIds);
  if (!rosteredRows || rosteredRows.length === 0) return 0;

  const teamIds = [...new Set(rosteredRows.map((r: any) => r.team_id))];
  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, user_id, league_id')
    .in('id', teamIds);

  const teamUserMap = new Map<string, { user_id: string; league_id: string }>();
  for (const t of (teamRows ?? []) as any[]) {
    teamUserMap.set(t.id, { user_id: t.user_id, league_id: t.league_id });
  }

  // Drop archived (soft-deleted) leagues up front so a roster spot in one never
  // contributes a player name OR becomes the deep-link league for the push — a
  // user rostering the same player in a live AND an archived league must still
  // get the news, pointed at the live league. The push sink filters archived
  // too, but it can only drop the whole message, not pick a live league.
  const leagueIds = [...new Set((teamRows ?? []).map((t: any) => t.league_id))];
  const { data: archivedRows } = await supabase
    .from('leagues')
    .select('id')
    .in('id', leagueIds)
    .not('archived_at', 'is', null);
  const archivedLeagues = new Set((archivedRows ?? []).map((l: { id: string }) => l.id));

  // user_id → distinct player names + leagues to notify about
  const userNotifs = new Map<string, { playerNames: Set<string>; leagueIds: Set<string> }>();
  for (const row of rosteredRows as any[]) {
    const team = teamUserMap.get(row.team_id);
    if (!team || archivedLeagues.has(team.league_id)) continue;
    const pName = playerById.get(row.player_id)?.name;
    if (!pName) continue;
    const existing = userNotifs.get(team.user_id) ?? { playerNames: new Set<string>(), leagueIds: new Set<string>() };
    existing.playerNames.add(pName);
    existing.leagueIds.add(team.league_id);
    userNotifs.set(team.user_id, existing);
  }

  const bulkNotifs: BulkUserNotification[] = [];
  for (const [userId, { playerNames, leagueIds }] of userNotifs) {
    const leagueId = [...leagueIds][0];
    const names = [...playerNames];
    const title = names.length === 1
      ? `${names[0]} — New Update`
      : `${names.length} Player Updates`;
    const body = names.length === 1
      ? (articleTitleByPlayerName.get(names[0]) ?? 'Tap to read the latest news')
      : `News about ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3} more` : ''}`;
    bulkNotifs.push({ userId, leagueId, title, body, data: { screen: 'news' } });
  }

  await notifyUsersBulk(supabase, 'player_news', bulkNotifs);
  return bulkNotifs.length;
}
