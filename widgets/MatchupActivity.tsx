/**
 * MatchupActivity Live Activity (Dynamic Island + Lock Screen).
 *
 * JS-defined replacement for the old `plugins/live-activities/widget/MatchupActivityView.swift`.
 * Compiled to SwiftUI by expo-widgets at build time — uses only `@expo/ui/swift-ui` primitives.
 *
 * The Props shape MUST match the contentState contract that the backend pushes via APNs
 * (see `supabase/functions/_shared/apns.ts` topic `com.chewers.franchisev2.push-type.liveactivity`,
 * dispatch sites in `poll-live-stats` and `get-week-scores`). Field renames here require
 * matching renames there.
 *
 * @platform ios 16.1+
 */
import { Divider, HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, frame, lineLimit, opacity, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

const WHITE = '#FFFFFF';
const GREEN = '#22C55E';
const RED = '#EF4444';
const YELLOW = '#FACC15';

export type MatchupPlayerLine = {
  name: string;
  statLine: string;
  fantasyPoints: number;
  gameStatus: string;
  isOnCourt: boolean;
};

export type MatchupActivityProps = {
  myTeamName: string;
  opponentTeamName: string;
  myTeamTricode: string;
  opponentTeamTricode: string;

  myScore: number;
  opponentScore: number;
  scoreGap: number;
  winProbability?: number;
  biggestContributor: string;
  myActivePlayers: number;
  opponentActivePlayers: number;
  players: MatchupPlayerLine[];
};

const formatScore = (n: number) => n.toFixed(1);
const formatGap = (gap: number) => `${gap >= 0 ? '+' : ''}${gap.toFixed(1)}`;
const gapColor = (gap: number) => (gap >= 0 ? GREEN : RED);

const teamColumn = (tricode: string, score: number) => (
  <VStack spacing={2}>
    <Text modifiers={[font({ textStyle: 'caption', weight: 'semibold' }), foregroundStyle(WHITE), opacity(0.7)]}>
      {tricode}
    </Text>
    <Text modifiers={[font({ textStyle: 'title2', weight: 'bold' }), foregroundStyle(WHITE)]}>
      {formatScore(score)}
    </Text>
  </VStack>
);

const playerRow = (player: MatchupPlayerLine) => (
  <HStack spacing={6}>
    <Text modifiers={[font({ size: 9 }), foregroundStyle(player.isOnCourt ? GREEN : '#8E8E93')]}>●</Text>
    <Text modifiers={[font({ textStyle: 'caption2', weight: 'medium' }), foregroundStyle(WHITE), lineLimit(1)]}>
      {player.name}
    </Text>
    <Spacer />
    <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(WHITE), opacity(0.7)]}>
      {player.statLine}
    </Text>
    <Text
      modifiers={[
        font({ textStyle: 'caption2', weight: 'bold' }),
        foregroundStyle(WHITE),
        frame({ width: 36, alignment: 'trailing' }),
      ]}
    >
      {formatScore(player.fantasyPoints)}
    </Text>
    <Text
      modifiers={[
        font({ size: 9 }),
        foregroundStyle(WHITE),
        opacity(0.5),
        frame({ width: 42, alignment: 'trailing' }),
      ]}
    >
      {player.gameStatus}
    </Text>
  </HStack>
);

const playersList = (players: MatchupPlayerLine[]) =>
  players.length === 0 ? (
    <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(WHITE), opacity(0.4)]}>
      No active players
    </Text>
  ) : (
    <VStack spacing={3}>{players.slice(0, 5).map(playerRow)}</VStack>
  );

const MatchupActivityLayout = (props: MatchupActivityProps, _env: LiveActivityEnvironment) => {
  'widget';

  const gap = props.scoreGap;
  const contributorVisible = props.biggestContributor.length > 0;
  const probVisible = typeof props.winProbability === 'number';
  const playersVisible = props.players.length > 0;

  return {
    // Lock screen / Notification Center banner
    banner: (
      <VStack spacing={8} modifiers={[padding({ all: 16 })]}>
        <HStack>
          <VStack alignment="leading">
            <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(WHITE), opacity(0.7)]}>
              {props.myTeamTricode}
            </Text>
            <Text modifiers={[font({ textStyle: 'title2', weight: 'bold' }), foregroundStyle(WHITE)]}>
              {formatScore(props.myScore)}
            </Text>
          </VStack>

          <Spacer />

          <VStack>
            <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(gapColor(gap))]}>
              {formatGap(gap)}
            </Text>
            {probVisible ? (
              <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(WHITE), opacity(0.6)]}>
                {`${Math.round((props.winProbability ?? 0) * 100)}%`}
              </Text>
            ) : null}
          </VStack>

          <Spacer />

          <VStack alignment="trailing">
            <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(WHITE), opacity(0.7)]}>
              {props.opponentTeamTricode}
            </Text>
            <Text modifiers={[font({ textStyle: 'title2', weight: 'bold' }), foregroundStyle(WHITE)]}>
              {formatScore(props.opponentScore)}
            </Text>
          </VStack>
        </HStack>

        {contributorVisible ? (
          <Text modifiers={[font({ textStyle: 'caption' }), foregroundStyle(YELLOW)]}>
            {props.biggestContributor}
          </Text>
        ) : null}

        {playersVisible ? <Divider /> : null}
        {playersVisible ? playersList(props.players) : null}

        <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(WHITE), opacity(0.4)]}>
          {`${props.myActivePlayers + props.opponentActivePlayers} games live`}
        </Text>
      </VStack>
    ),

    // Dynamic Island — compact (default)
    compactLeading: (
      <HStack spacing={4}>
        <Text modifiers={[font({ textStyle: 'caption2', weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
          {props.myTeamTricode}
        </Text>
        <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(WHITE)]}>
          {formatScore(props.myScore)}
        </Text>
      </HStack>
    ),
    compactTrailing: (
      <HStack spacing={4}>
        <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(WHITE)]}>
          {formatScore(props.opponentScore)}
        </Text>
        <Text modifiers={[font({ textStyle: 'caption2', weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
          {props.opponentTeamTricode}
        </Text>
      </HStack>
    ),

    // Dynamic Island — minimal (when multiple activities compete)
    minimal: (
      <Text modifiers={[font({ textStyle: 'caption2', weight: 'bold' }), foregroundStyle(gapColor(gap))]}>
        {gap.toFixed(0)}
      </Text>
    ),

    // Dynamic Island — expanded (long press)
    expandedLeading: teamColumn(props.myTeamTricode, props.myScore),
    expandedTrailing: teamColumn(props.opponentTeamTricode, props.opponentScore),
    expandedCenter: (
      <VStack spacing={4}>
        <Text modifiers={[font({ textStyle: 'caption', weight: 'bold' }), foregroundStyle(gapColor(gap))]}>
          {formatGap(gap)}
        </Text>
        {probVisible ? (
          <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(WHITE), opacity(0.6)]}>
            {`${Math.round((props.winProbability ?? 0) * 100)}% win`}
          </Text>
        ) : null}
        {contributorVisible ? (
          <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(YELLOW), lineLimit(1)]}>
            {props.biggestContributor}
          </Text>
        ) : null}
        <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(WHITE), opacity(0.5)]}>
          {`${props.myActivePlayers} vs ${props.opponentActivePlayers} playing`}
        </Text>
      </VStack>
    ),
    expandedBottom: playersList(props.players),
  };
};

export const MatchupActivity = createLiveActivity<MatchupActivityProps>('MatchupActivity', MatchupActivityLayout);
