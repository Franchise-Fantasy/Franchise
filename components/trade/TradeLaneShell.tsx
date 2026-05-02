import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

type StatusGlyph = 'accepted' | 'rejected' | 'pending';

interface TradeLaneShellProps {
  teamName: string;
  /** "Sends" (compose) or "Receives" (display) — drives the eyebrow text. */
  frame: 'sends' | 'receives';
  /** Optional team-status glyph on the eyebrow row (turf check / merlot X / gold pending). */
  statusGlyph?: StatusGlyph | null;
  /** Optional small ✕ for "drop this team" — only shown in compose for non-`isMe` lanes. */
  onRemoveTeam?: () => void;
  /**
   * Drop the outer card surface — used when stacking multiple lane blocks
   * inside a single parent card. The parent provides the surface; this
   * component only renders the header + children.
   */
  surfaceless?: boolean;
  /** Accessible summary label for the wrapping View. */
  accessibilityLabel?: string;
  children: ReactNode;
}

/**
 * Shared lane chrome — team name on top, gold-rule eyebrow ("SENDS" or
 * "RECEIVES") underneath, optional status glyph or remove-team ✕ on the
 * eyebrow row, then children (asset rows, picker reveal, etc).
 *
 * Used by `TradeSideSummary` (receives display) and the upcoming
 * `TradeLane` (compose) so every trade surface in the app shares the
 * same chrome — the only thing that varies is the eyebrow word and what
 * the lane contains.
 */
export function TradeLaneShell({
  teamName,
  frame,
  statusGlyph,
  onRemoveTeam,
  surfaceless,
  accessibilityLabel,
  children,
}: TradeLaneShellProps) {
  const c = useColors();

  const statusConfig =
    statusGlyph === 'accepted'
      ? { name: 'checkmark-circle' as const, color: c.success }
      : statusGlyph === 'rejected'
        ? { name: 'close-circle' as const, color: c.danger }
        : statusGlyph === 'pending'
          ? { name: 'time-outline' as const, color: c.gold }
          : null;

  const eyebrowLabel = frame === 'sends' ? 'Sends' : 'Receives';

  return (
    <View
      style={
        surfaceless
          ? styles.surfaceless
          : [styles.card, { backgroundColor: c.card, borderColor: c.border }]
      }
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.header}>
        <View style={styles.teamRow}>
          <ThemedText
            type="defaultSemiBold"
            style={[styles.teamName, { color: c.text }]}
            numberOfLines={1}
          >
            {teamName}
          </ThemedText>
          {onRemoveTeam && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Remove ${teamName} from trade`}
              onPress={onRemoveTeam}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.removeBtn}
            >
              <Ionicons name="close" size={16} color={c.secondaryText} />
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.eyebrowRow}>
          <View style={[styles.eyebrowRule, { backgroundColor: c.gold }]} />
          <ThemedText
            type="varsitySmall"
            style={[styles.eyebrowText, { color: c.gold }]}
          >
            {eyebrowLabel}
          </ThemedText>
          <View style={[styles.eyebrowRule, styles.eyebrowRuleFlex, { backgroundColor: c.gold }]} />
          {statusConfig && (
            <Ionicons
              name={statusConfig.name}
              size={14}
              color={statusConfig.color}
              accessibilityLabel={`Status: ${statusGlyph}`}
            />
          )}
        </View>
      </View>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  surfaceless: {},
  header: {
    paddingHorizontal: s(12),
    paddingTop: s(10),
    paddingBottom: s(6),
    gap: s(4),
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  teamName: {
    flex: 1,
    fontSize: ms(14),
  },
  removeBtn: {
    padding: s(2),
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  eyebrowRule: { height: 2, width: s(14) },
  eyebrowRuleFlex: { flex: 1 },
  eyebrowText: {
    fontSize: ms(9),
    letterSpacing: 1.4,
  },
});
