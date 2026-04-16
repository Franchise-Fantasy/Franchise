import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export type PaymentStatus = 'unpaid' | 'self_reported' | 'confirmed';

export interface PaymentRow {
  id: string;
  league_id: string;
  team_id: string;
  season: string;
  paid: boolean;
  status: PaymentStatus;
  paid_at: string | null;
  self_reported_at: string | null;
  marked_by: string | null;
  notes: string | null;
  created_at: string;
}

export function usePaymentLedger(leagueId: string | null, season: string | null) {
  return useQuery({
    queryKey: queryKeys.paymentLedger(leagueId!, Number(season!)),
    queryFn: async (): Promise<PaymentRow[]> => {
      const { data, error } = await supabase
        .from('league_payments')
        .select('*')
        .eq('league_id', leagueId!)
        .eq('season', season!);
      if (error) throw error;
      return (data ?? []) as PaymentRow[];
    },
    enabled: !!leagueId && !!season,
    staleTime: 1000 * 60 * 5,
  });
}

// ── Commissioner: confirm / deny ─────────────────────────────────

export function useTogglePayment(leagueId: string, season: string) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.paymentLedger(leagueId, Number(season));

  return useMutation({
    mutationFn: async ({ teamId, action }: { teamId: string; action: 'confirm' | 'deny' }) => {
      const { error } = await supabase.functions.invoke('mark-payment', {
        body: { league_id: leagueId, team_id: teamId, season, action },
      });
      if (error) throw error;
    },
    onMutate: async ({ teamId, action }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<PaymentRow[]>(queryKey);

      queryClient.setQueryData<PaymentRow[]>(queryKey, (old = []) => {
        const newStatus: PaymentStatus = action === 'confirm' ? 'confirmed' : 'unpaid';
        const now = new Date().toISOString();
        const exists = old.some((r) => r.team_id === teamId);

        if (exists) {
          return old.map((r) =>
            r.team_id === teamId
              ? {
                  ...r,
                  status: newStatus,
                  paid: action === 'confirm',
                  paid_at: action === 'confirm' ? now : null,
                  self_reported_at: action === 'deny' ? null : r.self_reported_at,
                }
              : r,
          );
        }
        return [
          ...old,
          {
            id: `optimistic-${teamId}`,
            league_id: leagueId,
            team_id: teamId,
            season,
            paid: action === 'confirm',
            status: newStatus,
            paid_at: action === 'confirm' ? now : null,
            self_reported_at: null,
            marked_by: null,
            notes: null,
            created_at: now,
          },
        ];
      });

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

// ── Team owner: self-report ──────────────────────────────────────

export function useSelfReportPayment(leagueId: string, season: string) {
  const queryClient = useQueryClient();
  const queryKey = queryKeys.paymentLedger(leagueId, Number(season));

  return useMutation({
    mutationFn: async ({ teamId }: { teamId: string }) => {
      const { error } = await supabase.functions.invoke('mark-payment', {
        body: { league_id: leagueId, team_id: teamId, season, action: 'self_report' },
      });
      if (error) throw error;
    },
    onMutate: async ({ teamId }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<PaymentRow[]>(queryKey);

      queryClient.setQueryData<PaymentRow[]>(queryKey, (old = []) => {
        const now = new Date().toISOString();
        const exists = old.some((r) => r.team_id === teamId);

        if (exists) {
          return old.map((r) =>
            r.team_id === teamId
              ? { ...r, status: 'self_reported' as PaymentStatus, self_reported_at: now }
              : r,
          );
        }
        return [
          ...old,
          {
            id: `optimistic-${teamId}`,
            league_id: leagueId,
            team_id: teamId,
            season,
            paid: false,
            status: 'self_reported' as PaymentStatus,
            paid_at: null,
            self_reported_at: now,
            marked_by: null,
            notes: null,
            created_at: now,
          },
        ];
      });

      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

// ── Notes (unchanged) ────────────────────────────────────────────

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
      queryClient.invalidateQueries({ queryKey: queryKeys.paymentLedger(leagueId, Number(season)) });
    },
  });
}
