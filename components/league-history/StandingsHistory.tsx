import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import type { TeamSeasonRow } from '@/hooks/leagueHistory/types';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import { useSeasonStandings } from '@/hooks/useLeagueHistory';
import { PLAYOFF_RESULT } from '@/types/playoff';
import { ms, s } from '@/utils/scale';

interface StandingsHistoryProps {
  leagueId: string;
}

export function StandingsHistory({ leagueId }: StandingsHistoryProps) {
  const c = useColors();
  const { teamId } = useAppState();
  const { data: league } = useLeague();
  const { data: standings, isLoading } = useSeasonStandings(leagueId);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);

  const seasons = useMemo(() => {
    if (!standings || standings.length === 0) return [];
    const set = new Set(standings.map((r) => r.season));
    return [...set];
  }, [standings]);

  const activeSeason = selectedSeason ?? seasons[0] ?? null;

  const seasonTeams = useMemo(() => {
    if (!standings || !activeSeason) return [];
    return standings.filter((r) => r.season === activeSeason);
  }, [standings, activeSeason]);

  const anyTies = seasonTeams.some((t) => (t.ties ?? 0) > 0);

  // A season only splits into division blocks if every team that season has
  // a division recorded — older imports/seasons predating divisions leave it
  // null and stay one flat list.
  const div1Teams = seasonTeams.filter((t) => t.division === 1);
  const div2Teams = seasonTeams.filter((t) => t.division === 2);
  const hasDivisions = div1Teams.length > 0 && div2Teams.length > 0
    && div1Teams.length + div2Teams.length === seasonTeams.length;

  if (isLoading) return <View style={styles.loading}><LogoSpinner /></View>;
  if (seasons.length === 0) {
    return (
      <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
        Complete a season to build standings history.
      </ThemedText>
    );
  }

  return (
    <View>
      {/* Season picker — varsity caps pills, Turf Green selected. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRowContent}
        style={styles.pillRow}
      >
        {seasons.map((season) => {
          const isSelected = activeSeason === season;
          return (
            <TouchableOpacity
              key={season}
              accessibilityRole="button"
              accessibilityLabel={`Season ${season}`}
              accessibilityState={{ selected: isSelected }}
              style={[
                styles.pill,
                { borderColor: c.border },
                isSelected
                  ? { backgroundColor: c.primary, borderColor: c.primary }
                  : { backgroundColor: c.cardAlt },
              ]}
              onPress={() => setSelectedSeason(season)}
            >
              <ThemedText
                type="varsitySmall"
                style={[
                  styles.pillText,
                  { color: isSelected ? Brand.ecru : c.secondaryText },
                ]}
              >
                {season}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Standings table — flex layout, fits the card width without
          horizontal scrolling. Columns: rank, logo, team name (flex),
          record, PF, PA. */}
      <View style={[styles.tableHeader, { borderBottomColor: c.border }]}>
        <ThemedText type="varsitySmall" style={[styles.rankText, { color: c.secondaryText }]}>#</ThemedText>
        <View style={styles.logoSlot} />
        <ThemedText type="varsitySmall" style={[styles.teamNameHeader, { color: c.secondaryText }]}>
          Team
        </ThemedText>
        <ThemedText type="varsitySmall" style={[styles.recordHeader, { color: c.secondaryText }]}>
          {anyTies ? 'W-L-T' : 'W-L'}
        </ThemedText>
        <ThemedText type="varsitySmall" style={[styles.statCol, { color: c.secondaryText }]}>
          PF
        </ThemedText>
        <ThemedText type="varsitySmall" style={[styles.statCol, { color: c.secondaryText }]}>
          PA
        </ThemedText>
      </View>

      {hasDivisions ? (
        <>
          {renderDivisionRows(div1Teams, league?.division_1_name ?? 'Division 1')}
          {renderDivisionRows(div2Teams, league?.division_2_name ?? 'Division 2')}
        </>
      ) : (
        renderRows(seasonTeams)
      )}
    </View>
  );

  function renderDivisionRows(teams: TeamSeasonRow[], divisionName: string) {
    return (
      <View key={divisionName} style={styles.divisionBlock}>
        <ThemedText
          type="varsitySmall"
          style={[styles.divisionHeader, { color: c.secondaryText }]}
          accessibilityRole="header"
        >
          {divisionName}
        </ThemedText>
        {renderRows(teams)}
      </View>
    );
  }

  function renderRows(teams: TeamSeasonRow[]) {
    return teams.map((t, idx) => {
      const isMe = !!teamId && t.team_id === teamId;
      const standing = t.final_standing ?? idx + 1;
      const isMissed = t.playoff_result === PLAYOFF_RESULT.MISSED_PLAYOFFS;
      const displayName = t.team_name ?? t.team?.name ?? '—';
      const record = anyTies
        ? `${t.wins}-${t.losses}-${t.ties}`
        : `${t.wins}-${t.losses}`;
      return (
        <View
          key={t.id}
          style={[
            styles.tableRow,
            { borderBottomColor: c.border },
            idx === teams.length - 1 && { borderBottomWidth: 0 },
            isMe && { backgroundColor: c.activeCard },
          ]}
          accessibilityLabel={`${displayName === '—' ? 'Unknown' : displayName}, rank ${standing}, record ${record}, ${t.playoff_result ?? 'no result'}`}
        >
          <Text
            style={[
              styles.rankText,
              { color: isMissed ? c.danger : c.secondaryText },
            ]}
          >
            {standing}
          </Text>
          <View style={styles.logoSlot}>
            <TeamLogo
              logoKey={t.team?.logo_key ?? null}
              teamName={t.team?.name ?? 'Team'}
              tricode={t.team?.tricode ?? undefined}
              size="small"
            />
          </View>
          <View style={styles.teamNameCol}>
            <ThemedText
              style={[
                styles.teamName,
                { color: c.text, fontWeight: isMe ? '700' : '500' },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {displayName}
            </ThemedText>
          </View>
          <View style={styles.recordCell}>
            <ThemedText type="mono" style={[styles.recordText, { color: c.text }]}>
              {record}
            </ThemedText>
          </View>
          <ThemedText type="mono" style={[styles.statCol, { color: c.secondaryText }]}>
            {Math.round(Number(t.points_for ?? 0))}
          </ThemedText>
          <ThemedText type="mono" style={[styles.statCol, { color: c.secondaryText }]}>
            {Math.round(Number(t.points_against ?? 0))}
          </ThemedText>
        </View>
      );
    });
  }
}

const styles = StyleSheet.create({
  emptyText: { fontSize: ms(13), textAlign: 'center', paddingVertical: s(16) },
  loading: { paddingVertical: s(24) },

  pillRow: {
    marginBottom: s(12),
    marginHorizontal: -s(4),
  },
  pillRowContent: {
    paddingHorizontal: s(4),
    gap: s(8),
  },
  pill: {
    paddingHorizontal: s(14),
    paddingVertical: s(7),
    borderRadius: 8,
    borderWidth: 1,
  },
  pillText: {
    fontSize: ms(10),
  },

  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    paddingHorizontal: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: -s(4),
  },
  // Row extends past the parent card's padding so the isMe highlight
  // spans near-full card width. Internal paddingHorizontal keeps column
  // content inset matching the header.
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: -s(4),
  },
  divisionBlock: {
    marginBottom: s(10),
  },
  divisionHeader: {
    fontSize: ms(10),
    letterSpacing: 0.8,
    marginTop: s(6),
    marginBottom: s(2),
    paddingHorizontal: s(4),
  },
  rankText: {
    width: s(22),
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    textAlign: 'left',
    letterSpacing: 0.5,
  },
  logoSlot: {
    width: s(26),
    alignItems: 'flex-start',
  },
  // Team name flexes into remaining space so the row fills the card
  // without horizontal scroll.
  teamNameCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: s(8),
    minWidth: 0,
  },
  teamNameHeader: {
    flex: 1,
    marginLeft: s(8),
  },
  teamName: {
    flexShrink: 1,
    fontSize: ms(13),
  },
  recordCell: {
    width: s(46),
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(3),
    borderRadius: 4,
    marginLeft: s(4),
  },
  recordHeader: {
    width: s(46),
    textAlign: 'center',
    marginLeft: s(4),
  },
  recordText: {
    fontSize: ms(12),
  },
  statCol: {
    width: s(38),
    textAlign: 'right',
    fontSize: ms(11.5),
    marginLeft: s(4),
  },
});
