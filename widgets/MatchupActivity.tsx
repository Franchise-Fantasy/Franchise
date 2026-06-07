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
import { Circle, Gauge, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { background, cornerRadius, font, foregroundStyle, frame, gaugeStyle, lineLimit, opacity, padding } from '@expo/ui/swift-ui/modifiers';
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
  const ACCENT = '#F59E0B';
  const PANEL = '#1C1C1E';
  const PANEL_DIM = '#2C2C2E';

  const gap = props.scoreGap;
  const myLeading = gap >= 0;
  const gapColor = myLeading ? GREEN : RED;
  const gapText = `${myLeading ? '+' : ''}${gap.toFixed(1)}`;
  const myScoreText = props.myScore.toFixed(1);
  const oppScoreText = props.opponentScore.toFixed(1);
  const myScoreColor = myLeading ? GREEN : WHITE;
  const oppScoreColor = !myLeading ? GREEN : WHITE;

  const contributorVisible = props.biggestContributor.length > 0;
  const probVisible = typeof props.winProbability === 'number';
  const winPct = probVisible ? Math.round((props.winProbability ?? 0) * 100) : 50;
  const playersVisible = props.players.length > 0;
  const top5 = props.players.slice(0, 5);
  const totalLive = props.myActivePlayers + props.opponentActivePlayers;

  return {
    banner: (
      <VStack spacing={10} modifiers={[padding({ all: 14 })]}>
        {/* Header: LIVE pill + basketball icon + "MATCHUP" */}
        <HStack spacing={8}>
          <HStack spacing={4} modifiers={[padding({ horizontal: 8, vertical: 3 }), background(RED, undefined as any), cornerRadius(8)]}>
            <Circle modifiers={[foregroundStyle(WHITE), frame({ width: 6, height: 6 })]} />
            <Text modifiers={[font({ size: 10, weight: 'bold' }), foregroundStyle(WHITE)]}>LIVE</Text>
          </HStack>
          <Image systemName="basketball.fill" size={12} color={ACCENT} />
          <Text modifiers={[font({ size: 10, weight: 'semibold' }), foregroundStyle(WHITE), opacity(0.55)]}>
            MATCHUP
          </Text>
          <Spacer />
          {totalLive > 0 ? (
            <HStack spacing={4}>
              <Image systemName="dot.radiowaves.left.and.right" size={11} color={ACCENT} />
              <Text modifiers={[font({ size: 10, weight: 'medium' }), foregroundStyle(WHITE), opacity(0.6)]}>
                {`${totalLive} live`}
              </Text>
            </HStack>
          ) : null}
        </HStack>

        {/* Scoreboard */}
        <HStack spacing={12}>
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), padding({ horizontal: 8, vertical: 2 }), background(PANEL_DIM, undefined as any), cornerRadius(6)]}>
              {props.myTeamTricode}
            </Text>
            <Text modifiers={[font({ size: 26, weight: 'bold' }), foregroundStyle(myScoreColor)]}>
              {myScoreText}
            </Text>
          </VStack>

          <Spacer />

          <VStack spacing={3}>
            <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(gapColor)]}>
              {gapText}
            </Text>
            {probVisible ? (
              <Gauge
                value={winPct / 100}
                min={0}
                max={1}
                modifiers={[gaugeStyle('linearCapacity'), frame({ width: 70 }), foregroundStyle(gapColor)]}
              />
            ) : null}
          </VStack>

          <Spacer />

          <VStack alignment="trailing" spacing={2}>
            <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), padding({ horizontal: 8, vertical: 2 }), background(PANEL_DIM, undefined as any), cornerRadius(6)]}>
              {props.opponentTeamTricode}
            </Text>
            <Text modifiers={[font({ size: 26, weight: 'bold' }), foregroundStyle(oppScoreColor)]}>
              {oppScoreText}
            </Text>
          </VStack>
        </HStack>

        {/* Biggest contributor */}
        {contributorVisible ? (
          <HStack spacing={6}>
            <Image systemName="flame.fill" size={12} color={YELLOW} />
            <Text modifiers={[font({ size: 12, weight: 'medium' }), foregroundStyle(YELLOW), lineLimit(1)]}>
              {props.biggestContributor}
            </Text>
          </HStack>
        ) : null}

        {/* Player ticker (top 5) */}
        {playersVisible ? (
          <VStack spacing={4} modifiers={[padding({ all: 8 }), background(PANEL, undefined as any), cornerRadius(10)]}>
            {top5.map((player) => (
              <HStack key={player.name} spacing={6}>
                <Image
                  systemName={player.isOnCourt ? 'circle.fill' : 'circle'}
                  size={8}
                  color={player.isOnCourt ? GREEN : GREY}
                />
                <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundStyle(WHITE), lineLimit(1)]}>
                  {player.name}
                </Text>
                <Spacer />
                <Text modifiers={[font({ size: 10 }), foregroundStyle(WHITE), opacity(0.55)]}>
                  {player.statLine}
                </Text>
                <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), frame({ width: 38, alignment: 'trailing' })]}>
                  {player.fantasyPoints.toFixed(1)}
                </Text>
                <Text modifiers={[font({ size: 9 }), foregroundStyle(WHITE), opacity(0.4), frame({ width: 42, alignment: 'trailing' })]}>
                  {player.gameStatus}
                </Text>
              </HStack>
            ))}
          </VStack>
        ) : null}
      </VStack>
    ),

    compactLeading: (
      <HStack spacing={4}>
        <Image
          systemName={myLeading ? 'arrowtriangle.up.fill' : 'circle.fill'}
          size={9}
          color={myLeading ? GREEN : ACCENT}
        />
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
          {props.myTeamTricode}
        </Text>
        <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(myScoreColor)]}>
          {myScoreText}
        </Text>
      </HStack>
    ),
    compactTrailing: (
      <HStack spacing={4}>
        <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(oppScoreColor)]}>
          {oppScoreText}
        </Text>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
          {props.opponentTeamTricode}
        </Text>
        <Image
          systemName={!myLeading ? 'arrowtriangle.up.fill' : 'circle.fill'}
          size={9}
          color={!myLeading ? GREEN : ACCENT}
        />
      </HStack>
    ),

    minimal: (
      <HStack spacing={2}>
        <Image
          systemName={myLeading ? 'arrowtriangle.up.fill' : 'arrowtriangle.down.fill'}
          size={9}
          color={gapColor}
        />
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(gapColor)]}>
          {Math.abs(gap).toFixed(0)}
        </Text>
      </HStack>
    ),

    expandedLeading: (
      <VStack alignment="leading" spacing={3} modifiers={[padding({ leading: 4 })]}>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), padding({ horizontal: 8, vertical: 2 }), background(PANEL_DIM, undefined as any), cornerRadius(6)]}>
          {props.myTeamTricode}
        </Text>
        <Text modifiers={[font({ size: 22, weight: 'bold' }), foregroundStyle(myScoreColor)]}>
          {myScoreText}
        </Text>
        <HStack spacing={3}>
          <Image systemName="person.2.fill" size={9} color={GREY} />
          <Text modifiers={[font({ size: 9 }), foregroundStyle(WHITE), opacity(0.5)]}>
            {`${props.myActivePlayers} live`}
          </Text>
        </HStack>
      </VStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={3} modifiers={[padding({ trailing: 4 })]}>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), padding({ horizontal: 8, vertical: 2 }), background(PANEL_DIM, undefined as any), cornerRadius(6)]}>
          {props.opponentTeamTricode}
        </Text>
        <Text modifiers={[font({ size: 22, weight: 'bold' }), foregroundStyle(oppScoreColor)]}>
          {oppScoreText}
        </Text>
        <HStack spacing={3}>
          <Image systemName="person.2.fill" size={9} color={GREY} />
          <Text modifiers={[font({ size: 9 }), foregroundStyle(WHITE), opacity(0.5)]}>
            {`${props.opponentActivePlayers} live`}
          </Text>
        </HStack>
      </VStack>
    ),
    expandedCenter: (
      <VStack spacing={4}>
        <Text modifiers={[font({ size: 14, weight: 'bold' }), foregroundStyle(gapColor)]}>
          {gapText}
        </Text>
        {probVisible ? (
          <Gauge
            value={winPct / 100}
            min={0}
            max={1}
            modifiers={[gaugeStyle('linearCapacity'), frame({ width: 80 }), foregroundStyle(gapColor)]}
          />
        ) : null}
        {contributorVisible ? (
          <HStack spacing={4}>
            <Image systemName="flame.fill" size={10} color={YELLOW} />
            <Text modifiers={[font({ size: 10, weight: 'medium' }), foregroundStyle(YELLOW), lineLimit(1)]}>
              {props.biggestContributor}
            </Text>
          </HStack>
        ) : null}
      </VStack>
    ),
    expandedBottom: playersVisible ? (
      <VStack spacing={3} modifiers={[padding({ horizontal: 4, top: 4 })]}>
        {top5.map((player) => (
          <HStack key={player.name} spacing={6}>
            <Image
              systemName={player.isOnCourt ? 'circle.fill' : 'circle'}
              size={8}
              color={player.isOnCourt ? GREEN : GREY}
            />
            <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundStyle(WHITE), lineLimit(1)]}>
              {player.name}
            </Text>
            <Spacer />
            <Text modifiers={[font({ size: 10 }), foregroundStyle(WHITE), opacity(0.6)]}>
              {player.statLine}
            </Text>
            <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), frame({ width: 38, alignment: 'trailing' })]}>
              {player.fantasyPoints.toFixed(1)}
            </Text>
          </HStack>
        ))}
      </VStack>
    ) : (
      <HStack spacing={6} modifiers={[padding({ top: 4 })]}>
        <Image systemName="hourglass" size={11} color={GREY} />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(WHITE), opacity(0.45)]}>
          Waiting for tip-off
        </Text>
      </HStack>
    ),
  };
};

export const MatchupActivity = createLiveActivity<MatchupActivityProps>('MatchupActivity', MatchupActivityLayout);
