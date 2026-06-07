/**
 * MatchupActivity Live Activity (Dynamic Island + Lock Screen).
 *
 * JS-defined replacement for the old `plugins/live-activities/widget/MatchupActivityView.swift`.
 * The `'widget'` directive triggers babel-preset-expo's widgets-plugin, which extracts the
 * function source as a string. iOS evaluates that string in a JSContext that only has
 * `@expo/ui/swift-ui` components + modifiers on `globalThis` — anything referenced outside
 * the function body (module-level constants, helper functions) does NOT exist at render time.
 * Every value used by the layout must therefore live INSIDE the function (or inside its
 * inlined JSX). The cost is a few duplicated literals; the alternative is a black widget.
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

const MatchupActivityLayout = (props: MatchupActivityProps, _env: LiveActivityEnvironment) => {
  'widget';

  const WHITE = '#FFFFFF';
  const GREEN = '#22C55E';
  const RED = '#EF4444';
  const YELLOW = '#FACC15';
  const GREY = '#8E8E93';

  const gap = props.scoreGap;
  const gapColor = gap >= 0 ? GREEN : RED;
  const gapText = `${gap >= 0 ? '+' : ''}${gap.toFixed(1)}`;
  const myScoreText = props.myScore.toFixed(1);
  const oppScoreText = props.opponentScore.toFixed(1);

  const contributorVisible = props.biggestContributor.length > 0;
  const probVisible = typeof props.winProbability === 'number';
  const winPct = probVisible ? Math.round((props.winProbability ?? 0) * 100) : 0;
  const playersVisible = props.players.length > 0;
  const top5 = props.players.slice(0, 5);

  const teamColumn = (tricode: string, scoreText: string) => (
    <VStack spacing={2}>
      <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(WHITE), opacity(0.7)]}>
        {tricode}
      </Text>
      <Text modifiers={[font({ size: 22, weight: 'bold' }), foregroundStyle(WHITE)]}>
        {scoreText}
      </Text>
    </VStack>
  );

  const playerRow = (player: MatchupPlayerLine) => (
    <HStack spacing={6}>
      <Text modifiers={[font({ size: 9 }), foregroundStyle(player.isOnCourt ? GREEN : GREY)]}>●</Text>
      <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundStyle(WHITE), lineLimit(1)]}>
        {player.name}
      </Text>
      <Spacer />
      <Text modifiers={[font({ size: 11 }), foregroundStyle(WHITE), opacity(0.7)]}>
        {player.statLine}
      </Text>
      <Text
        modifiers={[
          font({ size: 11, weight: 'bold' }),
          foregroundStyle(WHITE),
          frame({ width: 36, alignment: 'trailing' }),
        ]}
      >
        {player.fantasyPoints.toFixed(1)}
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

  const playersList = playersVisible ? (
    <VStack spacing={3}>{top5.map(playerRow)}</VStack>
  ) : (
    <Text modifiers={[font({ size: 11 }), foregroundStyle(WHITE), opacity(0.4)]}>
      No active players
    </Text>
  );

  return {
    banner: (
      <VStack spacing={8} modifiers={[padding({ all: 16 })]}>
        <HStack>
          <VStack alignment="leading">
            <Text modifiers={[font({ size: 12 }), foregroundStyle(WHITE), opacity(0.7)]}>
              {props.myTeamTricode}
            </Text>
            <Text modifiers={[font({ size: 22, weight: 'bold' }), foregroundStyle(WHITE)]}>
              {myScoreText}
            </Text>
          </VStack>

          <Spacer />

          <VStack>
            <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(gapColor)]}>
              {gapText}
            </Text>
            {probVisible ? (
              <Text modifiers={[font({ size: 11 }), foregroundStyle(WHITE), opacity(0.6)]}>
                {`${winPct}%`}
              </Text>
            ) : null}
          </VStack>

          <Spacer />

          <VStack alignment="trailing">
            <Text modifiers={[font({ size: 12 }), foregroundStyle(WHITE), opacity(0.7)]}>
              {props.opponentTeamTricode}
            </Text>
            <Text modifiers={[font({ size: 22, weight: 'bold' }), foregroundStyle(WHITE)]}>
              {oppScoreText}
            </Text>
          </VStack>
        </HStack>

        {contributorVisible ? (
          <Text modifiers={[font({ size: 12 }), foregroundStyle(YELLOW)]}>
            {props.biggestContributor}
          </Text>
        ) : null}

        {playersVisible ? <Divider /> : null}
        {playersVisible ? playersList : null}

        <Text modifiers={[font({ size: 11 }), foregroundStyle(WHITE), opacity(0.4)]}>
          {`${props.myActivePlayers + props.opponentActivePlayers} games live`}
        </Text>
      </VStack>
    ),

    compactLeading: (
      <HStack spacing={4}>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
          {props.myTeamTricode}
        </Text>
        <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(WHITE)]}>
          {myScoreText}
        </Text>
      </HStack>
    ),
    compactTrailing: (
      <HStack spacing={4}>
        <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(WHITE)]}>
          {oppScoreText}
        </Text>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
          {props.opponentTeamTricode}
        </Text>
      </HStack>
    ),

    minimal: (
      <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(gapColor)]}>
        {gap.toFixed(0)}
      </Text>
    ),

    expandedLeading: teamColumn(props.myTeamTricode, myScoreText),
    expandedTrailing: teamColumn(props.opponentTeamTricode, oppScoreText),
    expandedCenter: (
      <VStack spacing={4}>
        <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(gapColor)]}>
          {gapText}
        </Text>
        {probVisible ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(WHITE), opacity(0.6)]}>
            {`${winPct}% win`}
          </Text>
        ) : null}
        {contributorVisible ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(YELLOW), lineLimit(1)]}>
            {props.biggestContributor}
          </Text>
        ) : null}
        <Text modifiers={[font({ size: 11 }), foregroundStyle(WHITE), opacity(0.5)]}>
          {`${props.myActivePlayers} vs ${props.opponentActivePlayers} playing`}
        </Text>
      </VStack>
    ),
    expandedBottom: playersList,
  };
};

export const MatchupActivity = createLiveActivity<MatchupActivityProps>('MatchupActivity', MatchupActivityLayout);
