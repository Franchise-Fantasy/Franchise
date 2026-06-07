/**
 * MatchupActivity Live Activity (Dynamic Island + Lock Screen).
 *
 * MINIMAL SAFE VERSION — earlier rich version was failing to render in the
 * JSContext on production builds (stuck loading spinner). Going back to
 * primitives only (HStack/VStack/Text/Spacer) until we confirm what was
 * throwing. Logos, patch, gold ring, Gauge, ZStack, Circle, Image — all
 * removed for now. Will re-add one feature at a time once this baseline
 * renders correctly.
 *
 * The `'widget'` directive triggers babel-preset-expo's widgets-plugin,
 * which extracts the function source as a string. iOS evaluates that string
 * in a JSContext that only has `@expo/ui/swift-ui` components + modifiers on
 * `globalThis` — anything referenced outside the function body does NOT
 * exist at render time. Every value used by the layout must therefore live
 * INSIDE the function (or inside its inlined JSX).
 *
 * @platform ios 16.1+
 */
import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, opacity, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

import type { LiveCategoryLine, LivePlayerLine } from '@/utils/liveActivity/contentState';

// Re-exported under the widget-flavored names that the rest of the client uses.
// Single source of truth lives in utils/liveActivity/contentState.ts.
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

  // Kept on the type so server payloads don't fail typechecks, but the
  // minimal layout below doesn't reference any of these.
  players: MatchupPlayerLine[];
  categories?: MatchupCategoryLine[];
  catTies?: number;
  myLogoFileUri?: string;
  opponentLogoFileUri?: string;
  patchFileUri?: string;
};

const MatchupActivityLayout = (props: MatchupActivityProps, _env: LiveActivityEnvironment) => {
  'widget';

  const WHITE = '#FFFFFF';
  const GREEN = '#22C55E';
  const RED = '#EF4444';
  const GREY = '#8E8E93';

  const isCats = props.mode === 'categories';

  const gap = props.scoreGap;
  const myLeading = gap > 0;
  const tiedOverall = gap === 0;
  const gapColor = tiedOverall ? WHITE : myLeading ? GREEN : RED;
  const myScoreText = isCats ? String(Math.round(props.myScore)) : props.myScore.toFixed(1);
  const oppScoreText = isCats ? String(Math.round(props.opponentScore)) : props.opponentScore.toFixed(1);
  const myScoreColor = tiedOverall ? WHITE : myLeading ? GREEN : WHITE;
  const oppScoreColor = tiedOverall ? WHITE : !myLeading ? GREEN : WHITE;
  const gapText = isCats
    ? `${Math.round(props.myScore)} - ${Math.round(props.opponentScore)}`
    : `${myLeading ? '+' : ''}${gap.toFixed(1)}`;

  return {
    banner: (
      <VStack spacing={6} modifiers={[padding({ all: 12 })]}>
        <HStack spacing={12}>
          <VStack alignment="leading" spacing={2}>
            <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
              {props.myTeamTricode}
            </Text>
            <Text modifiers={[font({ size: 24, weight: 'bold' }), foregroundStyle(myScoreColor)]}>
              {myScoreText}
            </Text>
          </VStack>
          <Spacer />
          <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundStyle(gapColor)]}>
            {gapText}
          </Text>
          <Spacer />
          <VStack alignment="trailing" spacing={2}>
            <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
              {props.opponentTeamTricode}
            </Text>
            <Text modifiers={[font({ size: 24, weight: 'bold' }), foregroundStyle(oppScoreColor)]}>
              {oppScoreText}
            </Text>
          </VStack>
        </HStack>
        <Text modifiers={[font({ size: 10 }), foregroundStyle(WHITE), opacity(0.55)]}>
          {`${props.myActivePlayers} vs ${props.opponentActivePlayers} live`}
        </Text>
      </VStack>
    ),

    compactLeading: (
      <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(myScoreColor)]}>
        {`${props.myTeamTricode} ${myScoreText}`}
      </Text>
    ),
    compactTrailing: (
      <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle(oppScoreColor)]}>
        {`${oppScoreText} ${props.opponentTeamTricode}`}
      </Text>
    ),

    minimal: (
      <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(gapColor)]}>
        {tiedOverall ? '=' : myLeading ? '+' : '-'}
      </Text>
    ),

    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 4 })]}>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
          {props.myTeamTricode}
        </Text>
        <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle(myScoreColor)]}>
          {myScoreText}
        </Text>
        <Text modifiers={[font({ size: 9 }), foregroundStyle(WHITE), opacity(0.5)]}>
          {`${props.myActivePlayers} live`}
        </Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={2} modifiers={[padding({ trailing: 4 })]}>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(WHITE), opacity(0.7)]}>
          {props.opponentTeamTricode}
        </Text>
        <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle(oppScoreColor)]}>
          {oppScoreText}
        </Text>
        <Text modifiers={[font({ size: 9 }), foregroundStyle(WHITE), opacity(0.5)]}>
          {`${props.opponentActivePlayers} live`}
        </Text>
      </VStack>
    ),
    expandedCenter: (
      <VStack spacing={2}>
        <Text modifiers={[font({ size: 14, weight: 'bold' }), foregroundStyle(gapColor)]}>
          {gapText}
        </Text>
        {props.biggestContributor.length > 0 ? (
          <Text modifiers={[font({ size: 10 }), foregroundStyle(WHITE), opacity(0.7)]}>
            {props.biggestContributor}
          </Text>
        ) : null}
      </VStack>
    ),
    expandedBottom: (
      <Text modifiers={[font({ size: 10 }), foregroundStyle(GREY)]}>
        {tiedOverall ? 'Tied' : myLeading ? 'You lead' : 'You trail'}
      </Text>
    ),
  };
};

export const MatchupActivity = createLiveActivity<MatchupActivityProps>('MatchupActivity', MatchupActivityLayout);
