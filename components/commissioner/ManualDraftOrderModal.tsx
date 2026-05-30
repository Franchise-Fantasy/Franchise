import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, StyleSheet, TouchableOpacity, View } from 'react-native';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { TeamLogo } from '@/components/team/TeamLogo';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { manuallyAssignDraftSlots } from '@/lib/draft';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

interface Team {
  id: string;
  name: string;
  tricode: string | null;
  logo_key: string | null;
}

interface ManualDraftOrderModalProps {
  visible: boolean;
  onClose: () => void;
  leagueId: string;
  draftId: string;
}

// Fixed visual dimensions so the static pick-number column aligns with
// each draggable card. Changing card chrome means matching these.
const CARD_HEIGHT = s(62);
const CARD_GAP = s(8);

export function ManualDraftOrderModal({
  visible,
  onClose,
  leagueId,
  draftId,
}: ManualDraftOrderModalProps) {
  const c = useColors();
  const queryClient = useQueryClient();

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Tracks the DraggableFlatList's scroll offset so the static numbers
  // column on the left can translate up/down in lockstep — keeps "1, 2,
  // 3…" labels visually paired with the cards no matter how far you
  // scroll within the sheet.
  const scrollY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    void loadTeams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, leagueId, draftId]);

  async function loadTeams() {
    setLoading(true);

    // Existing slot assignments take priority — if the commissioner is
    // editing after saving, preserve their order on re-open.
    const { data: picks } = await supabase
      .from('draft_picks')
      .select('slot_number, current_team_id, teams!draft_picks_current_team_id_fkey(id, name, tricode, logo_key)')
      .eq('draft_id', draftId)
      .eq('round', 1)
      .not('current_team_id', 'is', null)
      .order('slot_number', { ascending: true });

    if (picks && picks.length > 0) {
      const ordered = picks
        .filter((p: any) => p.teams)
        .map((p: any) => ({ id: p.teams.id, name: p.teams.name, tricode: p.teams.tricode, logo_key: p.teams.logo_key }));

      const seen = new Set<string>();
      const unique = ordered.filter((t: Team) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });

      if (unique.length > 0) {
        setTeams(unique);
        setLoading(false);
        return;
      }
    }

    // Fallback: load all league teams alphabetically when no slots have
    // been assigned yet (first-time setup).
    const { data: allTeams } = await supabase
      .from('teams')
      .select('id, name, tricode, logo_key')
      .eq('league_id', leagueId)
      .order('name', { ascending: true });

    setTeams(allTeams ?? []);
    setLoading(false);
  }

  async function handleSave() {
    if (teams.length === 0) return;
    setSaving(true);
    try {
      await manuallyAssignDraftSlots(leagueId, draftId, teams.map((t) => t.id));
      queryClient.invalidateQueries({ queryKey: ['activeDraft', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['leagueDraft', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['draftSlotsAssigned', draftId] });
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Failed to save draft order');
    } finally {
      setSaving(false);
    }
  }

  // Card-only renderer — the static numbers column sits OUTSIDE the
  // DraggableFlatList so it doesn't drag/scale along with the row.
  // Drag is initiated ONLY from the right-edge handle so it doesn't
  // compete with scroll-momentum gestures on the card body.
  const renderItem = useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<Team>) => {
      const index = getIndex() ?? 0;
      return (
        <ScaleDecorator>
          <View
            accessibilityLabel={`${item.name}, pick ${index + 1}`}
            style={[
              styles.teamCard,
              {
                backgroundColor: isActive ? c.activeCard : c.cardAlt,
                borderColor: isActive ? c.activeBorder : c.border,
                height: CARD_HEIGHT,
              },
            ]}
          >
            <TeamLogo
              logoKey={item.logo_key}
              teamName={item.name}
              tricode={item.tricode ?? undefined}
              size="medium"
            />

            <View style={styles.teamInfo}>
              <ThemedText style={styles.teamName} numberOfLines={1}>
                {item.name}
              </ThemedText>
              {item.tricode ? (
                <ThemedText
                  type="varsitySmall"
                  style={[styles.tricode, { color: c.secondaryText }]}
                >
                  {item.tricode}
                </ThemedText>
              ) : null}
            </View>

            <TouchableOpacity
              onLongPress={drag}
              delayLongPress={180}
              disabled={isActive}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={`Reorder ${item.name}. Long press and drag.`}
              accessibilityHint="Long press and drag to change draft position"
              style={styles.dragHandle}
            >
              <Ionicons name="reorder-three" size={26} color={c.secondaryText} />
            </TouchableOpacity>
          </View>
        </ScaleDecorator>
      );
    },
    [c],
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Draft Order"
      subtitle="Long press to drag — top team picks first"
      height="85%"
      scrollableBody={false}
      footer={
        <BrandButton
          label="Save Order"
          variant="primary"
          size="large"
          onPress={handleSave}
          loading={saving}
          disabled={loading || teams.length === 0}
          fullWidth
          accessibilityLabel="Save draft order"
        />
      }
    >
      {loading ? (
        <View style={styles.loadingContainer}>
          <LogoSpinner />
        </View>
      ) : (
        <View style={styles.boardRow}>
          {/* Pick-order column — labels (1, 2, 3, …) sit OUTSIDE the
              DraggableFlatList so they don't drag/scale with individual
              rows. The Animated.View's translateY mirrors the list's
              scroll offset so the numbers track the cards in lockstep
              when the list scrolls. */}
          <Animated.View
            style={[
              styles.numbersCol,
              {
                transform: [
                  {
                    translateY: scrollY.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, -1],
                    }),
                  },
                ],
              },
            ]}
            pointerEvents="none"
          >
            {teams.map((_, i) => (
              <View key={i} style={styles.numberSlot}>
                <ThemedText style={[styles.orderNum, { color: c.secondaryText }]}>
                  {i + 1}
                </ThemedText>
              </View>
            ))}
          </Animated.View>

          <GestureHandlerRootView style={styles.listContainer}>
            <DraggableFlatList
              data={teams}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              onDragEnd={({ data }) => setTeams(data)}
              contentContainerStyle={styles.listContent}
              // DraggableFlatList uses Reanimated internally, so the
              // legacy `Animated.event` onScroll passthrough doesn't
              // fire. Its `onScrollOffsetChange` callback is the
              // documented way to track scroll position from outside.
              onScrollOffsetChange={(offset) => scrollY.setValue(offset)}
            />
          </GestureHandlerRootView>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    paddingVertical: s(40),
    alignItems: 'center',
  },
  // overflow:hidden clips the numbers column at the body's bottom edge
  // as it translates upward during scroll — without it, numbers bleed
  // into the footer area.
  boardRow: {
    flex: 1,
    flexDirection: 'row',
    gap: s(8),
    overflow: 'hidden',
  },
  // Static numbers column. Each slot has the same height + bottom margin
  // as a card so the numbers line up with the cards beside them.
  // Matches `listContent.paddingTop: 0` (no padding) so first number
  // aligns with first card.
  numbersCol: {
    width: s(20),
    flexDirection: 'column',
  },
  numberSlot: {
    height: CARD_HEIGHT,
    marginBottom: CARD_GAP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderNum: {
    fontFamily: Fonts.mono,
    fontSize: ms(15),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  // DraggableFlatList region — flexes to fill the rest of the body width.
  listContainer: {
    flex: 1,
  },
  // Tiny horizontal inset so ScaleDecorator's grow-during-drag has room
  // before the BottomSheet's overflow:hidden clips the card edges.
  listContent: {
    paddingRight: s(4),
    paddingBottom: s(8),
    gap: CARD_GAP,
  },
  teamCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(12),
    paddingHorizontal: s(12),
    borderRadius: 10,
    borderWidth: 1,
    gap: s(12),
  },
  teamInfo: {
    flex: 1,
    minWidth: 0,
  },
  // Drag handle hit target. Sized comfortably for a thumb pad — small
  // enough not to fight scroll on the card body, generous enough to
  // grab while the list is decelerating.
  dragHandle: {
    paddingVertical: s(4),
    paddingLeft: s(8),
  },
  teamName: {
    fontSize: ms(15),
    fontWeight: '600',
  },
  tricode: {
    fontSize: ms(10),
    letterSpacing: 1.0,
    marginTop: s(2),
  },
});
