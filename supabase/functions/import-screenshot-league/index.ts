import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { HttpError, errorResponse, handleError, jsonResponse } from '../_shared/http.ts';
import { createLogger } from '../_shared/log.ts';
import { normalizeName } from '../_shared/normalize.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const log = createLogger('import-screenshot-league');

const ImageSchema = z.object({
  base64: z.string().min(1),
  media_type: z.string().min(1),
});

const ExtractRosterBody = z.object({
  action: z.literal('extract_roster'),
  images: z.array(ImageSchema).min(1, 'At least one image is required').max(5, 'Maximum 5 images per team'),
  team_name: z.string().optional(),
});

const ExtractSettingsBody = z.object({
  action: z.literal('extract_settings'),
  images: z.array(ImageSchema).min(1, 'At least one image is required').max(3, 'Maximum 3 images for settings'),
});

const ExtractHistoryBody = z.object({
  action: z.literal('extract_history'),
  images: z.array(ImageSchema).min(1, 'At least one image is required').max(3, 'Maximum 3 images for history'),
});

const SearchOrCreatePlayerBody = z.object({
  action: z.literal('search_or_create_player'),
  name: z.string().trim().min(1, 'Player name is required'),
  position: z.string().optional(),
});

const ExecuteBody = z.object({
  action: z.literal('execute'),
  league_name: z.string().min(1, 'league_name and teams are required'),
  league_type: z.string(),
  keeper_count: z.number().nullable(),
  teams: z.array(z.object({
    team_name: z.string(),
    players: z.array(z.object({
      player_id: z.string(),
      position: z.string(),
      roster_slot: z.string().nullable(),
    })),
  })).min(1, 'league_name and teams are required'),
  roster_slots: z.array(z.object({
    position: z.string(),
    count: z.number(),
  })),
  scoring_type: z.string(),
  scoring: z.array(z.object({
    stat_name: z.string(),
    point_value: z.number(),
  })),
  categories: z.array(z.object({
    stat_name: z.string(),
    is_enabled: z.boolean(),
    inverse: z.boolean(),
  })).optional(),
  history: z.array(z.object({
    season: z.string(),
    teams: z.array(z.object({
      team_name: z.string(),
      wins: z.number().nullable(),
      losses: z.number().nullable(),
      ties: z.number().nullable(),
      points_for: z.number().nullable(),
      points_against: z.number().nullable(),
      standing: z.number().nullable(),
    })),
  })).optional(),
  settings: z.object({
    season: z.string(),
    regular_season_weeks: z.number(),
    playoff_weeks: z.number(),
    playoff_teams: z.number(),
    max_future_seasons: z.number(),
    rookie_draft_rounds: z.number(),
    rookie_draft_order: z.string(),
    lottery_draws: z.number(),
    lottery_odds: z.array(z.number()).nullable(),
    trade_veto_type: z.string(),
    trade_review_period_hours: z.number(),
    trade_votes_to_veto: z.number(),
    draft_pick_trading_enabled: z.boolean(),
    pick_conditions_enabled: z.boolean(),
    waiver_type: z.string(),
    waiver_period_days: z.number(),
    faab_budget: z.number(),
    waiver_day_of_week: z.number(),
    playoff_seeding_format: z.string(),
    reseed_each_round: z.boolean(),
    buy_in_amount: z.number().nullable(),
    trade_deadline: z.string().nullable(),
  }),
});

const Body = z.discriminatedUnion('action', [
  ExtractRosterBody,
  ExtractSettingsBody,
  ExtractHistoryBody,
  SearchOrCreatePlayerBody,
  ExecuteBody,
]);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// --- Claude Vision helpers ---

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

interface ClaudeImageSource {
  type: 'base64';
  media_type: string;
  data: string;
}

interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; source: ClaudeImageSource }
  >;
}

