import { supabase } from '@/lib/supabase';
import { useSession } from '@/context/AuthProvider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export interface PaymentRow {
  id: string;
  league_id: string;
  team_id: string;
  season: string;
  paid: boolean;
  paid_at: string | null;
  marked_by: string | null;
  notes: string | null;
  created_at: string;
}

export function usePaymentLedger(leagueId: string | null, season: string | null) {
  return useQuery<PaymentRow[]>({
    queryKey: ['paymentLedger', leagueId, season],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_payments')
        .select('*')
        .eq('league_id', leagueId!)
        .eq('season', season!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId && !!season,
  });
}

export function useTogglePayment(leagueId: string, season: string) {
  const queryClient = useQueryClient();
  const session = useSession();

  return useMutation({
    mutationFn: async ({ teamId, paid }: { teamId: string; paid: boolean }) => {
      const { error } = await supabase
        .from('league_payments')
        .upsert(
          {
            league_id: leagueId,
            team_id: teamId,
            season,
            paid,
            paid_at: paid ? new Date().toISOString() : null,
            marked_by: paid ? session?.user?.id ?? null : null,
          },
          { onConflict: 'league_id,team_id,season' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentLedger', leagueId, season] });
    },
  });
}

export function useUpdatePaymentNotes(leagueId: string, season: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ teamId, notes }: { teamId: string; notes: string }) => {
      const { error } = await supabase
        .from('league_payments')
        .upsert(
          { league_id: leagueId, team_id: teamId, season, notes },
          { onConflict: 'league_id,team_id,season' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentLedger', leagueId, season] });
    },
  });
}
