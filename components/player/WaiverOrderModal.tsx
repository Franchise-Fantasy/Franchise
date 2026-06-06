import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

import { type WaiverOrderRow } from './FreeAgentStatusRibbon';

interface Props {
  visible: boolean;
  onClose: () => void;
  waiverOrder: WaiverOrderRow[];
  teamId: string;
  /** When `'faab'`, the per-row trailing slot displays each team's
   *  remaining FAAB budget instead of just the priority order. */
  waiverType: 'standard' | 'faab' | 'none';
}

/**
 * Modal listing the league's waiver priority order (or FAAB budgets,
 * for FAAB leagues). Mirrors the chrome of the filter modal in
 * `PlayerFilterBar` — backdrop scrim, centered card, close-X header —
 * so all status-row pills that open detail surfaces feel of-a-piece.
 */
export function WaiverOrderModal({
  visible,
  onClose,
  waiverOrder,
  teamId,
  waiverType,
}: Props) {
  const c = useColors();

  // FAAB has no waiver priority — bids decide, ties go to the earliest bid.
  // Order teams by remaining budget (most first) and drop the rank column.
  const isFaab = waiverType === 'faab';
  const rows = isFaab
    ? [...waiverOrder].sort(
        (a, b) => (b.faab_remaining ?? 0) - (a.faab_remaining ?? 0),
      )
    : waiverOrder;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close waiver order"
        />
        <View style={[styles.modal, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color={c.secondaryText} />
            </TouchableOpacity>
            <View style={styles.eyebrowRow}>
              <View style={[styles.rule, { backgroundColor: c.gold }]} />
              <ThemedText
                type="varsitySmall"
                style={[styles.eyebrow, { color: c.gold }]}
              >
                {isFaab ? 'FAAB BUDGETS' : 'WAIVER ORDER'}
              </ThemedText>
            </View>
            <View style={styles.headerSpacer} />
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {rows.length === 0 ? (
              <View style={styles.empty}>
                <ThemedText style={{ color: c.secondaryText, fontSize: ms(13) }}>
                  {isFaab
                    ? "FAAB budgets aren't set up yet."
                    : "Waiver order isn't set up yet."}
                </ThemedText>
              </View>
            ) : (
              rows.map((wp, idx) => {
                const isLast = idx === rows.length - 1;
                const isMe = wp.team_id === teamId;
                return (
                  <View
                    key={wp.team_id}
                    style={[
                      styles.row,
                      { borderBottomColor: c.border },
                      isLast && { borderBottomWidth: 0 },
                      isMe && { backgroundColor: c.cardAlt },
                    ]}
                  >
                    {!isFaab && (
                      <ThemedText
                        style={[
                          styles.priority,
                          { color: isMe ? c.gold : c.secondaryText },
                        ]}
                      >
                        {wp.priority}
                      </ThemedText>
                    )}
                    <ThemedText
                      style={[
                        styles.teamName,
                        { color: c.text, fontWeight: isMe ? '700' : '400' },
                      ]}
                      numberOfLines={1}
                    >
                      {wp.team?.name ?? 'Unknown'}
                      {isMe ? ' (You)' : ''}
                    </ThemedText>
                    {isFaab && (
                      <ThemedText style={[styles.faab, { color: c.secondaryText }]}>
                        ${wp.faab_remaining ?? 0}
                      </ThemedText>
                    )}
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(24),
  },
  modal: {
    width: '100%',
    maxHeight: '80%',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: s(20),
    paddingTop: s(14),
    paddingBottom: s(16),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: s(12),
  },
  headerSpacer: {
    width: s(22),
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  rule: {
    height: 2,
    width: s(14),
  },
  eyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.4,
  },
  empty: {
    paddingVertical: s(20),
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(10),
  },
  priority: {
    fontSize: ms(15),
    fontWeight: '700',
    width: s(28),
    textAlign: 'center',
  },
  teamName: {
    flex: 1,
    fontSize: ms(13),
  },
  faab: {
    fontSize: ms(13),
    fontWeight: '600',
  },
});
