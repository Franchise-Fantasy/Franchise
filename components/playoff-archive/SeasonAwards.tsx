import { useMemo } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import {
  useArchiveAwards,
  useArchiveBracket,
} from '@/hooks/useArchivePlayoffs';
import type {
  ArchiveAwardEntry,
  ArchiveFranchiseSeason,
  AwardType,
} from '@/types/archivePlayoff';
import { ms, s } from '@/utils/scale';

interface Props {
  season: number | null;
  onPlayerTap?: (entry: ArchiveAwardEntry) => void;
}

const SOLO_AWARDS: { type: AwardType; label: string; short: string }[] = [
  { type: 'mvp', label: 'Most Valuable Player', short: 'MVP' },
  { type: 'dpoy', label: 'Defensive Player of the Year', short: 'DPOY' },
  { type: 'roy', label: 'Rookie of the Year', short: 'ROY' },
  { type: 'sixth_man', label: 'Sixth Man of the Year', short: '6MOY' },
  { type: 'mip', label: 'Most Improved Player', short: 'MIP' },
];

interface TeamSection {
  title: string;
  tiers: { type: AwardType; label: string }[];
}

const TEAM_SECTIONS: TeamSection[] = [
  {
    title: 'All-NBA Teams',
    tiers: [
      { type: 'all_nba_first', label: '1st Team' },
      { type: 'all_nba_second', label: '2nd Team' },
      { type: 'all_nba_third', label: '3rd Team' },
    ],
  },
  {
    title: 'All-Defensive Teams',
    tiers: [
      { type: 'all_defense_first', label: '1st Team' },
      { type: 'all_defense_second', label: '2nd Team' },
    ],
  },
  {
    title: 'All-Rookie Teams',
    tiers: [
      { type: 'all_rookie_first', label: '1st Team' },
      { type: 'all_rookie_second', label: '2nd Team' },
    ],
  },
];