async function callClaudeVision(
  images: Array<{ base64: string; media_type: string }>,
  prompt: string,
  tools?: any[],
): Promise<any> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

  const content: ClaudeMessage['content'] = [];
  for (const img of images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.media_type, data: img.base64 },
    });
  }
  content.push({ type: 'text', text: prompt });

  const body: any = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content }],
  };

  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = { type: 'tool', name: tools[0].name };
  }

  const res = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error ${res.status}: ${errText}`);
  }

  const result = await res.json();

  // If tools were used, extract the tool call input
  if (tools?.length) {
    const toolBlock = result.content?.find((b: any) => b.type === 'tool_use');
    if (toolBlock) return toolBlock.input;
  }

  // Otherwise return the text content
  const textBlock = result.content?.find((b: any) => b.type === 'text');
  return textBlock?.text ?? '';
}

// --- Player matching ---

async function matchPlayers(
  extractedPlayers: Array<{ player_name: string; position: string | null; roster_slot: string | null }>,
  supabaseAdmin: any,
): Promise<{ matched: any[]; unmatched: any[] }> {
  const { data: ourPlayers } = await supabaseAdmin
    .from('players')
    .select('id, name, pro_team, position');

  const byNameOnly = new Map<string, any[]>();
  // Index by last name for abbreviated first-name matching (e.g. "S. Henderson")
  const byLastName = new Map<string, any[]>();
  for (const p of (ourPlayers ?? [])) {
    const norm = normalizeName(p.name);
    if (!byNameOnly.has(norm)) byNameOnly.set(norm, []);
    byNameOnly.get(norm)!.push(p);

    const parts = norm.split(' ');
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (!byLastName.has(last)) byLastName.set(last, []);
      byLastName.get(last)!.push(p);
    }
  }

  const matched: any[] = [];
  const unmatched: any[] = [];

  for (let i = 0; i < extractedPlayers.length; i++) {
    const ep = extractedPlayers[i];
    const norm = normalizeName(ep.player_name);

    // Try name-only match first (screenshots won't have NBA team)
    const nameHits = byNameOnly.get(norm);

    if (nameHits?.length === 1) {
      matched.push({
        index: i,
        extracted_name: ep.player_name,
        position: ep.position,
        roster_slot: ep.roster_slot,
        matched_player_id: nameHits[0].id,
        matched_name: nameHits[0].name,
        matched_team: nameHits[0].pro_team,
        matched_position: nameHits[0].position,
        confidence: 'high',
      });
      continue;
    }

    // If multiple matches, try to disambiguate by position
    if (nameHits && nameHits.length > 1 && ep.position) {
      const posMatch = nameHits.find(
        h => h.position?.toUpperCase() === ep.position?.toUpperCase()
      );
      if (posMatch) {
        matched.push({
          index: i,
          extracted_name: ep.player_name,
          position: ep.position,
          roster_slot: ep.roster_slot,
          matched_player_id: posMatch.id,
          matched_name: posMatch.name,
          matched_team: posMatch.pro_team,
          matched_position: posMatch.position,
          confidence: 'medium',
        });
        continue;
      }
    }

    // Abbreviated first name fallback (e.g. "S. Henderson" → match "Scoot Henderson")
    const parts = norm.split(' ');
    if (parts.length >= 2 && parts[0].length === 1) {
      const initial = parts[0];
      const lastName = parts[parts.length - 1];
      const lastNameHits = byLastName.get(lastName);
      if (lastNameHits) {
        // Filter to players whose first name starts with this initial
        const initialMatches = lastNameHits.filter(p => {
          const pNorm = normalizeName(p.name);
          return pNorm.startsWith(initial);
        });
        if (initialMatches.length === 1) {
          matched.push({
            index: i,
            extracted_name: ep.player_name,
            position: ep.position,
            roster_slot: ep.roster_slot,
            matched_player_id: initialMatches[0].id,
            matched_name: initialMatches[0].name,
            matched_team: initialMatches[0].pro_team,
            matched_position: initialMatches[0].position,
            confidence: 'medium',
          });
          continue;
        }
        // Multiple initial matches — try position to narrow down
        if (initialMatches.length > 1 && ep.position) {
          const posMatch = initialMatches.find(
            h => h.position?.toUpperCase() === ep.position?.toUpperCase()
          );
          if (posMatch) {
            matched.push({
              index: i,
              extracted_name: ep.player_name,
              position: ep.position,
              roster_slot: ep.roster_slot,
              matched_player_id: posMatch.id,
              matched_name: posMatch.name,
              matched_team: posMatch.pro_team,
              matched_position: posMatch.position,
              confidence: 'medium',
            });
            continue;
          }
        }
      }
    }

    unmatched.push({
      index: i,
      extracted_name: ep.player_name,
      position: ep.position,
      roster_slot: ep.roster_slot,
      confidence: nameHits ? 'low' : 'none',
    });
  }

  return { matched, unmatched };
}

// --- Tool schemas for Claude structured output ---

const ROSTER_TOOL = {
  name: 'extract_roster_data',
  description: 'Extract fantasy basketball roster data from a screenshot',
  input_schema: {
    type: 'object',
    properties: {
      players: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            player_name: {
              type: 'string',
              description: "The player's full name exactly as shown",
            },
            position: {
              type: ['string', 'null'],
              description: 'NBA position if visible (PG, SG, SF, PF, C)',
            },
            roster_slot: {
              type: ['string', 'null'],
              description: 'Fantasy roster slot if visible (PG, SG, SF, PF, C, G, F, UTIL, BE, Bench, IR)',
            },
          },
          required: ['player_name'],
        },
      },
    },
    required: ['players'],
  },
};

const SETTINGS_TOOL = {
  name: 'extract_settings_data',
  description: 'Extract fantasy basketball league settings from a screenshot',
  input_schema: {
    type: 'object',
    properties: {
      league_name: {
        type: ['string', 'null'],
        description: 'League name if visible',
      },
      team_count: {
        type: ['number', 'null'],
        description: 'Number of teams if visible',
      },
      scoring_type: {
        type: ['string', 'null'],
        description: 'Scoring type: "points" or "categories" if identifiable',
      },
      scoring_values: {
        type: ['object', 'null'],
        description: 'Scoring values as stat_name: point_value pairs. Use standard abbreviations: PTS, REB, AST, STL, BLK, TO, 3PM, 3PA, FGM, FGA, FTM, FTA, PF, DD, TD',
        additionalProperties: { type: 'number' },
      },
      roster_positions: {
        type: ['array', 'null'],
        description: 'Roster position slots with counts',
        items: {
          type: 'object',
          properties: {
            position: { type: 'string' },
            count: { type: 'number' },
          },
          required: ['position', 'count'],
        },
      },
    },
  },
};

const HISTORY_TOOL = {
  name: 'extract_history_data',
  description: 'Extract fantasy basketball standings/history from a screenshot',
  input_schema: {
    type: 'object',
    properties: {
      season: {
        type: ['string', 'null'],
        description: 'Season identifier if visible (e.g. "2024-25")',
      },
      teams: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            team_name: { type: 'string', description: 'Team or owner name' },
            wins: { type: ['number', 'null'] },
            losses: { type: ['number', 'null'] },
            ties: { type: ['number', 'null'] },
            points_for: { type: ['number', 'null'] },
            points_against: { type: ['number', 'null'] },
            standing: { type: ['number', 'null'], description: 'Rank/standing position' },
          },
          required: ['team_name'],
        },
      },
    },
    required: ['teams'],
  },
};

// --- Action handlers ---

async function handleExtractRoster(
  body: z.infer<typeof ExtractRosterBody>,
  supabaseAdmin: any,
) {
  const { images, team_name } = body;

  const teamContext = team_name ? ` for the team "${team_name}"` : '';
  const prompt = `You are extracting fantasy basketball roster data from ${images.length > 1 ? 'these screenshots' : 'this screenshot'} of a fantasy sports app${teamContext}.

