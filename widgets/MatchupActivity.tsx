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

export type MatchupCategoryLine = {
  stat: string;
  myValue: number;
  oppValue: number;
  winner: 'me' | 'opp' | 'tie';
  inverse: boolean;
};

export type MatchupActivityProps = {
  mode: 'points' | 'categories';

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

  // Populated when mode === 'points'
  players: MatchupPlayerLine[];

  // Populated when mode === 'categories'
  categories?: MatchupCategoryLine[];
  catTies?: number;

  // Optional relative paths into the App Group container (logos/<teamId>.png).
  // Widget prepends the container path at render. Falls back to tricode pill when absent.
  myLogoPath?: string;
  opponentLogoPath?: string;
  appGroupPath?: string;
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

  const isCats = props.mode === 'categories';

  const gap = props.scoreGap;
  const myLeading = gap > 0;
  const tiedOverall = gap === 0;
  const gapColor = tiedOverall ? WHITE : myLeading ? GREEN : RED;
  const myScoreText = isCats ? String(Math.round(props.myScore)) : props.myScore.toFixed(1);
  const oppScoreText = isCats ? String(Math.round(props.opponentScore)) : props.opponentScore.toFixed(1);
  const myScoreColor = tiedOverall ? WHITE : myLeading ? GREEN : WHITE;
  const oppScoreColor = tiedOverall ? WHITE : !myLeading ? GREEN : WHITE;

  // gapText differs per mode: cats show a record like "5-3-1"; points show "+12.4"
  const ties = props.catTies ?? 0;
  const catRecord = ties > 0
    ? `${Math.round(props.myScore)}-${Math.round(props.opponentScore)}-${ties}`
    : `${Math.round(props.myScore)}-${Math.round(props.opponentScore)}`;
  const gapText = isCats
    ? catRecord
    : `${myLeading ? '+' : ''}${gap.toFixed(1)}`;
  const minimalGapText = isCats
    ? String(Math.abs(Math.round(gap)))
    : Math.abs(gap).toFixed(0);

  const contributorVisible = props.biggestContributor.length > 0;
  const probVisible = !isCats && typeof props.winProbability === 'number';
  const winPct = probVisible ? Math.round((props.winProbability ?? 0) * 100) : 50;
  const playersVisible = !isCats && props.players.length > 0;
  const top5 = props.players.slice(0, 5);
  const catsVisible = isCats && (props.categories?.length ?? 0) > 0;
  const cats = props.categories ?? [];
  const topCats = cats.slice(0, 6);
  const topCatsExpanded = cats.slice(0, 4);
  const totalLive = props.myActivePlayers + props.opponentActivePlayers;

  const headerLabel = isCats ? 'CATEGORIES' : 'MATCHUP';

  return {
    banner: (
      <VStack spacing={10} modifiers={[padding({ all: 14 })]}>
        {/* Header */}
        <HStack spacing={8}>
          <HStack spacing={4} modifiers={[padding({ horizontal: 8, vertical: 3 }), background(RED, undefined as any), cornerRadius(8)]}>
            <Circle modifiers={[foregroundStyle(WHITE), frame({ width: 6, height: 6 })]} />
            <Text modifiers={[font({ size: 10, weight: 'bold' }), foregroundStyle(WHITE)]}>LIVE</Text>
          </HStack>
          <Image systemName="basketball.fill" size={12} color={ACCENT} />
          <Text modifiers={[font({ size: 10, weight: 'semibold' }), foregroundStyle(WHITE), opacity(0.55)]}>
            {headerLabel}
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

        {/* Top contributor / top category */}
        {contributorVisible ? (
          <HStack spacing={6}>
            <Image systemName="flame.fill" size={12} color={YELLOW} />
            <Text modifiers={[font({ size: 12, weight: 'medium' }), foregroundStyle(YELLOW), lineLimit(1)]}>
              {props.biggestContributor}
            </Text>
          </HStack>
        ) : null}

        {/* Ticker (players in points mode, categories in CAT mode) */}
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

        {catsVisible ? (
          <VStack spacing={4} modifiers={[padding({ all: 8 }), background(PANEL, undefined as any), cornerRadius(10)]}>
            {topCats.map((cat) => {
              const isPct = cat.stat.endsWith('%');
              const myVal = isPct ? cat.myValue.toFixed(3).replace(/^0/, '') : String(Math.round(cat.myValue));
              const oppVal = isPct ? cat.oppValue.toFixed(3).replace(/^0/, '') : String(Math.round(cat.oppValue));
              const winColor = cat.winner === 'me' ? GREEN : cat.winner === 'opp' ? RED : GREY;
              const winSymbol = cat.winner === 'me' ? 'arrowtriangle.up.fill' : cat.winner === 'opp' ? 'arrowtriangle.down.fill' : 'equal';
              return (
                <HStack key={cat.stat} spacing={6}>
                  <Image systemName={winSymbol} size={8} color={winColor} />
                  <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), frame({ width: 36, alignment: 'leading' })]}>
                    {cat.stat}
                  </Text>
                  {cat.inverse ? (
                    <Text modifiers={[font({ size: 8 }), foregroundStyle(GREY)]}>↓</Text>
                  ) : null}
                  <Spacer />
                  <Text modifiers={[font({ size: 11, weight: cat.winner === 'me' ? 'bold' : 'regular' }), foregroundStyle(cat.winner === 'me' ? GREEN : WHITE), frame({ width: 50, alignment: 'trailing' })]}>
                    {myVal}
                  </Text>
                  <Text modifiers={[font({ size: 11 }), foregroundStyle(GREY), opacity(0.5)]}>vs</Text>
                  <Text modifiers={[font({ size: 11, weight: cat.winner === 'opp' ? 'bold' : 'regular' }), foregroundStyle(cat.winner === 'opp' ? GREEN : WHITE), frame({ width: 50, alignment: 'leading' })]}>
                    {oppVal}
                  </Text>
                </HStack>
              );
            })}
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
          systemName={!myLeading && !tiedOverall ? 'arrowtriangle.up.fill' : 'circle.fill'}
          size={9}
          color={!myLeading && !tiedOverall ? GREEN : ACCENT}
        />
      </HStack>
    ),

    minimal: (
      <HStack spacing={2}>
        <Image
          systemName={tiedOverall ? 'equal' : myLeading ? 'arrowtriangle.up.fill' : 'arrowtriangle.down.fill'}
          size={9}
          color={gapColor}
        />
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(gapColor)]}>
          {minimalGapText}
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
    ) : catsVisible ? (
      <VStack spacing={3} modifiers={[padding({ horizontal: 4, top: 4 })]}>
        {topCatsExpanded.map((cat) => {
          const isPct = cat.stat.endsWith('%');
          const myVal = isPct ? cat.myValue.toFixed(3).replace(/^0/, '') : String(Math.round(cat.myValue));
          const oppVal = isPct ? cat.oppValue.toFixed(3).replace(/^0/, '') : String(Math.round(cat.oppValue));
          const winColor = cat.winner === 'me' ? GREEN : cat.winner === 'opp' ? RED : GREY;
          const winSymbol = cat.winner === 'me' ? 'arrowtriangle.up.fill' : cat.winner === 'opp' ? 'arrowtriangle.down.fill' : 'equal';
          return (
            <HStack key={cat.stat} spacing={6}>
              <Image systemName={winSymbol} size={8} color={winColor} />
              <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), frame({ width: 36, alignment: 'leading' })]}>
                {cat.stat}
              </Text>
              <Spacer />
              <Text modifiers={[font({ size: 11, weight: cat.winner === 'me' ? 'bold' : 'regular' }), foregroundStyle(cat.winner === 'me' ? GREEN : WHITE), frame({ width: 48, alignment: 'trailing' })]}>
                {myVal}
              </Text>
              <Text modifiers={[font({ size: 9 }), foregroundStyle(GREY), opacity(0.5)]}>vs</Text>
              <Text modifiers={[font({ size: 11, weight: cat.winner === 'opp' ? 'bold' : 'regular' }), foregroundStyle(cat.winner === 'opp' ? GREEN : WHITE), frame({ width: 48, alignment: 'leading' })]}>
                {oppVal}
              </Text>
            </HStack>
          );
        })}
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
