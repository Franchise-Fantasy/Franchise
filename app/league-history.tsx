import { AllTimeRecords } from '@/components/league-history/AllTimeRecords';
import { ms, s } from "@/utils/scale";
import { DraftBoard } from '@/components/league-history/DraftBoard';
import { HeadToHeadMatrix } from '@/components/league-history/HeadToHeadMatrix';
import { StandingsHistory } from '@/components/league-history/StandingsHistory';
import { TradeHistory } from '@/components/league-history/TradeHistory';
import { TrophyCase } from '@/components/league-history/TrophyCase';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useDraftHistory, useHeadToHead, useSeasonStandings } from '@/hooks/useLeagueHistory';
import { useTradeProposals } from '@/hooks/useTrades';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type SectionKey = 'standings' | 'h2h' | 'drafts' | 'trades';

interface SectionDef {
  key: SectionKey;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const SECTIONS: SectionDef[] = [
  { key: 'standings', title: 'Standings History', icon: 'podium-outline' },
  { key: 'h2h', title: 'Head-to-Head Records', icon: 'people-outline' },
  { key: 'drafts', title: 'Draft History', icon: 'list-outline' },
  { key: 'trades', title: 'Trade History', icon: 'swap-horizontal-outline' },
];

export default function LeagueHistory() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId } = useAppState();

  // Prefetch so data is ready when sections expand
  useSeasonStandings(leagueId);
  useHeadToHead(leagueId);
  useDraftHistory(leagueId);
  useTradeProposals(leagueId);

  const [expandedSection, setExpandedSection] = useState<SectionKey | null>(null);

  const toggleSection = (key: SectionKey) => {
    setExpandedSection((prev) => (prev === key ? null : key));
  };

  if (!leagueId) return null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={[styles.backText, { color: c.accent }]}>{'‹ Back'}</Text>
        </TouchableOpacity>
        <ThemedText type="defaultSemiBold" style={styles.title} accessibilityRole="header">League History</ThemedText>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Trophy Case — always visible */}
        <TrophyCase leagueId={leagueId} />

        {/* Record Book — always visible */}
        <AllTimeRecords leagueId={leagueId} />

        {/* Collapsible sections */}
        {SECTIONS.map((section) => {
          const isExpanded = expandedSection === section.key;
          return (
            <View key={section.key} style={[styles.sectionCard, { backgroundColor: c.card, borderColor: c.border }]}>
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => toggleSection(section.key)}
                accessibilityRole="button"
                accessibilityLabel={section.title}
                accessibilityState={{ expanded: isExpanded }}
              >
                <Ionicons name={section.icon} size={20} color={c.icon} accessible={false} />
                <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>{section.title}</ThemedText>
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={c.secondaryText}
                  accessible={false}
                />
              </TouchableOpacity>

              {isExpanded && (
                <View style={[styles.sectionContent, { borderTopColor: c.border }]}>
                  {section.key === 'standings' && <StandingsHistory leagueId={leagueId} />}
                  {section.key === 'h2h' && <HeadToHeadMatrix leagueId={leagueId} />}
                  {section.key === 'drafts' && <DraftBoard leagueId={leagueId} />}
                  {section.key === 'trades' && <TradeHistory leagueId={leagueId} />}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 70, paddingHorizontal: 8 },
  backText: { fontSize: ms(16), fontWeight: '500' },
  title: { fontSize: ms(16), textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 10,
  },
  sectionTitle: { flex: 1, fontSize: ms(14) },
  sectionContent: {
    padding: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