Extract every player visible on the roster. For each player return:
- player_name: The player's name exactly as shown on screen. Do NOT guess or expand abbreviated names — just transcribe what you see (e.g. "S. Henderson", "L. James").
- position: Their NBA position if visible (PG, SG, SF, PF, C). If not clearly shown, use null.
- roster_slot: The fantasy roster slot if visible (PG, SG, SF, PF, C, G, F, UTIL, BE, Bench, IR). Normalize "Bench" to "BE". If not clearly shown, use null.

Important: Only extract actual NBA player names. Ignore empty roster slots, headers, labels, or UI elements.`;

  const result = await callClaudeVision(images, prompt, [ROSTER_TOOL]);
  const extractedPlayers = result.players ?? [];

  // Match against our database
  const { matched, unmatched } = await matchPlayers(extractedPlayers, supabaseAdmin);

  return jsonResponse({
    extracted_count: extractedPlayers.length,
    matched,
    unmatched,
  });
}

async function handleExtractSettings(
  body: { images: Array<{ base64: string; media_type: string }> },
) {
  const { images } = body;
  if (!images?.length) throw new HttpError('At least one image is required');
  if (images.length > 3) throw new HttpError('Maximum 3 images for settings');

  const prompt = `You are extracting fantasy basketball league settings from ${images.length > 1 ? 'these screenshots' : 'this screenshot'} of a fantasy sports app settings page.

