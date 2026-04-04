import { ThemedText } from '@/components/ui/ThemedText';
import { ms, s } from "@/utils/scale";
import { TradeHistoryModal } from '@/components/player/TradeHistoryModal';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { PlayerHistoryEvent, usePlayerHistory } from '@/hooks/usePlayerHistory';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';

function getEventIcon(event: PlayerHistoryEvent): keyof typeof Ionicons.glyphMap {
  switch (event.type) {
    case 'draft':
      return 'trophy';
    case 'trade':
      return 'swap-horizontal';
    case 'waiver':
      if (event.teamFrom && !event.teamTo) return 'person-remove';
      return 'person-add';
    case 'commissioner':
      return 'shield';
    default:
      return 'document-text';
  }
}

function getEventColor(event: PlayerHistoryEvent, c: typeof Colors.light): string {
  switch (event.type) {
    case 'draft':
      return c.gold;
    case 'trade':
      return c.link;
    case 'waiver':
    case 'commissioner':
      if (event.teamFrom && !event.teamTo) return c.danger;
      if (event.teamTo) return c.success;
      return c.secondaryText;
    default:
      return c.secondaryText;
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

interface PlayerHistoryProps {
  playerId: string | undefined;
  leagueId: string;
}

export function PlayerHistory({ playerId, leagueId }: PlayerHistoryProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [selectedTradeTransactionId, setSelectedTradeTransactionId] = useState<string | null>(null);
  const { data: events, isLoading } = usePlayerHistory(playerId, leagueId);

  const hasEvents = events && events.length > 0;

  return (
    <View style={styles.container}>
      {selectedTradeTransactionId && (
        <TradeHistoryModal
          transactionId={selectedTradeTransactionId}
          leagueId={leagueId}
          onClose={() => setSelectedTradeTransactionId(null)}
        />
      )}

      {isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : !hasEvents ? (
        <ThemedText
          style={[styles.emptyText, { color: c.secondaryText }]}
          accessibilityLabel="No transaction history for this player"
        >
          No transaction history
        </ThemedText>
      ) : (
        <View
          style={styles.content}
          accessibilityLabel={`Transaction history, ${events.length} events`}
        >
          {events.map((event, index) => {
            const isTrade = event.type === 'trade' && !!event.transactionId;
            const Wrapper = isTrade ? TouchableOpacity : View;
            const wrapperProps = isTrade
              ? {
                  onPress: () => setSelectedTradeTransactionId(event.transactionId!),
                  activeOpacity: 0.6,
                  accessibilityRole: 'button' as const,
                  accessibilityLabel: `${event.description}, ${formatDate(event.date)}. Tap for trade details`,
                  accessibilityHint: 'Opens trade details',
                }
              : {
                  accessibilityLabel: `${event.description}, ${formatDate(event.date)}`,
                };

            return (
              <Wrapper
                key={event.id}
                style={styles.eventRow}
                {...wrapperProps}
              >
                {/* Timeline connector */}
                <View style={styles.timelineColumn}>
                  <View style={[styles.iconCircle, { backgroundColor: getEventColor(event, c) + '20' }]}>
                    <Ionicons name={getEventIcon(event)} size={14} color={getEventColor(event, c)} accessible={false} />
                  </View>
                  {index < events.length - 1 && (
                    <View style={[styles.connector, { backgroundColor: c.border }]} />
                  )}
                </View>

                {/* Event details */}
                <View style={styles.eventDetails}>
                  <View style={styles.eventDescriptionRow}>
                    <ThemedText style={[styles.eventDescription, { flex: 1 }]}>{event.description}</ThemedText>
                    {isTrade && (
                      <Ionicons name="information-circle-outline" size={16} color={c.secondaryText} accessibilityElementsHidden />
                    )}
                  </View>
                  <ThemedText style={[styles.eventDate, { color: c.secondaryText }]}>
                    {formatDate(event.date)}
                  </ThemedText>
                </View>
              </Wrapper>
            );
          })}
          {events.length < 3 && (
            <ThemedText style={[styles.noOtherText, { color: c.secondaryText }]}>
              No other transactions
            </ThemedText>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
  },
  content: {
    marginTop: 0,
  },
  loader: {
    paddingVertical: 12,
  },
  emptyText: {
    fontSize: ms(13),
    paddingVertical: 8,
  },
  noOtherText: {
    fontSize: ms(12),
    fontStyle: 'italic',
    paddingLeft: 40,
    paddingTop: 4,
  },
  eventRow: {
    flexDirection: 'row',
    marginBottom: 0,
  },
  timelineColumn: {
    width: 32,
    alignItems: 'center',
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    width: 2,
    flex: 1,
    minHeight: 12,
  },
  eventDetails: {
    flex: 1,
    paddingLeft: 8,
    paddingBottom: 16,
  },
  eventDescriptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eventDescription: {
    fontSize: ms(13),
    fontWeight: '500',
  },
  eventDate: {
    fontSize: ms(11),
    marginTop: 2,
  },
});
