import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { corsResponse } from '../_shared/cors.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { buildBracketRows, ImportBracketSchema } from '../_shared/importBracket.ts';
import { normalizeName } from '../_shared/normalize.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';
import type { Database } from '../../../types/database.types.ts';

/**
 * Add past-season standings to an ALREADY-created league — the "finish history
 * later" companion to the import wizards. Same `team_seasons` rows the wizards
 * insert, but keyed off an existing league's teams and gated on commissioner
 * ownership. Upserts on (team_id, season) so re-submitting a season corrects it
 * rather than duplicating. Used by `app/add-league-history.tsx`.
 */
const HistoryTeam = z.object({
  team_name: z.string().min(1),
  wins: z.number().int().nullable().optional(),
  losses: z.number().int().nullable().optional(),
  ties: z.number().int().nullable().optional(),
  points_for: z.number().nullable().optional(),
  points_against: z.number().nullable().optional(),
  standing: z.number().int().nullable().optional(),
  division: z.number().int().min(1).max(2).nullable().optional(),
  playoff_result: z.string().nullable().optional(),
  source_name: z.string().nullable().optional(),
});

const Body = z.object({
  league_id: z.string().uuid(),
  history: z.array(z.object({
    season: z.string().min(1),
    teams: z.array(HistoryTeam).min(1),
    bracket: ImportBracketSchema.nullable().optional(),
  })).min(1),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? '',
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new HttpError('Missing authorization header', 401);
    const userClient = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new HttpError('Unauthorized', 401);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'import-league-history');
    if (rateLimited) return rateLimited;

    const { league_id, history } = parseBody(Body, await req.json());

    const { data: league, error: leagueErr } = await supabaseAdmin
      .from('leagues')
      .select('created_by, archived_at')
      .eq('id', league_id)
      .single();
    if (leagueErr || !league) throw new HttpError('League not found', 404);
    if (league.archived_at) throw new HttpError('League is archived', 409);
    if (league.created_by !== user.id) {
      throw new HttpError('Only the commissioner can add league history', 403);
    }

    const { data: teams, error: teamsErr } = await supabaseAdmin
      .from('teams')
      .select('id, name')
      .eq('league_id', league_id);
    if (teamsErr) throw teamsErr;
    if (!teams?.length) throw new HttpError('League has no teams', 409);

    // Lenient name → team-id match (names may be lightly mistyped vs. the
    // created team names) — mirrors the import wizards' fuzzyMatchTeam.
    const byExact = new Map(teams.map(t => [t.name, t.id]));
    const normalized = teams.map(t => ({ id: t.id, norm: normalizeName(t.name) }));
    const matchTeam = (name: string): string | null => {
      const exact = byExact.get(name);
      if (exact) return exact;
      const normName = normalizeName(name);
      const normMatch = normalized.find(t => t.norm === normName);
      if (normMatch) return normMatch.id;
      const contains = normalized.find(t => t.norm.includes(normName) || normName.includes(t.norm));
      if (contains) return contains.id;
      const words = normName.split(' ');
      const wordMatch = normalized.find(t => {
        const tw = t.norm.split(' ');
        return words.some(w => w.length >= 3 && tw.some(x => x.startsWith(w) || w.startsWith(x)));
      });
      return wordMatch?.id ?? null;
    };

    const rows: Database['public']['Tables']['team_seasons']['Insert'][] = [];
    const unmatched: string[] = [];
    const seasons = new Set<string>();
    for (const hs of history) {
      seasons.add(hs.season);
      for (const ht of hs.teams) {
        const teamId = matchTeam(ht.team_name);
        if (!teamId) {
          unmatched.push(ht.team_name);
          continue;
        }
        rows.push({
          team_id: teamId,
          league_id,
          season: hs.season,
          team_name: ht.source_name ?? ht.team_name,
          wins: ht.wins ?? 0,
          losses: ht.losses ?? 0,
          ties: ht.ties ?? 0,
          points_for: ht.points_for ?? 0,
          points_against: ht.points_against ?? 0,
          final_standing: ht.standing ?? 0,
          division: ht.division ?? null,
          playoff_result: ht.playoff_result ?? null,
        });
      }
    }

    if (rows.length === 0) {
      throw new HttpError('No standings rows could be matched to your league teams', 400);
    }

    // Upsert on the (team_id, season) unique key so re-adding a season corrects
    // the existing row instead of failing on the constraint.
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const { error } = await supabaseAdmin
        .from('team_seasons')
        .upsert(chunk, { onConflict: 'team_id,season' });
      if (error) throw error;
    }

    // Playoff brackets: replace-per-season so re-adding a season corrects its
    // bracket (there's no natural unique key to upsert on). Only touches seasons
    // whose submission included a bracket.
    const bracketRows = history.flatMap((hs) =>
      hs.bracket?.rounds?.length ? buildBracketRows(league_id, hs.season, hs.bracket, matchTeam) : [],
    );
    if (bracketRows.length > 0) {
      const bracketSeasons = [
        ...new Set(history.filter((h) => h.bracket?.rounds?.length).map((h) => h.season)),
      ];
      const { error: delErr } = await supabaseAdmin
        .from('playoff_bracket')
        .delete()
        .eq('league_id', league_id)
        .in('season', bracketSeasons);
      if (delErr) throw delErr;
      for (let i = 0; i < bracketRows.length; i += 100) {
        const { error } = await supabaseAdmin.from('playoff_bracket').insert(bracketRows.slice(i, i + 100));
        if (error) throw error;
      }
    }

    return jsonResponse({
      inserted: rows.length,
      seasons: Array.from(seasons),
      unmatched_teams: Array.from(new Set(unmatched)),
      brackets_imported: bracketRows.length,
    });
  } catch (error) {
    return handleError(error, 'import-league-history');
  }
});
