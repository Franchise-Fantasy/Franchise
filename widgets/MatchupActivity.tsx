/**
 * MatchupActivity Live Activity (Dynamic Island + Lock Screen).
 *
 * "Press Box" redesign: the hero row above the player ticker is
 * moment-first — a recent live_scoring_event (3-pointer, threshold cross,
 * steal/block) over a margin-trajectory line over a "next tipoff" fallback.
 * See utils/liveActivity/contentState.ts for the field contract.
 *
 * Sizing budget — every surface tops out at ~160pt tall (Apple's hard
 * Live Activity ceiling). Banner stack target: ~140pt. If something here
 * grows, trim the ticker first (2 rows → 1) before adding a section.
 *
 * Widget render constraints (still):
 * - babel-preset-expo's widgets-plugin stringifies the layout function,
 *   so anything referenced outside the function body (module-level
 *   constants, helper functions) does NOT exist when iOS evaluates the
 *   string in its JSContext. Everything must live INSIDE the layout body.
 * - The JSContext only has `@expo/ui/swift-ui` components + modifiers on
 *   globalThis. No React Native primitives, no third-party libs.
 *
 * @platform ios 16.1+
 */
import { Circle, Gauge, HStack, Image, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import { background, clipShape, cornerRadius, font, foregroundStyle, frame, gaugeStyle, lineLimit, opacity, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

import type {
  LiveCategoryLine,
  LiveMarginTrend,
  LiveMoment,
  LiveNextTipoff,
  LivePlayerLine,
} from '@/utils/liveActivity/contentState';

export type MatchupPlayerLine = LivePlayerLine;
export type MatchupCategoryLine = LiveCategoryLine;

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

  // Hero row — points mode only. Renderer picks the first non-null.
  moment?: LiveMoment;
  marginTrend?: LiveMarginTrend;
  nextTipoff?: LiveNextTipoff;

  // Optional fully-resolved file:// URIs into the App Group container.
  // Falls back to tricode pill when absent.
  myLogoFileUri?: string;
  opponentLogoFileUri?: string;
  patchFileUri?: string;
};

const MatchupActivityLayout = (props: MatchupActivityProps, _env: LiveActivityEnvironment) => {
  'widget';

  const WHITE = '#FFFFFF';
  const GREEN = '#22C55E';
  const RED = '#EF4444';
  const YELLOW = '#FACC15';
  const GREY = '#8E8E93';
  const ACCENT = '#F59E0B';
  // Heritage gold — softer olive variant matching the brand patch.
  const GOLD = '#9E8A60';
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

  const ties = props.catTies ?? 0;
  const catRecord = ties > 0
    ? `${Math.round(props.myScore)}-${Math.round(props.opponentScore)}-${ties}`
    : `${Math.round(props.myScore)}-${Math.round(props.opponentScore)}`;
  const gapText = isCats
    ? catRecord
    : `${myLeading ? '+' : ''}${gap.toFixed(1)}`;

  const probVisible = !isCats && typeof props.winProbability === 'number';
  const winPct = probVisible ? Math.round((props.winProbability ?? 0) * 100) : 50;
  const playersVisible = !isCats && props.players.length > 0;
  const tickerTop2 = props.players.slice(0, 2);
  const tickerTop3 = props.players.slice(0, 3);
  const catsVisible = isCats && (props.categories?.length ?? 0) > 0;
  const cats = props.categories ?? [];
  const topCats = cats.slice(0, 5);
  const topCatsExpanded = cats.slice(0, 4);
  const totalLive = props.myActivePlayers + props.opponentActivePlayers;

  const headerLabel = isCats ? 'CATEGORIES' : 'MATCHUP';
  const myLogo = props.myLogoFileUri;
  const oppLogo = props.opponentLogoFileUri;
  const patch = props.patchFileUri;

  // ── Hero row resolution — moment > marginTrend > nextTipoff > contributor.
  // Only one renders; everything else falls through.
  const moment = !isCats ? props.moment : undefined;
  const marginTrend = !isCats && !moment ? props.marginTrend : undefined;
  const nextTipoff = !isCats && !moment && !marginTrend ? props.nextTipoff : undefined;
  const contributorVisible =
    !moment && !marginTrend && !nextTipoff && props.biggestContributor.length > 0;

  const momentIconSymbol =
    moment?.icon === 'flame' ? 'flame.fill'
      : moment?.icon === 'check' ? 'checkmark.seal.fill'
        : 'bolt.fill';
  const momentColor = moment
    ? (moment.side === 'me' ? GREEN : RED)
    : WHITE;
  const momentAgeText = moment
    ? (moment.ageSec < 5 ? 'just now'
        : moment.ageSec < 60 ? `${moment.ageSec}s ago`
          : `${Math.floor(moment.ageSec / 60)}m ago`)
    : '';

  // marginTrend tint: helpful direction = current > earlier (in my-signed gap).
  const trendHelpful = marginTrend ? marginTrend.current > marginTrend.earlier : false;
  const trendColor = marginTrend ? (trendHelpful ? GREEN : YELLOW) : WHITE;
  const trendLabel = marginTrend
    ? (myLeading
        ? (trendHelpful ? 'GAP EXTENDING' : 'GAP SHRINKING')
        : (trendHelpful ? 'GAP CLOSING' : 'GAP WIDENING'))
    : '';
  const trendDelta = marginTrend
    ? `${marginTrend.earlier.toFixed(1)} → ${marginTrend.current.toFixed(1)}  ·  ${marginTrend.earlierMinAgo}m`
    : '';

  return {
    banner: (
      <VStack spacing={8} modifiers={[padding({ all: 14 })]}>
        {/* Header — patch + LIVE label + total-live count. ~22pt. */}
        <HStack spacing={8}>
          {patch ? (
            <ZStack>
              <Circle modifiers={[foregroundStyle(GOLD), opacity(0.6), frame({ width: 18, height: 18 })]} />
              <Image uiImage={patch} modifiers={[frame({ width: 16, height: 16 })]} />
            </ZStack>
          ) : (
            <Image systemName="basketball.fill" size={13} color={ACCENT} />
          )}
          <Text modifiers={[font({ size: 10, weight: 'semibold' }), foregroundStyle(GOLD), opacity(0.75)]}>
            {headerLabel}
          </Text>
          <HStack spacing={3} modifiers={[padding({ horizontal: 6, vertical: 2 }), background(RED, undefined as any), cornerRadius(6)]}>
            <Circle modifiers={[foregroundStyle(WHITE), frame({ width: 5, height: 5 })]} />
            <Text modifiers={[font({ size: 9, weight: 'bold' }), foregroundStyle(WHITE)]}>LIVE</Text>
          </HStack>
          <Spacer />
          {totalLive > 0 ? (
            <HStack spacing={4}>
              <Image systemName="dot.radiowaves.left.and.right" size={10} color={ACCENT} />
              <Text modifiers={[font({ size: 10, weight: 'medium' }), foregroundStyle(WHITE), opacity(0.55)]}>
                {`${totalLive} live`}
              </Text>
            </HStack>
          ) : null}
        </HStack>

        {/* Scoreboard — tricode + score per side, margin + gauge center. ~50pt. */}
        <HStack spacing={12}>
          <VStack alignment="leading" spacing={2}>
            {myLogo ? (
              <HStack spacing={6}>
                <ZStack>
                  <Circle modifiers={[foregroundStyle(GOLD), frame({ width: 24, height: 24 })]} />
                  <Image uiImage={myLogo} modifiers={[frame({ width: 22, height: 22 }), clipShape('circle')]} />
                </ZStack>
                <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
                  {props.myTeamTricode}
                </Text>
              </HStack>
            ) : (
              <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), padding({ horizontal: 7, vertical: 2 }), background(PANEL_DIM, undefined as any), cornerRadius(6)]}>
                {props.myTeamTricode}
              </Text>
            )}
            <Text modifiers={[font({ size: 24, weight: 'bold' }), foregroundStyle(myScoreColor), lineLimit(1)]}>
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
            {oppLogo ? (
              <HStack spacing={6}>
                <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
                  {props.opponentTeamTricode}
                </Text>
                <ZStack>
                  <Circle modifiers={[foregroundStyle(GOLD), frame({ width: 24, height: 24 })]} />
                  <Image uiImage={oppLogo} modifiers={[frame({ width: 22, height: 22 }), clipShape('circle')]} />
                </ZStack>
              </HStack>
            ) : (
              <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), padding({ horizontal: 7, vertical: 2 }), background(PANEL_DIM, undefined as any), cornerRadius(6)]}>
                {props.opponentTeamTricode}
              </Text>
            )}
            <Text modifiers={[font({ size: 24, weight: 'bold' }), foregroundStyle(oppScoreColor), lineLimit(1)]}>
              {oppScoreText}
            </Text>
          </VStack>
        </HStack>

        {/* Hero row — moment / marginTrend / nextTipoff / contributor fallback. ~22pt. */}
        {moment ? (
          <HStack spacing={6}>
            <Image systemName={momentIconSymbol} size={13} color={momentColor} />
            <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(momentColor), lineLimit(1)]}>
              {moment.text}
            </Text>
            <Spacer />
            <Text modifiers={[font({ size: 10 }), foregroundStyle(WHITE), opacity(0.45)]}>
              {momentAgeText}
            </Text>
          </HStack>
        ) : marginTrend ? (
          <HStack spacing={6}>
            <Image systemName={trendHelpful ? 'arrow.up.right' : 'arrow.down.right'} size={11} color={trendColor} />
            <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(trendColor), lineLimit(1)]}>
              {trendLabel}
            </Text>
            <Spacer />
            <Text modifiers={[font({ size: 10 }), foregroundStyle(WHITE), opacity(0.5)]}>
              {trendDelta}
            </Text>
          </HStack>
        ) : nextTipoff ? (
          <HStack spacing={6}>
            <Image systemName="clock.fill" size={11} color={GOLD} />
            <Text modifiers={[font({ size: 10, weight: 'semibold' }), foregroundStyle(GOLD), opacity(0.85)]}>
              NEXT UP
            </Text>
            <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundStyle(WHITE), lineLimit(1)]}>
              {`${nextTipoff.timeText}  ${nextTipoff.matchup}`}
            </Text>
            <Spacer />
            <Text modifiers={[font({ size: 10 }), foregroundStyle(WHITE), opacity(0.5)]}>
              {`y${nextTipoff.myStarters} · o${nextTipoff.oppStarters}`}
            </Text>
          </HStack>
        ) : contributorVisible ? (
          <HStack spacing={6}>
            <Image systemName="flame.fill" size={11} color={YELLOW} />
            <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundStyle(YELLOW), lineLimit(1)]}>
              {props.biggestContributor}
            </Text>
          </HStack>
        ) : null}

        {/* Player ticker — 2 rows max in banner. */}
        {playersVisible ? (
          <VStack spacing={3} modifiers={[padding({ all: 7 }), background(PANEL, undefined as any), cornerRadius(8)]}>
            {tickerTop2.map((player) => (
              <HStack key={player.name} spacing={6}>
                <Image
                  systemName={player.isOnCourt ? 'circle.fill' : 'circle'}
                  size={7}
                  color={player.isOnCourt ? GREEN : GREY}
                />
                <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundStyle(WHITE), lineLimit(1)]}>
                  {player.name.indexOf(' ') > 0
                    ? `${player.name[0]}. ${player.name.slice(player.name.indexOf(' ') + 1)}`
                    : player.name}
                </Text>
                <Spacer />
                <Text modifiers={[font({ size: 10 }), foregroundStyle(WHITE), opacity(0.5), lineLimit(1)]}>
                  {player.statLine}
                </Text>
                <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), frame({ width: 36, alignment: 'trailing' })]}>
                  {player.fantasyPoints.toFixed(1)}
                </Text>
              </HStack>
            ))}
          </VStack>
        ) : null}

        {/* Category ticker (cats mode) — max 5 rows. */}
        {catsVisible ? (
          <VStack spacing={3} modifiers={[padding({ all: 7 }), background(PANEL, undefined as any), cornerRadius(8)]}>
            {topCats.map((cat) => {
              const isPct = cat.stat.endsWith('%');
              const myVal = isPct ? cat.myValue.toFixed(3).replace(/^0/, '') : String(Math.round(cat.myValue));
              const oppVal = isPct ? cat.oppValue.toFixed(3).replace(/^0/, '') : String(Math.round(cat.oppValue));
              const winColor = cat.winner === 'me' ? GREEN : cat.winner === 'opp' ? RED : GREY;
              const winSymbol = cat.winner === 'me' ? 'arrowtriangle.up.fill' : cat.winner === 'opp' ? 'arrowtriangle.down.fill' : 'equal';
              return (
                <HStack key={cat.stat} spacing={6}>
                  <Image systemName={winSymbol} size={7} color={winColor} />
                  <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), frame({ width: 36, alignment: 'leading' })]}>
                    {cat.stat}
                  </Text>
                  {cat.inverse ? (
                    <Text modifiers={[font({ size: 8 }), foregroundStyle(GREY)]}>↓</Text>
                  ) : null}
                  <Spacer />
                  <Text modifiers={[font({ size: 11, weight: cat.winner === 'me' ? 'bold' : 'regular' }), foregroundStyle(cat.winner === 'me' ? GREEN : WHITE), frame({ width: 48, alignment: 'trailing' })]}>
                    {myVal}
                  </Text>
                  <Text modifiers={[font({ size: 10 }), foregroundStyle(GREY), opacity(0.5)]}>vs</Text>
                  <Text modifiers={[font({ size: 11, weight: cat.winner === 'opp' ? 'bold' : 'regular' }), foregroundStyle(cat.winner === 'opp' ? GREEN : WHITE), frame({ width: 48, alignment: 'leading' })]}>
                    {oppVal}
                  </Text>
                </HStack>
              );
            })}
          </VStack>
        ) : null}
      </VStack>
    ),

    // ── Dynamic Island Compact — ~50pt per side, 5 chars budget.
    compactLeading: (
      <HStack spacing={4}>
        {myLeading && !tiedOverall ? (
          <Image systemName="arrowtriangle.up.fill" size={9} color={GREEN} />
        ) : null}
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.65)]}>
          {props.myTeamTricode}
        </Text>
      </HStack>
    ),
    compactTrailing: (
      <HStack spacing={3}>
        <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(gapColor)]}>
          {gapText}
        </Text>
        {!myLeading && !tiedOverall ? (
          <Image systemName="arrowtriangle.up.fill" size={9} color={GREEN} />
        ) : null}
      </HStack>
    ),

    // Minimal: one colored arrow. 28pt square.
    minimal: (
      <Image
        systemName={tiedOverall ? 'equal' : myLeading ? 'arrowtriangle.up.fill' : 'arrowtriangle.down.fill'}
        size={11}
        color={gapColor}
      />
    ),

    // ── Dynamic Island Expanded — same hero/ticker pattern, narrower because
    // of the camera cutout. Center column holds the verb + margin + gauge,
    // leading/trailing hold logo + tricode + score + count, bottom holds the
    // hero row (moment / trend / tipoff) + a 3-row ticker.
    expandedLeading: (
      <VStack alignment="leading" spacing={3} modifiers={[padding({ leading: 4 })]}>
        {myLogo ? (
          <HStack spacing={5}>
            <ZStack>
              <Circle modifiers={[foregroundStyle(GOLD), frame({ width: 22, height: 22 })]} />
              <Image uiImage={myLogo} modifiers={[frame({ width: 20, height: 20 }), clipShape('circle')]} />
            </ZStack>
            <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
              {props.myTeamTricode}
            </Text>
          </HStack>
        ) : (
          <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), padding({ horizontal: 7, vertical: 2 }), background(PANEL_DIM, undefined as any), cornerRadius(6)]}>
            {props.myTeamTricode}
          </Text>
        )}
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
        {oppLogo ? (
          <HStack spacing={5}>
            <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
              {props.opponentTeamTricode}
            </Text>
            <ZStack>
              <Circle modifiers={[foregroundStyle(GOLD), frame({ width: 22, height: 22 })]} />
              <Image uiImage={oppLogo} modifiers={[frame({ width: 20, height: 20 }), clipShape('circle')]} />
            </ZStack>
          </HStack>
        ) : (
          <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), padding({ horizontal: 7, vertical: 2 }), background(PANEL_DIM, undefined as any), cornerRadius(6)]}>
            {props.opponentTeamTricode}
          </Text>
        )}
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
      </VStack>
    ),
    expandedBottom: (
      <VStack spacing={5} modifiers={[padding({ horizontal: 4, top: 4 })]}>
        {/* Hero row — same priority chain as banner. */}
        {moment ? (
          <HStack spacing={6}>
            <Image systemName={momentIconSymbol} size={12} color={momentColor} />
            <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(momentColor), lineLimit(1)]}>
              {moment.text}
            </Text>
            <Spacer />
            <Text modifiers={[font({ size: 9 }), foregroundStyle(WHITE), opacity(0.45)]}>
              {momentAgeText}
            </Text>
          </HStack>
        ) : marginTrend ? (
          <HStack spacing={6}>
            <Image systemName={trendHelpful ? 'arrow.up.right' : 'arrow.down.right'} size={11} color={trendColor} />
            <Text modifiers={[font({ size: 10, weight: 'semibold' }), foregroundStyle(trendColor), lineLimit(1)]}>
              {trendLabel}
            </Text>
            <Spacer />
            <Text modifiers={[font({ size: 9 }), foregroundStyle(WHITE), opacity(0.5)]}>
              {trendDelta}
            </Text>
          </HStack>
        ) : nextTipoff ? (
          <HStack spacing={6}>
            <Image systemName="clock.fill" size={11} color={GOLD} />
            <Text modifiers={[font({ size: 9, weight: 'semibold' }), foregroundStyle(GOLD)]}>NEXT UP</Text>
            <Text modifiers={[font({ size: 10, weight: 'medium' }), foregroundStyle(WHITE), lineLimit(1)]}>
              {`${nextTipoff.timeText}  ${nextTipoff.matchup}`}
            </Text>
            <Spacer />
            <Text modifiers={[font({ size: 9 }), foregroundStyle(WHITE), opacity(0.5)]}>
              {`y${nextTipoff.myStarters} · o${nextTipoff.oppStarters}`}
            </Text>
          </HStack>
        ) : contributorVisible ? (
          <HStack spacing={5}>
            <Image systemName="flame.fill" size={10} color={YELLOW} />
            <Text modifiers={[font({ size: 10, weight: 'medium' }), foregroundStyle(YELLOW), lineLimit(1)]}>
              {props.biggestContributor}
            </Text>
          </HStack>
        ) : null}

        {/* Ticker — 3 rows in expanded. */}
        {playersVisible ? (
          tickerTop3.map((player) => (
            <HStack key={player.name} spacing={6}>
              <Image
                systemName={player.isOnCourt ? 'circle.fill' : 'circle'}
                size={7}
                color={player.isOnCourt ? GREEN : GREY}
              />
              <Text modifiers={[font({ size: 11, weight: 'medium' }), foregroundStyle(WHITE), lineLimit(1)]}>
                {player.name.indexOf(' ') > 0
                  ? `${player.name[0]}. ${player.name.slice(player.name.indexOf(' ') + 1)}`
                  : player.name}
              </Text>
              <Spacer />
              <Text modifiers={[font({ size: 10 }), foregroundStyle(WHITE), opacity(0.55), lineLimit(1)]}>
                {player.statLine}
              </Text>
              <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), frame({ width: 36, alignment: 'trailing' })]}>
                {player.fantasyPoints.toFixed(1)}
              </Text>
            </HStack>
          ))
        ) : catsVisible ? (
          topCatsExpanded.map((cat) => {
            const isPct = cat.stat.endsWith('%');
            const myVal = isPct ? cat.myValue.toFixed(3).replace(/^0/, '') : String(Math.round(cat.myValue));
            const oppVal = isPct ? cat.oppValue.toFixed(3).replace(/^0/, '') : String(Math.round(cat.oppValue));
            const winColor = cat.winner === 'me' ? GREEN : cat.winner === 'opp' ? RED : GREY;
            const winSymbol = cat.winner === 'me' ? 'arrowtriangle.up.fill' : cat.winner === 'opp' ? 'arrowtriangle.down.fill' : 'equal';
            return (
              <HStack key={cat.stat} spacing={6}>
                <Image systemName={winSymbol} size={7} color={winColor} />
                <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), frame({ width: 36, alignment: 'leading' })]}>
                  {cat.stat}
                </Text>
                <Spacer />
                <Text modifiers={[font({ size: 11, weight: cat.winner === 'me' ? 'bold' : 'regular' }), foregroundStyle(cat.winner === 'me' ? GREEN : WHITE), frame({ width: 46, alignment: 'trailing' })]}>
                  {myVal}
                </Text>
                <Text modifiers={[font({ size: 9 }), foregroundStyle(GREY), opacity(0.5)]}>vs</Text>
                <Text modifiers={[font({ size: 11, weight: cat.winner === 'opp' ? 'bold' : 'regular' }), foregroundStyle(cat.winner === 'opp' ? GREEN : WHITE), frame({ width: 46, alignment: 'leading' })]}>
                  {oppVal}
                </Text>
              </HStack>
            );
          })
        ) : null}
      </VStack>
    ),
  };
};

export const MatchupActivity = createLiveActivity<MatchupActivityProps>('MatchupActivity', MatchupActivityLayout);
