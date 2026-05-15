import { useMemo } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import {
  useNhlArchiveAwards,
  useNhlArchiveBracket,
} from '@/hooks/useNhlArchivePlayoffs';
import type {
  NhlArchiveAwardEntry,
  NhlArchiveFranchiseSeason,
  NhlAwardType,
} from '@/types/archiveNhlPlayoff';
import { ms, s } from '@/utils/scale';

interface Props {
  season: number | null;
  onPlayerTap?: (entry: NhlArchiveAwardEntry) => void;
}

// Render order for solo awards. Awards not present in the data simply skip.
const SOLO_AWARDS: { type: NhlAwardType; label: string; short: string }[] = [
  { type: 'hart',              label: 'Hart Memorial Trophy',     short: 'HART' },
  { type: 'ted_lindsay',       label: 'Ted Lindsay Award',         short: 'TLA' },
  { type: 'norris',            label: 'James Norris Trophy',       short: 'NORRIS' },
  { type: 'vezina',            label: 'Vezina Trophy',             short: 'VEZINA' },
  { type: 'calder',            label: 'Calder Memorial Trophy',    short: 'CALDER' },
  { type: 'selke',             label: 'Frank J. Selke Trophy',     short: 'SELKE' },
  { type: 'lady_byng',         label: 'Lady Byng Trophy',          short: 'BYNG' },
  { type: 'jack_adams',        label: 'Jack Adams Award',          short: 'ADAMS' },
  { type: 'art_ross',          label: 'Art Ross Trophy',           short: 'ROSS' },
  { type: 'rocket_richard',    label: 'Maurice Richard Trophy',    short: 'RICHARD' },
  { type: 'conn_smythe',       label: 'Conn Smythe Trophy',        short: 'SMYTHE' },
  { type: 'presidents_trophy', label: "Presidents' Trophy",        short: "PRES" },
];

interface TeamSection {
  title: string;
  tiers: { type: NhlAwardType; label: string }[];
}

const TEAM_SECTIONS: TeamSection[] = [
  {
    title: 'NHL All-Star Teams',
    tiers: [
      { type: 'all_star_first',  label: '1st Team' },
      { type: 'all_star_second', label: '2nd Team' },
    ],
  },
  {
    title: 'All-Rookie Team',
    tiers: [{ type: 'all_rookie', label: '' }],
  },
];

export function NhlSeasonAwards({ season, onPlayerTap }: Props) {
  const c = useArchiveColors();
  const { data: awards, isLoading } = useNhlArchiveAwards(season);
  // Already in cache from the parent screen's bracket fetch — used here just
  // to render team logos beside award winners.
  const { data: bracket } = useNhlArchiveBracket(season);

  const franchiseMap = useMemo(() => {
    const m = new Map<string, NhlArchiveFranchiseSeason>();
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

  const visibleSolo = SOLO_AWARDS.filter((a) => awards[a.type]?.[0]);
  const visibleSections = TEAM_SECTIONS.filter((sec) =>
    sec.tiers.some((t) => (awards[t.type]?.length ?? 0) > 0),
  );

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {visibleSolo.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Awards" c={c} />
          <View style={[styles.soloCard, { backgroundColor: c.card, borderColor: c.border }]}>
            {visibleSolo.map(({ type, label, short }, i) => {
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
                  isLast={i === visibleSolo.length - 1}
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
  entry: NhlArchiveAwardEntry;
  franchiseMap: Map<string, NhlArchiveFranchiseSeason>;
  onPress?: () => void;
  isLast: boolean;
}) {
  const c = useArchiveColors();
  const franchise = entry.franchise_id ? franchiseMap.get(entry.franchise_id) ?? null : null;
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      onPress={onPress}
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
              sport="nhl"
            />
          )}
          <ThemedText
            style={[styles.soloPlayerName, { color: c.text }]}
            numberOfLines={1}
          >
            {entry.player_name}
            {entry.position && (
              <ThemedText style={[styles.posTag, { color: c.heritageGold }]}>
                {`  ${entry.position}`}
              </ThemedText>
            )}
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
  rows: NhlArchiveAwardEntry[];
  franchiseMap: Map<string, NhlArchiveFranchiseSeason>;
  onPlayerTap?: (entry: NhlArchiveAwardEntry) => void;
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
      {label !== '' && (
        <ThemedText
          type="varsitySmall"
          style={[styles.tierLabel, { color: c.heritageGold }]}
        >
          {label}
        </ThemedText>
      )}
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
              style={[styles.chip, { backgroundColor: c.cardAlt, borderColor: c.border }]}
            >
              {franchise && (
                <ArchiveTeamLogo
                  franchiseId={franchise.franchise_id}
                  tricode={franchise.tricode}
                  primaryColor={franchise.primary_color}
                  secondaryColor={franchise.secondary_color}
                  logoKey={franchise.logo_key}
                  size={s(16)}
                  sport="nhl"
                />
              )}
              <ThemedText
                style={[styles.chipText, { color: c.text }]}
                numberOfLines={1}
              >
                {entry.player_name}
                {entry.position && (
                  <ThemedText style={[styles.posTagSmall, { color: c.heritageGold }]}>
                    {`  ${entry.position}`}
                  </ThemedText>
                )}
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

  section: { gap: s(8) },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingHorizontal: s(2),
  },
  sectionRule: { height: 2, width: s(18) },
  sectionTitle: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.4,
  },

  soloCard: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  soloRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(10),
    gap: s(10),
  },
  soloShortBadge: {
    minWidth: s(60),
    paddingHorizontal: s(6),
    paddingVertical: s(4),
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
  },
  soloShortText: { fontSize: ms(10), letterSpacing: 1.0, fontWeight: '700' },
  soloPlayerCol: { flex: 1, minWidth: 0, gap: s(2) },
  soloPlayerNameRow: { flexDirection: 'row', alignItems: 'center', gap: s(8) },
  soloPlayerName: {
    fontSize: ms(14),
    fontWeight: '700',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  soloStatLine: { fontSize: ms(10), letterSpacing: 0.2, paddingLeft: s(28) },

  teamCard: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  tierRow: { paddingVertical: s(10), paddingHorizontal: s(10) },
  tierLabel: {
    fontSize: ms(10),
    letterSpacing: 1.2,
    fontWeight: '700',
    marginBottom: s(6),
  },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: s(6) },
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
  chipText: { fontSize: ms(11), fontWeight: '600', letterSpacing: -0.1 },
  posTag: { fontSize: ms(10), fontWeight: '700', letterSpacing: 0.6 },
  posTagSmall: { fontSize: ms(9), fontWeight: '700', letterSpacing: 0.4 },
});
