import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { calcRounds } from '@/utils/playoff';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ms, s } from '@/utils/scale';
import { useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';

interface SeasonCompleteBannerProps {
  leagueId: string;
  season: string;
  playoffTeams: number;
  isCommissioner: boolean;
}

/**
 * Shows after the championship round is finalized but before the commissioner
 * calls advance-season. Prompts the commissioner to start the offseason.
 */
export function SeasonCompleteBanner({ leagueId, season, playoffTeams, isCommissioner }: SeasonCompleteBannerProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const [advancing, setAdvancing] = useState(false);

  const totalRounds = calcRounds(playoffTeams);

  const { data: championshipComplete } = useQuery({
    queryKey: queryKeys.championshipCheck(leagueId, season as unknown as number),
    queryFn: async () => {
      // Check if the final playoff round has a winner
      const { data } = await supabase
        .from('playoff_bracket')
        .select('winner_id')
        .eq('league_id', leagueId)
        .eq('season', season)
        .eq('round', totalRounds)
        .not('winner_id', 'is', null)
        .neq('is_bye', true)
        .limit(1);

      return data && data.length > 0;
    },
    enabled: !!leagueId && totalRounds > 0,
    staleTime: 1000 * 60 * 2,
  });

  if (!championshipComplete) return null;

  const handleAdvanceSeason = () => {
    Alert.alert(
      'Start Offseason',
      'This will archive the current season, crown the champion, and begin the offseason process. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Offseason',
          onPress: async () => {
            setAdvancing(true);
            try {
              const { error } = await supabase.functions.invoke('advance-season', {
                body: { league_id: leagueId },
              });
              if (error) throw error;
              queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
              queryClient.invalidateQueries({ queryKey: ['championship-check', leagueId] });
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Failed to advance season');
            } finally {
              setAdvancing(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View
      style={[styles.banner, { backgroundColor: c.goldMuted, borderColor: c.gold }]}
      accessibilityRole="alert"
      accessibilityLabel={isCommissioner ? 'Season complete. Tap to start the offseason.' : 'Season complete. Waiting for commissioner to start the offseason.'}
    >
      <Ionicons name="trophy" size={22} color={c.gold} />
      <View style={styles.textContainer}>
        <ThemedText type="defaultSemiBold" style={{ fontSize: ms(14) }}>
          Season Complete!
        </ThemedText>
        <ThemedText style={{ fontSize: ms(12), color: c.secondaryText }}>
          {isCommissioner
            ? 'Tap below to archive the season and start the offseason.'
            : 'Waiting for the commissioner to start the offseason.'}
        </ThemedText>
      </View>
      {isCommissioner && (
        <TouchableOpacity
          style={[styles.button, { backgroundColor: c.accent }]}
          onPress={handleAdvanceSeason}
          disabled={advancing}
          accessibilityRole="button"
          accessibilityLabel="Start offseason"
        >
          {advancing ? (
            <LogoSpinner size={18} />
          ) : (
            <ThemedText style={{ color: c.statusText, fontSize: ms(13), fontWeight: '600' }}>Go</ThemedText>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: s(12),
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: s(16),
    gap: s(10),
    ...cardShadow,
  },
  textContainer: {
    flex: 1,
    gap: s(2),
  },
  button: {
    paddingHorizontal: s(14),
    paddingVertical: s(8),
    borderRadius: 8,
    minWidth: s(44),
    alignItems: 'center',
  },
});
