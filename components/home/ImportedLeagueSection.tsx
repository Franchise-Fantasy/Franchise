import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useToast } from '@/context/ToastProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ms, s } from '@/utils/scale';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface ImportedLeagueSectionProps {
  leagueId: string;
  inviteCode: string | null;
  isCommissioner: boolean;
  scheduleGenerated: boolean;
}

export function ImportedLeagueSection({
  leagueId,
  inviteCode,
  isCommissioner,
  scheduleGenerated,
}: ImportedLeagueSectionProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [generating, setGenerating] = useState(false);

  // Fetch team claiming status
  const { data: teamStatus } = useQuery({
    queryKey: queryKeys.importedTeamStatus(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, user_id, sleeper_roster_id')
        .eq('league_id', leagueId);

      if (error) throw error;

      const imported = (data ?? []).filter(t => t.sleeper_roster_id !== null);
      const claimed = imported.filter(t => t.user_id !== null);
      return { total: imported.length, claimed: claimed.length };
    },
    enabled: !!leagueId,
  });

  const allClaimed = teamStatus && teamStatus.claimed === teamStatus.total;

  const inviteLink = inviteCode ? `franchisev2://join?code=${inviteCode}` : null;

  const handleCopy = async () => {
    if (!inviteLink) return;
    await Clipboard.setStringAsync(inviteLink);
    showToast('success', 'Invite link copied');
  };

  const handleShare = async () => {
    if (!inviteCode || !inviteLink) return;
    await Share.share({
      message: `Join my league on Franchise! Use invite code: ${inviteCode}\n\nOr tap to join: ${inviteLink}`,
    });
  };

  const handleGenerateSchedule = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-schedule', {
        body: { league_id: leagueId },
      });

      if (error) throw new Error(error.message ?? 'Failed to generate schedule');

      await supabase
        .from('leagues')
        .update({ schedule_generated: true })
        .eq('id', leagueId);

      queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.importedTeamStatus(leagueId) });
      showToast('success', 'Schedule generated! Season is ready.');
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to generate schedule');
    } finally {
      setGenerating(false);
    }
  };

  if (scheduleGenerated) return null;

  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.headerRow}>
        <Ionicons name="cloud-download-outline" size={20} color={c.accent} accessible={false} />
        <ThemedText type="defaultSemiBold" style={styles.title} accessibilityRole="header">
          Imported League Setup
        </ThemedText>
      </View>

      {/* Team claiming status */}
      {teamStatus && (
        <View style={[styles.statusRow, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
          <ThemedText style={styles.statusLabel}>Teams Claimed</ThemedText>
          <ThemedText style={[styles.statusValue, { color: allClaimed ? c.success : c.accent }]}>
            {teamStatus.claimed} / {teamStatus.total}
          </ThemedText>
        </View>
      )}

      {/* Invite code - always show if not all claimed */}
      {inviteCode && !allClaimed && isCommissioner && (
        <View style={styles.inviteArea}>
          <ThemedText style={[styles.inviteLabel, { color: c.secondaryText }]}>
            Share this code with your league members so they can claim their teams.
          </ThemedText>
          <View style={[styles.codeCard, { backgroundColor: c.cardAlt }]}>
            <ThemedText style={styles.code}>{inviteCode}</ThemedText>
            <View style={styles.codeActions}>
              <TouchableOpacity
                onPress={handleCopy}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Copy invite code"
              >
                <Ionicons name="copy-outline" size={20} color={c.accent} accessible={false} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleShare}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Share invite code"
              >
                <Ionicons name="share-outline" size={20} color={c.accent} accessible={false} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Generate schedule button */}
      {isCommissioner && (
        <TouchableOpacity
          style={[
            styles.generateBtn,
            { backgroundColor: allClaimed ? c.accent : c.buttonDisabled },
          ]}
          onPress={handleGenerateSchedule}
          disabled={generating || !allClaimed}
          accessibilityRole="button"
          accessibilityLabel="Generate schedule"
          accessibilityState={{ disabled: generating || !allClaimed }}
        >
          {generating ? (
            <ActivityIndicator color={c.accentText} />
          ) : (
            <Text style={[styles.generateBtnText, { color: allClaimed ? c.accentText : c.secondaryText }]}>
              Generate Schedule
            </Text>
          )}
        </TouchableOpacity>
      )}

      {isCommissioner && !allClaimed && (
        <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
          All teams must be claimed before generating the schedule.
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: 12,
    padding: s(16),
    marginBottom: s(16),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(12),
  },
  title: {
    fontSize: ms(16),
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: s(12),
  },
  statusLabel: {
    fontSize: ms(14),
  },
  statusValue: {
    fontSize: ms(16),
    fontWeight: '700',
  },
  inviteArea: {
    marginBottom: s(12),
  },
  inviteLabel: {
    fontSize: ms(13),
    lineHeight: ms(18),
    marginBottom: s(8),
  },
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: s(12),
    borderRadius: 8,
  },
  code: {
    fontSize: ms(20),
    fontWeight: '700',
    letterSpacing: 3,
    fontFamily: 'monospace',
  },
  codeActions: {
    flexDirection: 'row',
    gap: s(12),
  },
  generateBtn: {
    paddingVertical: s(14),
    borderRadius: 10,
    alignItems: 'center',
  },
  generateBtnText: {
    fontSize: ms(16),
    fontWeight: '700',
  },
  hint: {
    fontSize: ms(12),
    textAlign: 'center',
    marginTop: s(8),
  },
});
