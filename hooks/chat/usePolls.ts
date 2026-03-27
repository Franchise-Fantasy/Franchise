import { supabase } from '@/lib/supabase';
import type { CommissionerPoll, PollResults, PollVote } from '@/types/poll';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';

// ─── Fetch single poll ──────────────────────────────────────

export function usePoll(pollId: string | null) {
  return useQuery<CommissionerPoll | null>({
    queryKey: ['poll', pollId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commissioner_polls')
        .select('*')
        .eq('id', pollId!)
        .single();
      if (error) throw error;
      return data as CommissionerPoll;
    },
    enabled: !!pollId,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Fetch poll results (aggregate + own vote) ──────────────

export function usePollResults(
  pollId: string | null,
  poll: CommissionerPoll | null | undefined,
  teamId: string | null,
) {
  const queryClient = useQueryClient();

  // Realtime subscription on poll_votes for this poll
  useEffect(() => {
    if (!pollId) return;
    const channel = supabase
      .channel(`poll_votes_${pollId}_${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'poll_votes',
          filter: `poll_id=eq.${pollId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ['pollResults', pollId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [pollId, queryClient]);

  return useQuery<PollResults>({
    queryKey: ['pollResults', pollId],
    queryFn: async () => {
      if (!poll || !pollId || !teamId) {
        return { totalVotes: 0, optionCounts: [], myVote: null, isClosed: false };
      }

      const isClosed = new Date(poll.closes_at) <= new Date();

      // Get aggregate counts via RPC (safe for anonymous polls)
      const { data: agg, error: aggError } = await supabase
        .rpc('get_poll_results', { p_poll_id: pollId });
      if (aggError) throw aggError;

      const totalVotes: number = agg?.total_votes ?? 0;
      const optionCounts: number[] = agg?.option_counts ?? [];

      // Get own vote
      const { data: myVoteRows } = await supabase
        .from('poll_votes')
        .select('selections')
        .eq('poll_id', pollId)
        .eq('team_id', teamId)
        .limit(1);
      const myVote: number[] | null = myVoteRows?.[0]?.selections ?? null;

      // For non-anonymous polls, get voter names per option
      let votersByOption: string[][] | undefined;
      if (!poll.is_anonymous && (poll.show_live_results || isClosed)) {
        const { data: votes } = await supabase
          .from('poll_votes')
          .select('selections, teams(name)')
          .eq('poll_id', pollId);

        if (votes && votes.length > 0) {
          votersByOption = poll.options.map((_: string, idx: number) => {
            return votes
              .filter((v: any) => (v.selections as number[]).includes(idx))
              .map((v: any) => (v.teams as any)?.name ?? 'Unknown');
          });
        }
      }

      // If results are hidden and poll is still open, blank out the counts
      if (!poll.show_live_results && !isClosed) {
        return {
          totalVotes,
          optionCounts: poll.options.map(() => 0),
          myVote,
          isClosed,
        };
      }

      return { totalVotes, optionCounts, myVote, votersByOption, isClosed };
    },
    enabled: !!pollId && !!poll && !!teamId,
    refetchInterval: (query) => {
      // Refetch every 30s while poll is open for countdown accuracy
      const data = query.state.data;
      return data?.isClosed ? false : 30_000;
    },
  });
}

// ─── Vote on a poll ─────────────────────────────────────────

export function useVotePoll(pollId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (selections: number[]) => {
      const { data, error } = await supabase.functions.invoke('vote-poll', {
        body: { poll_id: pollId, selections },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onMutate: async (selections) => {
      // Optimistic: set myVote immediately
      await queryClient.cancelQueries({ queryKey: ['pollResults', pollId] });
      const previous = queryClient.getQueryData(['pollResults', pollId]);
      queryClient.setQueryData(['pollResults', pollId], (old: PollResults | undefined) => {
        if (!old) return old;
        const newCounts = [...old.optionCounts];
        for (const idx of selections) {
          if (idx < newCounts.length) newCounts[idx]++;
        }
        return {
          ...old,
          myVote: selections,
          totalVotes: old.totalVotes + 1,
          optionCounts: newCounts,
        };
      });
      return { previous };
    },
    onError: (_err, _selections, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['pollResults', pollId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['pollResults', pollId] });
    },
  });
}

// ─── Close a poll early (commissioner) ──────────────────────

export function useClosePoll(pollId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('commissioner_polls')
        .update({ closes_at: new Date().toISOString() })
        .eq('id', pollId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['poll', pollId] });
      queryClient.invalidateQueries({ queryKey: ['pollResults', pollId] });
    },
  });
}

// ─── Create a poll (commissioner) ───────────────────────────

export function useCreatePoll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      league_id: string;
      conversation_id: string;
      question: string;
      options: string[];
      poll_type: 'single' | 'multi';
      closes_at: string;
      is_anonymous: boolean;
      show_live_results: boolean;
    }) => {
      const { data, error } = await supabase.functions.invoke('create-poll', {
        body: params,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { poll_id: string; message_id: string };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['messages', variables.conversation_id],
      });
    },
  });
}
