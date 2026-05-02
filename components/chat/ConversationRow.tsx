import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts, cardShadow } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import type { ConversationPreview } from '@/types/chat';
import { ms, s } from '@/utils/scale';

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'NOW';
  if (diffMins < 60) return `${diffMins}M`;
  if (diffHours < 24) return `${diffHours}H`;
  if (diffDays < 7) return `${diffDays}D`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
}

interface Props {
  conversation: ConversationPreview;
  onPress: () => void;
}

export function ConversationRow({ conversation, onPress }: Props) {
  const c = useColors();
  const { data: league } = useLeague();

  const isLeague = conversation.type === 'league';
  const isTrade = conversation.type === 'trade';
  const isDM = !isLeague && !isTrade;
  const name = isLeague
    ? 'League Chat'
    : isTrade
      ? `Trade · ${conversation.other_team_name ?? 'Trade'}`
      : conversation.other_team_name ?? 'DM';
  const hasUnread = conversation.unread_count > 0;

  const preview = conversation.last_message
    ? (conversation.type === 'league' || conversation.type === 'trade') && conversation.last_message_team_name
      ? `${conversation.last_message_team_name}: ${conversation.last_message}`
      : conversation.last_message
    : 'No messages yet';

  // Match the DM partner's team in league_teams to render their logo.
  // ConversationPreview only carries other_team_name; team names are unique
  // within a league, so a name match is safe.
  const dmTeam = isDM && conversation.other_team_name
    ? (league?.league_teams ?? []).find((t: any) => t.name === conversation.other_team_name)
    : null;

  // Type-tinted avatar circle for league/trade. turfGreen / merlot stay
  // constant across sports — they signal conversation type, not accent.
  const avatarBg = isLeague ? Brand.turfGreen : Brand.merlot;
  const avatarIcon = isLeague ? 'chatbubbles' : 'swap-horizontal';

  return (
    <TouchableOpacity
      style={[
        styles.row,
        {
          backgroundColor: c.card,
          borderColor: hasUnread ? c.gold : c.border,
          borderLeftColor: hasUnread ? c.gold : c.border,
          borderLeftWidth: hasUnread ? 3 : 1,
          ...cardShadow,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${name}${hasUnread ? `, ${conversation.unread_count} unread` : ''}`}
      accessibilityHint="Open conversation"
    >
      {isDM ? (
        <TeamLogo
          logoKey={dmTeam?.logo_key}
          teamName={conversation.other_team_name ?? 'DM'}
          tricode={dmTeam?.tricode ?? undefined}
          size="medium"
        />
      ) : (
        <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
          <Ionicons name={avatarIcon} size={ms(20)} color={Brand.ecru} accessible={false} />
        </View>
      )}

      <View style={styles.content}>
        <View style={styles.topRow}>
          <ThemedText
            style={[styles.name, { color: c.text }]}
            numberOfLines={1}
          >
            {name}
          </ThemedText>
          {conversation.last_message_at && (
            <ThemedText
              style={[
                styles.time,
                { color: hasUnread ? c.gold : c.secondaryText },
              ]}
            >
              {formatTime(conversation.last_message_at)}
            </ThemedText>
          )}
        </View>
        <View style={styles.bottomRow}>
          <ThemedText
            style={[
              styles.preview,
              { color: hasUnread ? c.text : c.secondaryText },
              hasUnread && styles.previewBold,
            ]}
            numberOfLines={1}
          >
            {preview}
          </ThemedText>
          {hasUnread && (
            <View style={[styles.badge, { backgroundColor: c.primary }]}>
              <ThemedText style={[styles.badgeText, { color: Brand.ecru }]}>
                {conversation.unread_count > 99
                  ? '99+'
                  : conversation.unread_count}
              </ThemedText>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(12),
    paddingHorizontal: s(14),
    gap: s(12),
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: s(12),
    marginVertical: s(5),
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: s(3),
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: s(8),
  },
  name: {
    fontFamily: Fonts.display,
    fontSize: ms(16),
    lineHeight: ms(20),
    letterSpacing: -0.2,
    flex: 1,
  },
  time: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  preview: {
    fontSize: ms(13),
    flex: 1,
  },
  previewBold: {
    fontWeight: '600',
  },
  badge: {
    minWidth: s(20),
    height: s(20),
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(6),
  },
  badgeText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(11),
    letterSpacing: 0.4,
    lineHeight: ms(20),
    includeFontPadding: false,
  },
});