export function SeasonAwards({ season, onPlayerTap }: Props) {
  const c = useArchiveColors();
  const { data: awards, isLoading } = useArchiveAwards(season);
  // Bracket data is already in the React Query cache when this renders
  // (the parent screen fetches it for the Playoffs view), so this is free.
  // We only need it to render team logos next to award winners.
  const { data: bracket } = useArchiveBracket(season);

  const franchiseMap = useMemo(() => {
    const m = new Map<string, ArchiveFranchiseSeason>();
    if (bracket?.franchises) {
      for (const f of bracket.franchises) m.set(f.franchise_id, f);
    }
    return m;
  }, [bracket?.franchises]);

  if (!season || isLoading || !awards) return null;

  const hasAny = Object.values(awards).some(
    (rows) => Array.isArray(rows) && rows.length > 0,
  );
  if (!hasAny) {
    return (
      <View style={styles.emptyState}>
        <ThemedText style={{ color: c.secondaryText, textAlign: 'center' }}>
          No awards curated for this season yet.
        </ThemedText>
      </View>
    );
  }

  const hasSoloAwards = SOLO_AWARDS.some((a) => awards[a.type]?.[0]);
  const visibleSections = TEAM_SECTIONS.filter((sec) =>
    sec.tiers.some((t) => (awards[t.type]?.length ?? 0) > 0),
  );

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {hasSoloAwards && (
        <View style={styles.section}>
          <SectionHeader title="Individual Awards" c={c} />
          <View style={[styles.soloCard, { backgroundColor: c.card, borderColor: c.border }]}>
            {SOLO_AWARDS.map(({ type, label, short }, i) => {
              const entry = awards[type]?.[0];
              if (!entry) return null;
              return (
                <SoloAwardRow
                  key={type}
                  label={label}
                  short={short}
                  entry={entry}
                  franchiseMap={franchiseMap}
                  onPress={onPlayerTap ? () => onPlayerTap(entry) : undefined}
                  isLast={i === SOLO_AWARDS.length - 1}
                />
              );
            })}
          </View>
        </View>
      )}

      {visibleSections.map((sec) => (
        <View key={sec.title} style={styles.section}>
          <SectionHeader title={sec.title} c={c} />
          <View style={[styles.teamCard, { backgroundColor: c.card, borderColor: c.border }]}>
            {sec.tiers.map((tier, i) => {
              const rows = awards[tier.type];
              if (!rows || rows.length === 0) return null;
              return (
                <SelectionTeamRow
                  key={tier.type}
                  label={tier.label}
                  rows={rows}
                  franchiseMap={franchiseMap}
                  onPlayerTap={onPlayerTap}
                  isLast={i === sec.tiers.length - 1}
                />
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function SectionHeader({
  title,
  c,
}: {
  title: string;
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={[styles.sectionRule, { backgroundColor: c.heritageGold }]} />
      <ThemedText
        type="varsitySmall"
        style={[styles.sectionTitle, { color: c.text }]}
      >
        {title}
      </ThemedText>
    </View>
  );
}

function SoloAwardRow({
  label,
  short,
  entry,
  franchiseMap,
  onPress,
  isLast,
}: {
  label: string;
  short: string;
  entry: ArchiveAwardEntry;
  franchiseMap: Map<string, ArchiveFranchiseSeason>;
  onPress?: () => void;
  isLast: boolean;
}) {
  const c = useArchiveColors();
  const franchise = entry.franchise_id
    ? franchiseMap.get(entry.franchise_id) ?? null
    : null;
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
       
      {...(onPress ? ({ onPress, activeOpacity: 0.7 } as any) : {})}
      style={[
        styles.soloRow,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
      ]}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}: ${entry.player_name}${entry.stat_line ? `, ${entry.stat_line}` : ''}`}
    >
      <View style={[styles.soloShortBadge, { backgroundColor: c.cardAlt, borderColor: c.heritageGold }]}>
        <ThemedText
          type="varsitySmall"
          style={[styles.soloShortText, { color: c.heritageGold }]}
        >
          {short}
        </ThemedText>
      </View>
      <View style={styles.soloPlayerCol}>
        <View style={styles.soloPlayerNameRow}>
          {franchise && (
            <ArchiveTeamLogo
              franchiseId={franchise.franchise_id}
              tricode={franchise.tricode}
              primaryColor={franchise.primary_color}
              secondaryColor={franchise.secondary_color}
              logoKey={franchise.logo_key}
              size={s(20)}
            />
          )}
          <ThemedText
            style={[styles.soloPlayerName, { color: c.text }]}
            numberOfLines={1}
          >
            {entry.player_name}
          </ThemedText>
        </View>
        {entry.stat_line && (
          <ThemedText
            style={[styles.soloStatLine, { color: c.secondaryText }]}
            numberOfLines={1}
          >
            {entry.stat_line}
          </ThemedText>
        )}
      </View>
    </Wrapper>
  );
}

function SelectionTeamRow({
  label,
  rows,
  franchiseMap,
  onPlayerTap,
  isLast,
}: {
  label: string;
  rows: ArchiveAwardEntry[];
  franchiseMap: Map<string, ArchiveFranchiseSeason>;
  onPlayerTap?: (entry: ArchiveAwardEntry) => void;
  isLast: boolean;
}) {
  const c = useArchiveColors();
  return (
    <View
      style={[
        styles.tierRow,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
      ]}
    >
      <ThemedText
        type="varsitySmall"
        style={[styles.tierLabel, { color: c.heritageGold }]}
      >
        {label}
      </ThemedText>
      <View style={styles.chipWrap}>
        {rows.map((entry) => {
          const franchise = entry.franchise_id
            ? franchiseMap.get(entry.franchise_id) ?? null
            : null;
          return (
            <TouchableOpacity
              key={`${entry.rank}-${entry.player_name}`}
              onPress={onPlayerTap ? () => onPlayerTap(entry) : undefined}
              disabled={!onPlayerTap}
              activeOpacity={0.7}
              accessibilityRole={onPlayerTap ? 'button' : undefined}
              accessibilityLabel={entry.player_name}
              style={[
                styles.chip,
                { backgroundColor: c.cardAlt, borderColor: c.border },
              ]}
            >
              {franchise && (
                <ArchiveTeamLogo
                  franchiseId={franchise.franchise_id}
                  tricode={franchise.tricode}
                  primaryColor={franchise.primary_color}
                  secondaryColor={franchise.secondary_color}
                  logoKey={franchise.logo_key}
                  size={s(16)}
                />
              )}
              <ThemedText
                style={[styles.chipText, { color: c.text }]}
                numberOfLines={1}
              >
                {entry.player_name}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: s(8),
    paddingBottom: s(40),
    gap: s(16),
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(60),
  },

  section: {
    gap: s(8),
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingHorizontal: s(2),
  },
  sectionRule: {
    height: 2,
    width: s(18),
  },
  sectionTitle: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.4,
  },

  // Solo awards card — five rows, one per individual award.
  soloCard: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  soloRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(10),
    gap: s(10),
  },
  soloShortBadge: {
    minWidth: s(48),
    paddingHorizontal: s(6),
    paddingVertical: s(4),
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
  },
  soloShortText: {
    fontSize: ms(10),
    letterSpacing: 1.0,
    fontWeight: '700',
  },
  soloPlayerCol: {
    flex: 1,
    minWidth: 0,
    gap: s(2),
  },
  soloPlayerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  soloPlayerName: {
    fontSize: ms(14),
    fontWeight: '700',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  soloStatLine: {
    fontSize: ms(10),
    letterSpacing: 0.2,
    paddingLeft: s(28),
  },

  // Selection-team card — N tiers stacked, each with a small label and a
  // wrap of player chips below.
  teamCard: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  tierRow: {
    paddingVertical: s(10),
    paddingHorizontal: s(10),
  },
  tierLabel: {
    fontSize: ms(10),
    letterSpacing: 1.2,
    fontWeight: '700',
    marginBottom: s(6),
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(6),
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    paddingLeft: s(4),
    paddingRight: s(8),
    paddingVertical: s(4),
    borderRadius: 6,
    borderWidth: 1,
  },
  chipText: {
    fontSize: ms(11),
    fontWeight: '600',
    letterSpacing: -0.1,
  },
});