Extract any settings you can confidently identify:
- League name and team count
- Scoring type (points-based or head-to-head categories)
- Individual scoring values for stats (PTS, REB, AST, STL, BLK, TO, 3PM, etc.)
- Roster position slot counts (how many PG, SG, SF, PF, C, G, F, UTIL, Bench, IR slots)

Only include values you can clearly read from the screenshot. Use standard stat abbreviations: PTS, REB, AST, STL, BLK, TO, 3PM, 3PA, FGM, FGA, FTM, FTA, PF, DD, TD.
For roster positions, normalize to: PG, SG, SF, PF, C, G, F, UTIL, BE, IR.`;

  const result = await callClaudeVision(images, prompt, [SETTINGS_TOOL]);
  return jsonResponse(result);
}

async function handleExtractHistory(
  body: { images: Array<{ base64: string; media_type: string }> },
) {
  const { images } = body;
  log.info('extract_history called', {
    image_count: images?.length ?? 0,
    media_types: images?.map((i) => i.media_type) ?? [],
  });
  if (!images?.length) throw new HttpError('At least one image is required');
  if (images.length > 3) throw new HttpError('Maximum 3 images for history');

  // Validate each image has base64 data
  for (let i = 0; i < images.length; i++) {
    if (!images[i].base64) throw new HttpError(`Image ${i + 1} has no base64 data`);
    if (!images[i].media_type) images[i].media_type = 'image/jpeg';
  }

  const prompt = `You are extracting fantasy basketball league standings or history from ${images.length > 1 ? 'these screenshots' : 'this screenshot'}.

For each team visible, extract:
- team_name: The team name or owner name as shown
- wins: Number of wins if visible
- losses: Number of losses if visible
- ties: Number of ties if visible
- points_for: Total points scored if visible
- points_against: Total points against if visible
- standing: Their rank/position in standings if visible or inferable from order

