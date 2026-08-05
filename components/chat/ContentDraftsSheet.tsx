/**
 * The commissioner's saved poll/survey drafts, opened from the chat attach
 * menu. Tapping a row reopens the composer with that draft loaded; publishing
 * from there deletes it.
 *
 * Rows render as plain children of BottomSheet's ScrollView rather than a
 * FlatList — the list is capped at 25 by the table's own trigger, and nesting a
 * virtualized list inside a ScrollView breaks scrolling (same call made in
 * PinnedMessagesSheet).
 */
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useConfirm } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
import {
  describeContentDraft,
  type CommissionerContentDraft,
} from '@/utils/chat/contentDraftBody';
import { ms, s } from '@/utils/scale';

interface Props {
  visible: boolean;
  onClose: () => void;
  drafts: CommissionerContentDraft[];
  onSelect: (draft: CommissionerContentDraft) => void;
  onDelete: (draft: CommissionerContentDraft) => void;
}

function formatSavedDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function ContentDraftsSheet({ visible, onClose, drafts, onSelect, onDelete }: Props) {
  const c = useColors();
  const confirm = useConfirm();

  const handleDelete = (draft: CommissionerContentDraft, label: string) => {
    confirm({
      title: 'Delete draft?',
      message: `“${label}” will be gone for good.`,
      cancelLabel: 'Keep',
      action: {
        label: 'Delete',
        destructive: true,
        onPress: () => onDelete(draft),
      },
    });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Saved Drafts"
      subtitle={
        drafts.length
          ? `${drafts.length} ${drafts.length === 1 ? 'DRAFT' : 'DRAFTS'}`
          : undefined
      }
    >
      {drafts.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="document-outline" size={ms(26)} color={c.secondaryText} accessible={false} />
          <ThemedText style={[styles.emptyBody, { color: c.secondaryText }]}>
            Nothing saved yet. Start a poll or survey and tap Save Draft to finish it later.
          </ThemedText>
        </View>
      ) : (
        drafts.map((draft) => {
          const { label, meta } = describeContentDraft(draft);
          const saved = formatSavedDate(draft.updated_at);
          return (
            <Pressable
              key={draft.id}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.cardAlt }]}
              onPress={() => onSelect(draft)}
              accessibilityRole="button"
              accessibilityLabel={`Resume draft ${label}, ${meta}, saved ${saved}`}
            >
              <View style={[styles.tile, { backgroundColor: c.cardAlt }]}>
                <Ionicons
                  name={draft.kind === 'poll' ? 'stats-chart' : 'clipboard'}
                  size={ms(18)}
                  color={c.gold}
                  accessible={false}
                />
              </View>

              <View style={styles.rowBody}>
                <ThemedText style={styles.primary} numberOfLines={2}>
                  {label}
                </ThemedText>
                <ThemedText
                  type="varsitySmall"
                  style={[styles.meta, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {`${meta} · ${saved}`.toUpperCase()}
                </ThemedText>
              </View>

              <Pressable
                onPress={() => handleDelete(draft, label)}
                hitSlop={10}
                style={styles.delete}
                accessibilityRole="button"
                accessibilityLabel={`Delete draft ${label}`}
              >
                <Ionicons name="trash-outline" size={ms(16)} color={c.secondaryText} accessible={false} />
              </Pressable>
            </Pressable>
          );
        })
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    paddingVertical: s(10),
    paddingHorizontal: s(8),
    marginHorizontal: -s(8),
    borderRadius: s(12),
  },
  tile: {
    width: s(44),
    height: s(44),
    borderRadius: s(10),
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    gap: s(3),
  },
  primary: {
    fontFamily: Fonts.display,
    fontSize: ms(14),
    lineHeight: ms(18),
  },
  meta: {
    fontSize: ms(10),
    letterSpacing: 0.8,
  },
  delete: {
    width: s(32),
    height: s(32),
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: s(10),
    paddingVertical: s(28),
    paddingHorizontal: s(16),
  },
  emptyBody: {
    fontSize: ms(13),
    lineHeight: ms(19),
    textAlign: 'center',
  },
});
