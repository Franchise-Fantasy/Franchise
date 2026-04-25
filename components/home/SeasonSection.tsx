import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';


interface SeasonSectionProps {
  leagueId: string;
  isCommissioner: boolean;
}

export function SeasonSection({ leagueId, isCommissioner }: SeasonSectionProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);

  // Check whether schedule has been generated and whether draft is complete
  const { data: status, isLoading } = useQuery({
    queryKey: queryKeys.seasonStatus(leagueId),
    queryFn: async () => {
      const [leagueRes, draftRes] = await Promise.all([
        supabase.from('leagues').select('schedule_generated').eq('id', leagueId).single(),
        supabase.from('drafts').select('status').eq('league_id', leagueId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);

      return {
        scheduleGenerated: leagueRes.data?.schedule_generated ?? false,
        draftComplete: draftRes.data?.status === 'complete',
      };
    },
    enabled: !!leagueId,
  });

  const handleGenerateSchedule = async () => {
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('generate-schedule', {
        body: { league_id: leagueId },
      });

      if (res.error || res.data?.error) {
        Alert.alert('Error', res.data?.error ?? res.error?.message ?? 'Failed to generate schedule.');
        return;
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.seasonStatus(leagueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
      Alert.alert('Season Started', `Schedule generated: ${res.data.total_weeks} weeks.`);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Unexpected error.');
    } finally {
      setGenerating(false);
    }
  };

  if (isLoading || !status) return null;

  // Only show when draft is done and schedule not yet generated
  if (!status.draftComplete || status.scheduleGenerated) return null;

  return (
    <View style={[styles.section, { backgroundColor: c.card }]}>
      <ThemedText type="defaultSemiBold" style={styles.title}>
        Draft Complete
      </ThemedText>
      <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
        The draft has concluded. Ready to start the season?
      </ThemedText>

      {isCommissioner ? (
        <TouchableOpacity
          onPress={handleGenerateSchedule}
          disabled={generating}
          style={[styles.btn, { backgroundColor: generating ? c.buttonDisabled : c.accent }]}
        >
          {generating ? (
            <LogoSpinner size={18} />
          ) : (
            <ThemedText style={[styles.btnText, { color: c.accentText }]}>
              Generate Schedule &amp; Start Season
            </ThemedText>
          )}
        </TouchableOpacity>
      ) : (
        <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
          Waiting for the commissioner to start the season.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: s(16),
    padding: s(16),
    borderRadius: 12,
    gap: s(10),
    ...cardShadow,
  },
  title: {
    fontSize: ms(16),
  },
  subtitle: {
    fontSize: ms(14),
  },
  btn: {
    paddingVertical: s(12),
    borderRadius: 8,
    alignItems: 'center',
  },
  btnText: {
    fontWeight: '600',
    fontSize: ms(15),
  },
});