Extract the season identifier if visible (e.g. "2024-25", "2023-24").`;

  try {
    const result = await callClaudeVision(images, prompt, [HISTORY_TOOL]);
    log.info('extract_history result', {
      result_preview: JSON.stringify(result)?.substring(0, 500),
    });
    return jsonResponse(result);
  } catch (err) {
    log.error('extract_history Claude error', err);
    throw err;
  }
}

async function handleSearchOrCreatePlayer(
  body: { name: string; position?: string },
  supabaseAdmin: any,
) {
  const { name, position } = body;
  if (!name?.trim()) throw new HttpError('Player name is required');

  const norm = normalizeName(name);

  // Broad search: try exact normalized match, then ilike
  const { data: exactHits } = await supabaseAdmin
    .from('players')
    .select('id, name, pro_team, position')
    .ilike('name', `%${norm.split(' ').join('%')}%`)
    .limit(5);

  if (exactHits?.length) {
    return jsonResponse({ created: false, players: exactHits });
  }

  // Not found — create a new player record
  const { data: newPlayer, error } = await supabaseAdmin
    .from('players')
    .insert({
      name: name.trim(),
      position: position ?? null,
      pro_team: null,
      status: 'active',
    })
    .select('id, name, pro_team, position')
    .single();

  if (error) throw error;

  // Refresh the materialized view so the new player appears in stats
  await supabaseAdmin.rpc('refresh_player_season_stats').catch(() => {});

  return jsonResponse({ created: true, players: [newPlayer] });
}

async function handleExecute(
  body: {
    league_name: string;
    league_type: string;
    keeper_count: number | null;
    teams: Array<{
      team_name: string;
      players: Array<{ player_id: string; position: string; roster_slot: string | null }>;
    }>;
    roster_slots: Array<{ position: string; count: number }>;
    scoring_type: string;
    scoring: Array<{ stat_name: string; point_value: number }>;
    categories?: Array<{ stat_name: string; is_enabled: boolean; inverse: boolean }>;
    history?: Array<{
      season: string;
      teams: Array<{
        team_name: string;
        wins: number;
        losses: number;
        ties: number;
        points_for: number;
        points_against: number;
        standing: number;
      }>;
    }>;
    settings: {
      season: string;
      regular_season_weeks: number;
      playoff_weeks: number;
      playoff_teams: number;
      max_future_seasons: number;
      rookie_draft_rounds: number;
      rookie_draft_order: string;
      lottery_draws: number;
      lottery_odds: number[] | null;
      trade_veto_type: string;
      trade_review_period_hours: number;
      trade_votes_to_veto: number;
      draft_pick_trading_enabled: boolean;
      pick_conditions_enabled: boolean;
      waiver_type: string;
      waiver_period_days: number;
      faab_budget: number;
      waiver_day_of_week: number;
      playoff_seeding_format: string;
      reseed_each_round: boolean;
      buy_in_amount: number | null;
      trade_deadline: string | null;
    };
  },
  supabaseAdmin: any,
  userId: string,
) {
  const {
    league_name,
    league_type,
    keeper_count,
    teams,
    roster_slots,
    scoring_type,
    scoring,
    categories,
    history,
    settings,
  } = body;

  if (!league_name || !teams?.length) {
    throw new HttpError('league_name and teams are required');
  }

  log.info('execute_import called', {
    league_name,
    team_count: teams.length,
    history_count: history?.length ?? 0,
    history_preview: history ? JSON.stringify(history).substring(0, 500) : null,
  });

  // Compute roster size (exclude IR and TAXI from draft rounds)
  const rosterSize = roster_slots.reduce(
    (sum, s) => (s.position === 'IR' || s.position === 'TAXI' ? sum : sum + s.count),
    0
  );

  // Season start date
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const daysSinceMon = dow === 0 ? 6 : dow - 1;
  const daysLeft = 7 - daysSinceMon;
  let seasonStart = today;
  if (daysLeft < 5) {
    seasonStart = new Date(today);
    seasonStart.setDate(today.getDate() + (7 - daysSinceMon));
  }
  const seasonStartDate = `${seasonStart.getFullYear()}-${String(seasonStart.getMonth() + 1).padStart(2, '0')}-${String(seasonStart.getDate()).padStart(2, '0')}`;

  // 1. Create league
  const leagueInsert: any = {
    name: league_name,
    created_by: userId,
    teams: teams.length,
    current_teams: 0,
    roster_size: rosterSize,
    private: true,
    season: settings.season,
    season_start_date: seasonStartDate,
    regular_season_weeks: settings.regular_season_weeks,
    playoff_weeks: settings.playoff_weeks,
    schedule_generated: false,
    max_future_seasons: settings.max_future_seasons,
    trade_veto_type: settings.trade_veto_type,
    trade_review_period_hours: settings.trade_review_period_hours,
    trade_votes_to_veto: settings.trade_votes_to_veto,
    trade_deadline: settings.trade_deadline,
    draft_pick_trading_enabled: settings.draft_pick_trading_enabled,
    pick_conditions_enabled: settings.pick_conditions_enabled,
    rookie_draft_rounds: settings.rookie_draft_rounds,
    rookie_draft_order: settings.rookie_draft_order,
    lottery_draws: settings.lottery_draws,
    lottery_odds: settings.lottery_odds,
    playoff_teams: settings.playoff_teams,
    waiver_type: settings.waiver_type,
    waiver_period_days: settings.waiver_period_days,
    faab_budget: settings.faab_budget,
    waiver_day_of_week: settings.waiver_day_of_week,
    playoff_seeding_format: settings.playoff_seeding_format,
    reseed_each_round: settings.reseed_each_round,
    buy_in_amount: settings.buy_in_amount,
    imported_from: 'screenshots',
    league_type: league_type,
    scoring_type: scoring_type === 'categories' ? 'h2h_categories' : 'points',
  };

  if (league_type === 'keeper' && keeper_count) {
    leagueInsert.keeper_count = keeper_count;
  }

  const { data: leagueData, error: leagueError } = await supabaseAdmin
    .from('leagues')
    .insert(leagueInsert)
    .select('id')
    .single();

  if (leagueError) throw leagueError;
  const leagueId = leagueData.id;

  // 2. Insert roster config
  const rosterConfigRows = roster_slots
    .filter(s => s.count > 0)
    .map(s => ({
      league_id: leagueId,
      position: s.position,
      slot_count: s.count,
    }));

  if (rosterConfigRows.length > 0) {
    const { error } = await supabaseAdmin.from('league_roster_config').insert(rosterConfigRows);
    if (error) throw error;
  }

  // 3. Insert scoring settings
  if (scoring_type === 'categories' && categories?.length) {
    const catRows = categories.map(c => ({
      league_id: leagueId,
      stat_name: c.stat_name,
      point_value: 0,
      is_enabled: c.is_enabled,
      inverse: c.inverse,
    }));
    const { error } = await supabaseAdmin.from('league_scoring_settings').insert(catRows);
    if (error) throw error;
  } else {
    const scoringRows = scoring.map(s => ({
      league_id: leagueId,
      stat_name: s.stat_name,
      point_value: s.point_value,
    }));
    if (scoringRows.length > 0) {
      const { error } = await supabaseAdmin.from('league_scoring_settings').insert(scoringRows);
      if (error) throw error;
    }
  }

  // 4. Create teams and assign rosters
  const teamIds: string[] = [];
  const teamNameToId = new Map<string, string>();
  const timestamp = new Date().toISOString();
  const leaguePlayerRows: any[] = [];

  for (const team of teams) {
    const { data: teamData, error: teamError } = await supabaseAdmin
      .from('teams')
      .insert({
        league_id: leagueId,
        user_id: null,
        name: team.team_name,
        tricode: team.team_name.substring(0, 3).toUpperCase(),
        is_commissioner: false,
        sleeper_roster_id: -1,
        wins: 0,
        losses: 0,
        ties: 0,
        points_for: 0,
        points_against: 0,
      })
      .select('id')
      .single();

    if (teamError) throw teamError;
    teamIds.push(teamData.id);
    teamNameToId.set(team.team_name, teamData.id);

    // Build roster entries for this team
    let utilIndex = 0;
    for (const player of team.players) {
      let slot = player.roster_slot ?? 'BE';

      // Normalize roster slot
      if (slot.toUpperCase() === 'BENCH') slot = 'BE';
      if (slot.toUpperCase() === 'UTIL') {
        utilIndex++;
        slot = `UTIL${utilIndex}`;
      }

      leaguePlayerRows.push({
        league_id: leagueId,
        team_id: teamData.id,
        player_id: player.player_id,
        position: player.position,
        roster_slot: slot.toUpperCase(),
        acquired_via: 'draft',
        acquired_at: timestamp,
        on_trade_block: false,
      });
    }
  }

  // Update current_teams
  await supabaseAdmin
    .from('leagues')
    .update({ current_teams: teams.length })
    .eq('id', leagueId);

  // Insert roster players in chunks
  for (let i = 0; i < leaguePlayerRows.length; i += 100) {
    const chunk = leaguePlayerRows.slice(i, i + 100);
    const { error } = await supabaseAdmin.from('league_players').insert(chunk);
    if (error) throw error;
  }

  // 5. Create draft (marked complete)
  const { error: draftError } = await supabaseAdmin
    .from('drafts')
    .insert({
      league_id: leagueId,
      season: settings.season,
      type: 'initial',
      status: 'complete',
      rounds: rosterSize,
      picks_per_round: teams.length,
      time_limit: 90,
      draft_type: 'snake',
    });

  if (draftError) throw draftError;

  // 6. Create future draft picks (dynasty only)
  if (league_type === 'dynasty') {
    const startYear = parseInt(settings.season.split('-')[0], 10);

    for (let offset = 1; offset <= settings.max_future_seasons; offset++) {
      const futureStart = startYear + offset;
      const futureEnd = (futureStart + 1) % 100;
      const season = `${futureStart}-${String(futureEnd).padStart(2, '0')}`;

      for (let round = 1; round <= settings.rookie_draft_rounds; round++) {
        for (let slot = 0; slot < teamIds.length; slot++) {
          await supabaseAdmin.from('draft_picks').insert({
            league_id: leagueId,
            season,
            round,
            slot_number: slot + 1,
            current_team_id: teamIds[slot],
            original_team_id: teamIds[slot],
          });
        }
      }
    }
  }

  // 7. Initialize waiver priority
  const waiverRows = teamIds.map((teamId, index) => ({
    league_id: leagueId,
    team_id: teamId,
    priority: index + 1,
    faab_remaining: settings.faab_budget,
  }));

  if (waiverRows.length > 0) {
    const { error } = await supabaseAdmin.from('waiver_priority').insert(waiverRows);
    if (error) log.warn('Failed to insert waiver priority', { error: error.message });
  }

  // 8. Insert historical seasons (fuzzy match history team names to created teams)
  log.info('History check', {
    has_history: !!history,
    history_length: history?.length ?? 0,
    created_team_names: Array.from(teamNameToId.keys()),
  });
  if (history?.length) {
    // Build normalized lookup for fuzzy matching
    const createdTeamNames = Array.from(teamNameToId.entries());
    const normalizedCreated = createdTeamNames.map(([name, id]) => ({
      name,
      id,
      norm: normalizeName(name),
    }));

    function fuzzyMatchTeam(historyName: string): string | null {
      // 1. Exact match
      const exact = teamNameToId.get(historyName);
      if (exact) return exact;

      const normHistory = normalizeName(historyName);

      // 2. Normalized exact match
      const normMatch = normalizedCreated.find(t => t.norm === normHistory);
      if (normMatch) return normMatch.id;

      // 3. Contains match (either direction)
      const containsMatch = normalizedCreated.find(
        t => t.norm.includes(normHistory) || normHistory.includes(t.norm),
      );
      if (containsMatch) return containsMatch.id;

      // 4. First word match (useful for "Team Spoe" vs "Spoelstra")
      const histWords = normHistory.split(' ');
      const wordMatch = normalizedCreated.find(t => {
        const tWords = t.norm.split(' ');
        return histWords.some(hw => hw.length >= 3 && tWords.some(tw => tw.startsWith(hw) || hw.startsWith(tw)));
      });
      if (wordMatch) return wordMatch.id;

      return null;
    }

    const teamSeasonRows: any[] = [];

    for (const hs of history) {
      for (const ht of hs.teams) {
        const teamId = fuzzyMatchTeam(ht.team_name);
        if (!teamId) {
          log.warn('History: could not match team to any created team', { team_name: ht.team_name });
          continue;
        }

        teamSeasonRows.push({
          team_id: teamId,
          league_id: leagueId,
          season: hs.season,
          wins: ht.wins ?? 0,
          losses: ht.losses ?? 0,
          ties: ht.ties ?? 0,
          points_for: ht.points_for ?? 0,
          points_against: ht.points_against ?? 0,
          final_standing: ht.standing ?? 0,
          playoff_result: null,
        });
      }
    }

    log.info('History: built team_season rows', { row_count: teamSeasonRows.length });
    for (let i = 0; i < teamSeasonRows.length; i += 100) {
      const chunk = teamSeasonRows.slice(i, i + 100);
      const { error } = await supabaseAdmin.from('team_seasons').insert(chunk);
      if (error) {
        log.warn('Failed to insert team_seasons chunk', { error: error.message, chunk_size: chunk.length });
      } else {
        log.info('Inserted team_season chunk', { chunk_size: chunk.length });
      }
    }
  }

  return jsonResponse({
    league_id: leagueId,
    teams_created: teams.length,
    players_imported: leaguePlayerRows.length,
    message: `Successfully imported "${league_name}" with ${teams.length} teams and ${leaguePlayerRows.length} players.`,
  });
}

// --- Main handler ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    // Verify caller JWT
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return errorResponse('Unauthorized', 401);
    }
    const userId = user.id;

    const rateLimited = await checkRateLimit(supabaseAdmin, userId, 'import-screenshot-league');
    if (rateLimited) return rateLimited;

    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch (parseErr) {
      log.error('Body parse error', parseErr);
      return errorResponse('Invalid or oversized request body', 400);
    }

    const body = parseBody(Body, rawBody);

    log.info('Request received', { action: body.action, image_count: 'images' in body ? body.images.length : 0 });

    switch (body.action) {
      case 'extract_roster':
      case 'extract_settings':
      case 'extract_history': {
        // Extra rate limit for Claude Vision calls (expensive API)
        const extractLimited = await checkRateLimit(supabaseAdmin, userId, 'import-extract');
        if (extractLimited) return extractLimited;
        if (body.action === 'extract_roster') return await handleExtractRoster(body, supabaseAdmin);
        if (body.action === 'extract_settings') return await handleExtractSettings(body);
        return await handleExtractHistory(body);
      }
      case 'search_or_create_player':
        return await handleSearchOrCreatePlayer(body, supabaseAdmin);
      case 'execute':
        // Cast: handler's history stats are typed non-nullable but Claude
        // Vision can legitimately omit them; the handler tolerates null and
        // coerces internally. Narrowing here keeps the schema honest about
        // what the wire can deliver.
        return await handleExecute(body as Parameters<typeof handleExecute>[0], supabaseAdmin, userId);
    }
  } catch (error) {
    return handleError(error, 'import-screenshot-league');
  }
});
