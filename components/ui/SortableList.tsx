import { Ionicons } from '@expo/vector-icons';
import { type ReactNode, useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

/**
 * Drag-to-reorder list — the project's standard sortable primitive.
 *
 * Unlike `react-native-draggable-flatlist` (a virtualized FlatList that can't
 * nest inside a ScrollView and blows the active row out of its bounds via
 * ScaleDecorator), this renders a fixed set of absolutely-positioned rows on
 * top of Reanimated shared values. That makes it:
 *   - **Nestable** — drops straight into a wizard ScrollView (the reason the
 *     import draft-order editor no longer needs a bottom-sheet detour).
 *   - **Contained** — the active row lifts with a shadow + z-index instead of
 *     scaling past the card edge.
 *
 * Because it's non-virtualized it's meant for SHORT lists (roughly ≤ ~40 rows —
 * draft order, ranked choice). For long/unbounded lists (a full prospect board)
 * stay on DraggableFlatList. Rows are assumed uniform height (`itemHeight`);
 * dragging happens from the reorder handle only, so the parent scroll still
 * pans normally everywhere else. A screen-reader move-up/move-down action pair
 * is exposed on every row as the accessible fallback for the drag gesture.
 *
 * Rows are positioned with `transform: translateY` (not the `top` layout prop):
 * under Reanimated + Fabric, animating `top` on an absolutely-positioned view
 * whose `zIndex` also changes flickers the view back to the container origin
 * for a frame on gesture activation — the row appeared to "jump to the top" on
 * press. Transforms don't hit that layout path.
 *
 * Pass `renderSlotLabel` to draw a fixed rank gutter (1, 2, 3 …) down the left
 * edge: the labels stay pinned to their slot while the cards slide past them,
 * instead of a per-row number riding along inside the moving card.
 */

const SPRING = { damping: 22, stiffness: 210, mass: 0.6 } as const;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

// Swap whichever ids currently sit at `from` and `to`. Called once per slot
// boundary crossed while dragging — cumulative single-slot swaps add up to the
// correct insertion, matching how DraggableFlatList shifts rows live.
function swapPositions(positions: Record<string, number>, from: number, to: number) {
  'worklet';
  const next = { ...positions };
  for (const id in positions) {
    if (positions[id] === from) next[id] = to;
    else if (positions[id] === to) next[id] = from;
  }
  return next;
}

interface SortableListProps<T> {
  data: T[];
  keyExtractor: (item: T) => string;
  /** Fires with the full reordered array once a drag (or a11y move) settles. */
  onReorder: (next: T[]) => void;
  /** Inner row content — the primitive owns the card chrome + drag handle. */
  renderItem: (info: { item: T; index: number }) => ReactNode;
  /** Uniform row height in px. Rows are laid out at `index * (itemHeight + gap)`. */
  itemHeight: number;
  /** Vertical space between rows. Defaults to `s(8)`. */
  gap?: number;
  /** Which edge the reorder handle sits on. Defaults to `'right'`. */
  handleSide?: 'left' | 'right';
  /**
   * Long-press (ms) required on the handle before the drag activates. The
   * default 180ms disambiguates from a parent ScrollView's vertical pan (a
   * quick swipe scrolls, a held handle drags) and matches the app's other
   * drag surfaces. Pass `0` for immediate drag when there's no competing
   * scroll (e.g. a full-screen list).
   */
  activateAfterLongPressMs?: number;
  /** Per-row accessibility label (e.g. `"Portland, pick 3"`). */
  accessibilityItemLabel?: (item: T, index: number) => string;
  /**
   * Draws a fixed rank gutter down the left edge — one static label per slot,
   * vertically centred on the row, that does NOT move when a card is dragged.
   * Use for ordered lists where the position number belongs to the *slot*, not
   * the card (draft order, ranked choice). Omit for an unnumbered list.
   */
  renderSlotLabel?: (index: number) => ReactNode;
  /** Width of the rank gutter. Defaults to `s(28)`. Ignored without `renderSlotLabel`. */
  slotLabelWidth?: number;
}

export function SortableList<T>({
  data,
  keyExtractor,
  onReorder,
  renderItem,
  itemHeight,
  gap = s(8),
  handleSide = 'right',
  activateAfterLongPressMs = 180,
  accessibilityItemLabel,
  renderSlotLabel,
  slotLabelWidth = s(28),
}: SortableListProps<T>) {
  const fullHeight = itemHeight + gap;
  const count = data.length;
  const leftOffset = renderSlotLabel ? slotLabelWidth : 0;

  // id → slot index. Lives on the UI thread so the drag can shuffle it at 60fps.
  const positions = useSharedValue<Record<string, number>>(
    Object.fromEntries(data.map((item, i) => [keyExtractor(item), i])),
  );
  const activeId = useSharedValue<string | null>(null);
  const activeTop = useSharedValue(0);

  // Re-seed positions when the id set or its order changes externally (round
  // switch, parent commit). Reanimated reactions spring each row to its new slot.
  const idsKey = data.map(keyExtractor).join('|');
  useEffect(() => {
    positions.value = Object.fromEntries(data.map((item, i) => [keyExtractor(item), i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  const commit = useCallback(
    (posMap: Record<string, number>) => {
      const ordered = [...data].sort((a, b) => posMap[keyExtractor(a)] - posMap[keyExtractor(b)]);
      const changed = ordered.some((it, i) => keyExtractor(it) !== keyExtractor(data[i]));
      if (changed) onReorder(ordered);
    },
    [data, keyExtractor, onReorder],
  );

  const onCommit = useCallback(() => {
    commit({ ...positions.value });
  }, [commit, positions]);

  // Screen-reader fallback — swap a row with its neighbour.
  const onMove = useCallback(
    (id: string, dir: -1 | 1) => {
      const idx = data.findIndex((it) => keyExtractor(it) === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= data.length) return;
      const next = [...data];
      [next[idx], next[target]] = [next[target], next[idx]];
      onReorder(next);
    },
    [data, keyExtractor, onReorder],
  );

  return (
    <View style={{ height: Math.max(0, count * fullHeight - gap) }}>
      {/* Fixed rank gutter — one static label per slot, pinned while cards slide. */}
      {renderSlotLabel &&
        data.map((_, index) => (
          <View
            key={`slot-${index}`}
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.slotLabel,
              { top: index * fullHeight, height: itemHeight, width: slotLabelWidth },
            ]}
          >
            {renderSlotLabel(index)}
          </View>
        ))}
      {data.map((item, index) => {
        const id = keyExtractor(item);
        return (
          <SortableRow
            key={id}
            id={id}
            positions={positions}
            activeId={activeId}
            activeTop={activeTop}
            count={count}
            fullHeight={fullHeight}
            itemHeight={itemHeight}
            leftOffset={leftOffset}
            handleSide={handleSide}
            longPressMs={activateAfterLongPressMs}
            a11yLabel={accessibilityItemLabel?.(item, index)}
            onCommit={onCommit}
            onMove={onMove}
          >
            {renderItem({ item, index })}
          </SortableRow>
        );
      })}
    </View>
  );
}

interface SortableRowProps {
  id: string;
  children: ReactNode;
  positions: SharedValue<Record<string, number>>;
  activeId: SharedValue<string | null>;
  activeTop: SharedValue<number>;
  count: number;
  fullHeight: number;
  itemHeight: number;
  leftOffset: number;
  handleSide: 'left' | 'right';
  longPressMs: number;
  a11yLabel?: string;
  onCommit: () => void;
  onMove: (id: string, dir: -1 | 1) => void;
}

function SortableRow({
  id,
  children,
  positions,
  activeId,
  activeTop,
  count,
  fullHeight,
  itemHeight,
  leftOffset,
  handleSide,
  longPressMs,
  a11yLabel,
  onCommit,
  onMove,
}: SortableRowProps) {
  const c = useColors();
  const top = useSharedValue((positions.value[id] ?? 0) * fullHeight);
  const startTop = useSharedValue(0);

  // Follow the shared position to this row's resting slot whenever it changes
  // and the row isn't the one being dragged.
  useAnimatedReaction(
    () => positions.value[id],
    (pos, prev) => {
      if (pos == null || pos === prev) return;
      if (activeId.value !== id) top.value = withSpring(pos * fullHeight, SPRING);
    },
  );

  let pan = Gesture.Pan();
  if (longPressMs > 0) pan = pan.activateAfterLongPress(longPressMs);
  pan = pan
    .onStart(() => {
      startTop.value = (positions.value[id] ?? 0) * fullHeight;
      activeTop.value = startTop.value;
      activeId.value = id;
    })
    .onUpdate((e) => {
      activeTop.value = startTop.value + e.translationY;
      const newPos = clamp(Math.round(activeTop.value / fullHeight), 0, count - 1);
      let cur = positions.value[id] ?? 0;
      if (newPos !== cur) {
        // Walk one slot at a time toward the target so a fast fling that skips
        // slots between frames still resolves to a clean insertion, not a
        // long-distance swap that strands the in-between rows.
        const step = newPos > cur ? 1 : -1;
        let next = positions.value;
        while (cur !== newPos) {
          next = swapPositions(next, cur, cur + step);
          cur += step;
        }
        positions.value = next;
      }
    })
    .onEnd(() => {
      // Hand off from the finger position to the settled slot: `top` was frozen
      // at the pre-drag slot during the drag (the reaction skips the active
      // row), so seed it with the live drag position before springing — else it
      // snaps back to the old slot for a frame when `activeId` clears.
      top.value = activeTop.value;
      top.value = withSpring((positions.value[id] ?? 0) * fullHeight, SPRING);
    })
    .onFinalize(() => {
      if (activeId.value === id) {
        activeId.value = null;
        runOnJS(onCommit)();
      }
    });

  const rowStyle = useAnimatedStyle(() => {
    const active = activeId.value === id;
    return {
      transform: [{ translateY: active ? activeTop.value : top.value }],
      zIndex: active ? 10 : 0,
      elevation: active ? 6 : 0,
      shadowOpacity: withTiming(active ? 0.2 : 0, { duration: 140 }),
    };
  });

  const handle = (
    <GestureDetector gesture={pan}>
      <View
        style={styles.handle}
        hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
        accessible={false}
      >
        <Ionicons name="reorder-three" size={ms(24)} color={c.secondaryText} />
      </View>
    </GestureDetector>
  );

  return (
    <Animated.View
      style={[
        styles.rowShadow,
        { position: 'absolute', left: leftOffset, right: 0, top: 0, height: itemHeight },
        rowStyle,
      ]}
      accessible
      accessibilityLabel={a11yLabel}
      accessibilityHint="Use the move up and move down actions to reorder"
      accessibilityActions={[
        { name: 'moveUp', label: 'Move up' },
        { name: 'moveDown', label: 'Move down' },
      ]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'moveUp') onMove(id, -1);
        else if (e.nativeEvent.actionName === 'moveDown') onMove(id, 1);
      }}
    >
      <View style={[styles.card, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
        {handleSide === 'left' && handle}
        <View style={styles.content}>{children}</View>
        {handleSide === 'right' && handle}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Shadow lives on the outer animated view so it renders outside the card's
  // clipped/rounded body when a row lifts.
  rowShadow: {
    shadowColor: '#000',
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  card: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(12),
    borderRadius: 10,
    borderWidth: 1,
    gap: s(10),
  },
  content: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  handle: {
    paddingVertical: s(4),
    paddingHorizontal: s(2),
  },
  // Fixed rank gutter cell — pinned to its slot, centred on the row height.
  slotLabel: {
    position: 'absolute',
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
