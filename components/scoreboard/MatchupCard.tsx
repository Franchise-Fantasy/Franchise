import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { Badge } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts, cardShadow } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';
import { formatScore } from '@/utils/scoring/fantasyPoints';

export type MatchupCardStatus = 'live' | 'final' | 'upcoming';

export interface MatchupCardTeam {
  id: string;
  name: string;
  logoKey: string | null;
  record: string;
  /** Numeric points score (used in points leagues + tie-break in categories). */
  score: number;
  /** Display string, may be `5-3-1` for categories or formatted points. */
  display: string;
  seed: number | null;
}

interface MatchupCardProps {
  home: MatchupCardTeam;
  /** Null when the home team has a bye. */
  away: MatchupCardTeam | null;
  status: MatchupCardStatus;
  /** Highlight: this is the user's matchup. Adds gold edge stripe + tinted bg. */
  isMine: boolean;
  /** Hide scores entirely (upcoming weeks). */
  hideScores: boolean;
  /** Categories scoring — display strings like `5-3-1` show in slab font. */
  isCategories: boolean;
  /** Which side is currently winning (drives accent gold on the score). */
  winningSide: 'home' | 'away' | null;
  /** Shown as a small varsity-caps eyebrow on the card (e.g. "FINALS"). */
  roundLabel?: string | null;
  onPress: () => void;
}

/**
 * Broadcast scoreboard card. Two team blocks (logo + name + record + seed)
 * with big slab numerals to the right. The user's own matchup gets a
 * vintageGold left edge stripe + tinted background.
 *
 * Top eyebrow band combines the round label (left, gold varsity caps —
 * "FINALS", "QUARTERFINALS") with the status pill (right — LIVE merlot,
 * FINAL turf, UPCOMING neutral) so the chrome stays consistent across
 * regular-season and playoff weeks.
 */
export function MatchupCard({
  home,
  away,
  status,
  isMine,
  hideScores,
  isCategories,
  winningSide,
  roundLabel,
  onPress,
}: MatchupCardProps) {
  const c = useColors();

  const a11y = `${roundLabel ? `${roundLabel}, ` : ''}${home.name}${
    !hideScores ? ` ${formatScore(home.score)}` : ''
  } versus ${
    away
      ? `${away.name}${!hideScores ? ` ${formatScore(away.score)}` : ''}`
      : 'BYE'
  }${isMine ? ', your matchup' : ''}`;

  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: isMine ? c.activeCard : c.card,
          borderColor: isMine ? c.gold : c.border,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="View matchup details"
    >
      {/* Gold edge stripe — only on the user's own matchup */}
      {isMine && (
        <View style={[styles.edgeStripe, { backgroundColor: c.gold }]} />
      )}

      {/* Eyebrow band — only earns its keep when there's a round label to
          show (playoffs). Status pill is omitted in the regular season
          because the WeekRail banner above already carries that signal for
          the whole week, and per-card status pills would be repeated chrome. */}
      {roundLabel && (
        <View style={styles.eyebrowRow}>
          <ThemedText
            type="varsitySmall"
            style={[styles.roundLabel, { color: c.gold }]}
            numberOfLines={1}
          >
            {roundLabel.toUpperCase()}
          </ThemedText>
          <StatusPill status={status} />
        </View>
      )}

      {/* Home team row */}
      <TeamRow
        team={home}
        winning={winningSide === 'home' && !hideScores}
        hideScore={hideScores}
        isCategories={isCategories}
        accentColor={c.gold}
        baseColor={c.text}
        mutedColor={c.secondaryText}
      />

      {/* Center divider with VS badge */}
      <View style={styles.dividerRow}>
        <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
        <ThemedText
          type="varsitySmall"
          style={[styles.vsText, { color: c.secondaryText }]}
        >
          VS
        </ThemedText>
        <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
      </View>

      {/* Away team row (or BYE) */}
      {away ? (
        <TeamRow
          team={away}
          winning={winningSide === 'away' && !hideScores}
          hideScore={hideScores}
          isCategories={isCategories}
          accentColor={c.gold}
          baseColor={c.text}
          mutedColor={c.secondaryText}
        />
      ) : (
        <View style={styles.byeRow}>
          <ThemedText
            type="varsity"
            style={[styles.byeText, { color: c.secondaryText }]}
          >
            BYE
          </ThemedText>
        </View>
      )}
    </TouchableOpacity>
  );
}

function StatusPill({ status }: { status: MatchupCardStatus }) {
  if (status === 'live') return <Badge label="LIVE" variant="merlot" size="small" />;
  if (status === 'final') return <Badge label="FINAL" variant="turf" size="small" />;
  return <Badge label="UPCOMING" variant="neutral" size="small" />;
}

function TeamRow({
  team,
  winning,
  hideScore,
  isCategories,
  accentColor,
  baseColor,
  mutedColor,
}: {
  team: MatchupCardTeam;
  winning: boolean;
  hideScore: boolean;
  isCategories: boolean;
  accentColor: string;
  baseColor: string;
  mutedColor: string;
}) {
  return (
    <View style={styles.teamRow}>
      <TeamLogo logoKey={team.logoKey} teamName={team.name} size="medium" />
      <View style={styles.teamMeta}>
        <View style={styles.teamNameRow}>
          {team.seed != null && (
            <Badge
              label={`#${team.seed}`}
              variant="turf"
              size="small"
              style={styles.seedBadge}
            />
          )}
          <ThemedText
            style={[styles.teamName, { color: baseColor }]}
            numberOfLines={1}
          >
            {team.name}
          </ThemedText>
        </View>
        <ThemedText
          type="varsitySmall"
          style={[styles.record, { color: mutedColor }]}
        >
          {team.record}
        </ThemedText>
      </View>

      {!hideScore && (
        <ThemedText
          style={[
            isCategories ? styles.scoreCategories : styles.scorePoints,
            { color: winning ? accentColor : baseColor },
          ]}
        >
          {team.display}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(14),
    paddingTop: s(12),
    paddingBottom: s(14),
    marginBottom: s(12),
    overflow: 'hidden',
    ...cardShadow,
  },
  edgeStripe: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: s(8),
    gap: s(8),
  },
  roundLabel: {
    flex: 1,
    fontSize: ms(11),
    letterSpacing: 1.4,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  teamMeta: {
    flex: 1,
    minWidth: 0,
  },
  teamNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    marginBottom: s(2),
  },
  seedBadge: {
    alignSelf: 'center',
  },
  teamName: {
    fontFamily: Fonts.display,
    fontSize: ms(15),
    lineHeight: ms(20),
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  record: {
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
  // Explicit lineHeight on scores — without it, ThemedText's default 24px
  // line-height clips the descender on the bigger slab/mono numerals.
  scorePoints: {
    fontFamily: Fonts.mono,
    fontSize: ms(22),
    lineHeight: ms(30),
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  scoreCategories: {
    fontFamily: Fonts.display,
    fontSize: ms(18),
    lineHeight: ms(26),
    letterSpacing: 0.2,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    marginVertical: s(10),
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  vsText: {
    fontSize: ms(10),
    letterSpacing: 1.4,
  },
  byeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingLeft: s(46), // align with team name column
  },
  byeText: {
    fontSize: ms(12),
    letterSpacing: 1.5,
  },
});

