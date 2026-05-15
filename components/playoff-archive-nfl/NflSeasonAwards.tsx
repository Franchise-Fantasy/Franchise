import { useMemo } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import {
  useNflArchiveAwards,
  useNflArchiveBracket,
} from '@/hooks/useNflArchivePlayoffs';
import type {
  NflArchiveAwardEntry,
  NflArchiveFranchiseSeason,
  NflAwardType,
} from '@/types/archiveNflPlayoff';
import { ms, s } from '@/utils/scale';

interface Props {
  season: number | null;
  onPlayerTap?: (entry: NflArchiveAwardEntry) => void;
}

// Display order for solo awards. SB MVP is synthesized from
// nfl_playoff_year.sb_mvp_* (it lives there, not in nfl_season_award).
const SOLO_AWARDS: { type: NflAwardType; label: string; short: string }[] = [
  { type: 'mvp',           label: 'Most Valuable Player',          short: 'MVP' },
  { type: 'sb_mvp',        label: 'Super Bowl MVP',                short: 'SB MVP' },
  { type: 'opoy',          label: 'Offensive Player of the Year',  short: 'OPOY' },
  { type: 'dpoy',          label: 'Defensive Player of the Year',  short: 'DPOY' },
  { type: 'oroy',          label: 'Offensive Rookie of the Year',  short: 'OROY' },
  { type: 'droy',          label: 'Defensive Rookie of the Year',  short: 'DROY' },
  { type: 'comeback',      label: 'Comeback Player of the Year',   short: 'CPOY' },
  { type: 'coty',          label: 'Coach of the Year',             short: 'COTY' },
  { type: 'walter_payton', label: 'Walter Payton Man of the Year', short: 'WP MoY' },
];

interface TeamSection {
  title: string;
  tiers: { type: NflAwardType; label: string }[];
}

const TEAM_SECTIONS: TeamSection[] = [
  {
    title: 'All-Pro Teams',
    tiers: [
      { type: 'all_pro_first',  label: '1st Team' },
      { type: 'all_pro_second', label: '2nd Team' },
    ],
  },
];

export function NflSeasonAwards({ season, onPlayerTap }: Props) {
  const c = useArchiveColors();
  const { data: awards, isLoading } = useNflArchiveAwards(season);
  // Bracket is already cached by the parent screen — we use it for franchise
  // skins (logos/colors) and for the SB MVP fields on year metadata.
  const { data: bracket } = useNflArchiveBracket(season);

  const franchiseMap = useMemo(() => {
    const m = new Map<string, NflArchiveFranchiseSeason>();
    if (bracket?.franchises) {
      for (const f of bracket.franchises) m.set(f.franchise_id, f);
    }
    return m;
  }, [bracket?.franchises]);

  // Synthesize a SB MVP award entry from year metadata so it sits with the
  // other solo awards (it lives on nfl_playoff_year, not nfl_season_award).
  const sbMvpEntry: NflArchiveAwardEntry | null = useMemo(() => {
    const y = bracket?.year;
    if (!y?.sb_mvp_player_name) return null;
    return {
      rank: 1,
      unit: '',
      player_name: y.sb_mvp_player_name,
      pfr_player_id: y.sb_mvp_pfr_id,
      franchise_id: y.sb_mvp_franchise_id,
      position: null,
      stat_line: y.sb_mvp_stat_line,
    };
  }, [bracket?.year]);

  if (!season || isLoading || !awards) return null;

  const lookupSolo = (t: NflAwardType): NflArchiveAwardEntry | null => {
    if (t === 'sb_mvp') return sbMvpEntry;
    return awards[t]?.[0] ?? null;
  };

  const visibleSolos = SOLO_AWARDS.filter((a) => lookupSolo(a.type));
  const visibleTeamSections = TEAM_SECTIONS.filter((sec) =>
    sec.tiers.some((t) => (awards[t.type]?.length ?? 0) > 0),
  );

  if (visibleSolos.length === 0 && visibleTeamSections.length === 0) {
    return (
      <View style={styles.emptyState}>
        <ThemedText style={{ color: c.secondaryText, textAlign: 'center' }}>
          No awards curated for this season yet.
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {visibleSolos.length > 0 && (
        <View style={styles.section}>
          <SectionHeader title="Individual Awards" c={c} />
          <View style={[styles.soloCard, { backgroundColor: c.card, borderColor: c.border }]}>
            {visibleSolos.map(({ type, label, short }, i) => {
              const entry = lookupSolo(type)!;
              return (
                <SoloAwardRow
                  key={type}
                  label={label}
                  short={short}
                  entry={entry}
                  franchiseMap={franchiseMap}
                  onPress={onPlayerTap ? () => onPlayerTap(entry) : undefined}
                  isLast={i === visibleSolos.length - 1}
                />
              );
            })}
          </View>
        </View>
      )}

      {visibleTeamSections.map((sec) => (
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
  entry: NflArchiveAwardEntry;
  franchiseMap: Map<string, NflArchiveFranchiseSeason>;
  onPress?: () => void;
  isLast: boolean;
}) {
  const c = useArchiveColors();
  const franchise = entry.franchise_id
    ? franchiseMap.get(entry.franchise_id) ?? null
    : null;
  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper
      {...(onPress ? { onPress, activeOpacity: 0.7 } : {})}
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
              sport="nfl"
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
  rows: NflArchiveAwardEntry[];
  franchiseMap: Map<string, NflArchiveFranchiseSeason>;
  onPlayerTap?: (entry: NflArchiveAwardEntry) => void;
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
              key={`${entry.unit}-${entry.rank}-${entry.player_name}`}
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
                  sport="nfl"
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
    minWidth: s(56),
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
  soloPlayerCol: { flex: 1, minWidth: 0, gap: s(2) },
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
  posTag: { fontSize: ms(9), fontWeight: '700', letterSpacing: 0.4 },
  soloStatLine: {
    fontSize: ms(10),
    letterSpacing: 0.2,
    paddingLeft: s(28),
  },

  teamCard: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
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
