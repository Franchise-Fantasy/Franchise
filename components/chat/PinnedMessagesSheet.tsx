/**
 * The pinned-message list, opened from the pin pill in the chat header.
 *
 * Extracted from `app/chat/[id].tsx`, where it was a hand-rolled Modal showing
 * a type label, a preview and a date in a sheet locked to 60% of the screen —
 * so a league with one pinned photo got the word "Photo", a date, and a large
 * empty rectangle. This version answers the four things you actually scan a
 * pin list for: what it says, who said it, what kind of message it is, and when.
 *
 * Chrome comes from the shared `BottomSheet`, which is what gives it the app's
 * standard opening — scrim fading in while the sheet rises — plus the gold
 * rule, drag-to-dismiss and the desktop dialog variant. Rows render as plain
 * children of its ScrollView rather than a FlatList: a pin list is short by
 * nature, and nesting a virtualized list inside a ScrollView breaks scrolling.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import type { ChatMessage } from '@/types/chat';
import { ms, s } from '@/utils/scale';

interface Props {
  visible: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  isCommissioner: boolean;
  onSelect: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
}

type Descriptor = {
  /** What the row leads with — the message's own words where it has any. */
  primary: string;
  /** Name for the kind of message. */
  kind: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Image/GIF pins show the picture itself instead of an icon tile. */
  thumbnail?: string;
};

function describe(m: ChatMessage): Descriptor {
  switch (m.type) {
    case 'poll':
      return { primary: m.poll_question ?? 'Poll', kind: 'Poll', icon: 'stats-chart' };
    case 'survey':
      return { primary: m.survey_title ?? 'Survey', kind: 'Survey', icon: 'clipboard' };
    case 'trade':
      return { primary: 'Trade announcement', kind: 'Trade', icon: 'swap-horizontal' };
    case 'trade_update':
      return { primary: 'Trade update', kind: 'Trade', icon: 'swap-horizontal' };
    case 'rumor':
      return { primary: 'Trade rumor', kind: 'Rumor', icon: 'flame' };
    case 'announcement':
      return { primary: m.content, kind: 'Announcement', icon: 'megaphone' };
    case 'image':
      return { primary: 'Photo', kind: 'Photo', icon: 'image', thumbnail: m.content };
    case 'gif':
      return { primary: 'GIF', kind: 'GIF', icon: 'film', thumbnail: m.content };
    default:
      return { primary: m.content, kind: 'Message', icon: 'chatbubble' };
  }
}

function formatPinnedDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function PinnedMessagesSheet({
  visible,
  onClose,
  messages,
  isCommissioner,
  onSelect,
  onUnpin,
}: Props) {
  const c = useColors();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Pinned"
      subtitle={
        messages.length
          ? `${messages.length} ${messages.length === 1 ? 'MESSAGE' : 'MESSAGES'}`
          : undefined
      }
    >
      {messages.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="pin-outline" size={ms(26)} color={c.secondaryText} accessible={false} />
          <ThemedText style={[styles.emptyBody, { color: c.secondaryText }]}>
            {isCommissioner
              ? 'Nothing pinned yet. Long-press any message and choose Pin to keep it here.'
              : 'Nothing pinned yet. Your commissioner can pin messages worth keeping.'}
          </ThemedText>
        </View>
      ) : (
        messages.map((item) => {
          const d = describe(item);
          // Naming the kind twice reads as a stutter ("PHOTO · PHOTO · SPOERS"),
          // so it only appears when the row doesn't already lead with it.
          const meta = [
            d.primary === d.kind ? null : d.kind,
            item.team_name,
            formatPinnedDate(item.created_at),
          ]
            .filter(Boolean)
            .join(' · ');

          return (
            <Pressable
              key={item.id}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.cardAlt }]}
              onPress={() => onSelect(item.id)}
              accessibilityRole="button"
              accessibilityLabel={`Go to ${d.kind} from ${item.team_name ?? 'a teammate'}, ${formatPinnedDate(item.created_at)}`}
            >
              {d.thumbnail ? (
                <Image
                  source={{ uri: d.thumbnail }}
                  style={[styles.tile, { backgroundColor: c.cardAlt }]}
                  contentFit="cover"
                  accessible={false}
                />
              ) : (
                <View style={[styles.tile, styles.tileIcon, { backgroundColor: c.cardAlt }]}>
                  <Ionicons name={d.icon} size={ms(18)} color={c.gold} accessible={false} />
                </View>
              )}

              <View style={styles.rowBody}>
                <ThemedText style={styles.primary} numberOfLines={2}>
                  {d.primary}
                </ThemedText>
                <ThemedText
                  type="varsitySmall"
                  style={[styles.meta, { color: c.secondaryText }]}
                  numberOfLines={1}
                >
                  {meta.toUpperCase()}
                </ThemedText>
              </View>

              {isCommissioner && (
                <Pressable
                  onPress={() => onUnpin(item.id)}
                  hitSlop={10}
                  style={styles.unpin}
                  accessibilityRole="button"
                  accessibilityLabel={`Unpin ${d.kind} from ${item.team_name ?? 'a teammate'}`}
                >
                  <Ionicons name="close" size={ms(16)} color={c.secondaryText} accessible={false} />
                </Pressable>
              )}
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
    overflow: 'hidden',
  },
  tileIcon: {
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
  unpin: {
    width: s(28),
    height: s(28),
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
