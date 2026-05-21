import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

import type { DraftHistoryPick, DraftSummary } from './types';

// Data source: drafts + draft_picks (completed drafts only).

export function useDraftHistory(leagueId: string | null) {
  return useQuery<{ drafts: DraftSummary[]; picks: DraftHistoryPick[] }>({
    queryKey: queryKeys.draftHistory(leagueId!),
    queryFn: async () => {
      // Fetch completed drafts
      const { data: drafts, error: draftErr } = await supabase
        .from('drafts')
        .select('id, season, type, draft_type, rounds, status')
        .eq('league_id', leagueId!)
        .eq('status', 'complete')
        .order('season', { ascending: false });
      if (draftErr) throw draftErr;
      if (!drafts || drafts.length === 0) return { drafts: [], picks: [] };

      const draftIds = drafts.map((d) => d.id);

      // Fetch all picks for those drafts
      const { data: picks, error: pickErr } = await supabase
        .from('draft_picks')
        .select(`
          id, draft_id, pick_number, round, slot_number,
          current_team_id, original_team_id, player_id,
          player:players!draft_picks_player_id_fkey(name, position),
          current_team:teams!draft_picks_current_team_id_fkey(name, tricode),
          original_team:teams!draft_picks_original_team_id_fkey(name, tricode)
        `)
        .in('draft_id', draftIds)
        .not('player_id', 'is', null)
        .order('pick_number', { ascending: true });
      if (pickErr) throw pickErr;

      const mappedPicks: DraftHistoryPick[] = (picks ?? []).map((p: any) => ({
        id: p.id,
        draft_id: p.draft_id,
        pick_number: p.pick_number,
        round: p.round,
        slot_number: p.slot_number,
        current_team_id: p.current_team_id,
        original_team_id: p.original_team_id,
        player_name: p.player?.name ?? null,
        player_position: p.player?.position ?? null,
        current_team_name: p.current_team?.name ?? 'Unknown',
        current_team_tricode: p.current_team?.tricode ?? null,
        original_team_name: p.original_team?.name ?? 'Unknown',
        original_team_tricode: p.original_team?.tricode ?? null,
        isTraded: p.current_team_id !== p.original_team_id,
      }));

      return { drafts: drafts as DraftSummary[], picks: mappedPicks };
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}
