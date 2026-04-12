import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { queryKeys } from '@/constants/queryKeys';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { SafeAreaView } from 'react-native-safe-area-context';

interface LotteryEntry {
  team_id: string;
  team_name: string;
  original_standing: number;
  lottery_position: number;
  was_drawn: boolean;
}

export default function LotteryRoomScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId } = useAppState();
  const { data: league } = useLeague();
  const session = useSession();
  const queryClient = useQueryClient();
  const isCommissioner = session?.user?.id === league?.created_by;

  const [lotteryResults, setLotteryResults] = useState<LotteryEntry[] | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [ceremonyStarted, setCeremonyStarted] = useState(false);
  const flipAnims = useRef<Animated.Value[]>([]);
  const broadcastChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const totalSlots = lotteryResults?.length ?? 0;

  // Fetch existing lottery results (in case lottery already ran)
  const { data: existingResults } = useQuery({
    queryKey: queryKeys.lotteryResults(leagueId!, league?.season),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lottery_results')
        .select('results')
        .eq('league_id', leagueId!)
        .eq('season', league!.season)
        .maybeSingle();
      if (error) throw error;
      return data?.results as LotteryEntry[] | null;
    },
    enabled: !!leagueId && !!league?.season,
  });

  // If results already exist (e.g., page refresh), show them fully revealed
  useEffect(() => {
    if (existingResults && !lotteryResults) {
      setLotteryResults(existingResults);
      // If lottery_status is 'complete', show all revealed
      if (league?.lottery_status === 'complete') {
        setRevealedCount(existingResults.length);
        setCeremonyStarted(true);
      }
    }
  }, [existingResults, league?.lottery_status]);

  // Initialize flip animations when results are set
  useEffect(() => {
    if (lotteryResults) {
      flipAnims.current = lotteryResults.map(() => new Animated.Value(0));
    }
  }, [lotteryResults?.length]);

  // Realtime broadcast channel for synchronizing reveal across clients.
  // Broadcast channels require a shared deterministic name — all clients must
  // match so sends reach subscribers. The postgres_changes Date.now() rule
  // does not apply here. We store the channel in a ref so commissioner sends
  // reuse it instead of creating orphaned channel instances.
  useEffect(() => {
    if (!leagueId) return;

    const channel = supabase
      .channel(`lottery:${leagueId}`)
      .on('broadcast', { event: 'lottery_results' }, (payload) => {
        setLotteryResults(payload.payload.results);
      })
      .on('broadcast', { event: 'ceremony_start' }, () => {
        setCeremonyStarted(true);
      })
      .on('broadcast', { event: 'reveal_pick' }, (payload) => {
        const idx = payload.payload.index as number;
        revealSlot(idx);
      })
      .subscribe();

    broadcastChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      broadcastChannelRef.current = null;
    };
  }, [leagueId]);

  const revealSlot = useCallback((revealIndex: number) => {
    // revealIndex is the lottery position being revealed (from last to first)
    // So revealIndex 0 = last pick, revealIndex (total-1) = first pick
    setRevealedCount(prev => Math.max(prev, revealIndex + 1));
    if (flipAnims.current[revealIndex]) {
      Animated.spring(flipAnims.current[revealIndex], {
        toValue: 1,
        friction: 8,
        tension: 40,
        useNativeDriver: true,
      }).start();
    }
  }, []);

  const handleRunLottery = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('start-lottery', {
        body: { league_id: leagueId },
      });
      if (error) throw error;
      const results = data.results as LotteryEntry[];
      setLotteryResults(results);

      // Broadcast results to all clients via the shared channel
      await broadcastChannelRef.current?.send({
        type: 'broadcast',
        event: 'lottery_results',
        payload: { results },
      });
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to run lottery');
    } finally {
      setIsRunning(false);
    }
  };

  const handleStartCeremony = async () => {
    setCeremonyStarted(true);
    await broadcastChannelRef.current?.send({
      type: 'broadcast',
      event: 'ceremony_start',
      payload: {},
    });
  };

  const handleRevealNext = async () => {
    // Reveal from last pick to first pick
    const nextRevealIndex = revealedCount;
    if (nextRevealIndex >= totalSlots) return;

    revealSlot(nextRevealIndex);
    await broadcastChannelRef.current?.send({
      type: 'broadcast',
      event: 'reveal_pick',
      payload: { index: nextRevealIndex },
    });
  };

  const handleDone = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId!) });
    router.back();
  };

  const allRevealed = revealedCount >= totalSlots && totalSlots > 0;

  // Render a single lottery slot (shown in reverse: last pick at top, first pick at bottom)
  const renderSlot = (entry: LotteryEntry, displayIndex: number) => {
    // displayIndex 0 = last pick (totalSlots), displayed first
    // The reveal order goes 0, 1, 2... (last pick revealed first)
    const isRevealed = displayIndex < revealedCount;
    const flipAnim = flipAnims.current[displayIndex];
    const scale = flipAnim
      ? flipAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.1, 1] })
      : 1;
    const opacity = flipAnim
      ? flipAnim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 0, 1] })
      : isRevealed ? 1 : 0;

    const pickNumber = totalSlots - displayIndex; // Convert display order to pick number

    return (
      <View
        key={entry.team_id}
        style={[styles.slot, { backgroundColor: c.card, borderColor: c.border }]}
        accessibilityLabel={isRevealed ? `Pick ${pickNumber}: ${entry.team_name}${entry.was_drawn ? ', lottery winner' : ''}` : `Pick ${pickNumber}: not yet revealed`}
      >
        <View style={[styles.pickNumberBadge, { backgroundColor: pickNumber === 1 ? c.gold : c.cardAlt }]}>
          <ThemedText style={[styles.pickNumber, pickNumber === 1 && { color: c.background }]}>
            #{pickNumber}
          </ThemedText>
        </View>
        {isRevealed ? (
          <Animated.View style={[styles.revealedContent, { opacity, transform: [{ scale }] }]}>
            <ThemedText type="defaultSemiBold" style={styles.teamName} numberOfLines={1}>
              {entry.team_name}
            </ThemedText>
            {entry.was_drawn && (
              <View style={[styles.drawnBadge, { backgroundColor: c.activeCard }]}>
                <ThemedText style={[styles.drawnText, { color: c.activeText }]}>Lottery</ThemedText>
              </View>
            )}
            <ThemedText style={[styles.standing, { color: c.secondaryText }]}>
              Was #{entry.original_standing} worst
            </ThemedText>
          </Animated.View>
        ) : (
          <View style={styles.hiddenContent}>
            <Ionicons name="help-circle" size={24} color={c.secondaryText} accessible={false} />
          </View>
        )}
      </View>
    );
  };

  // Arrange slots: display last pick first (top) → first pick last (bottom)
  const displayOrder = lotteryResults
    ? [...lotteryResults].sort((a, b) => b.lottery_position - a.lottery_position)
    : [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity style={styles.headerButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
          <ThemedText style={[styles.backButton, { color: c.activeText }]}>
            {'\u2190'}
          </ThemedText>
        </TouchableOpacity>
        <ThemedText type="title" style={styles.headerText} accessibilityRole="header">Draft Lottery</ThemedText>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.body}>
        {!lotteryResults ? (
          // Phase 1: Commissioner runs the lottery
          <View style={styles.preStartContainer}>
            <Ionicons name="trophy" size={64} color={c.accent} style={{ marginBottom: 16 }} accessible={false} />
            <ThemedText type="subtitle" style={{ textAlign: 'center', marginBottom: 8 }}>
              Draft Lottery
            </ThemedText>
            <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
              {isCommissioner
                ? 'When everyone is ready, run the lottery to determine the rookie draft order.'
                : 'Waiting for the commissioner to start the lottery...'}
            </ThemedText>
            {isCommissioner && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: c.accent }, isRunning && { opacity: 0.6 }]}
                onPress={handleRunLottery}
                disabled={isRunning}
                accessibilityRole="button"
                accessibilityLabel={isRunning ? 'Running lottery' : 'Run Lottery'}
                accessibilityState={{ disabled: isRunning }}
              >
                {isRunning ? (
                  <LogoSpinner size={18} delay={0} />
                ) : (
                  <ThemedText style={[styles.actionButtonText, { color: c.statusText }]}>Run Lottery</ThemedText>
                )}
              </TouchableOpacity>
            )}
          </View>
        ) : !ceremonyStarted ? (
          // Phase 2: Results computed, commissioner starts the reveal ceremony
          <View style={styles.preStartContainer}>
            <Ionicons name="play-circle" size={64} color={c.accent} style={{ marginBottom: 16 }} accessible={false} />
            <ThemedText type="subtitle" style={{ textAlign: 'center', marginBottom: 8 }}>
              Results Are In!
            </ThemedText>
            <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
              {isCommissioner
                ? 'Start the reveal ceremony when everyone is watching.'
                : 'The lottery has been drawn. Waiting for the reveal to begin...'}
            </ThemedText>
            {isCommissioner && (
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: c.accent }]}
                onPress={handleStartCeremony}
                accessibilityRole="button"
                accessibilityLabel="Begin Reveal"
              >
                <ThemedText style={[styles.actionButtonText, { color: c.statusText }]}>Begin Reveal</ThemedText>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          // Phase 3: Reveal ceremony
          <View style={styles.revealContainer}>
            <View style={styles.slotList} accessibilityRole="list" accessibilityLiveRegion="polite">
              {displayOrder.map((entry, idx) => renderSlot(entry, idx))}
            </View>

            {/* Commissioner reveal button or completion */}
            <View style={styles.bottomBar}>
              {allRevealed ? (
                <>
                  <ThemedText type="defaultSemiBold" style={{ textAlign: 'center', marginBottom: 8 }}>
                    {displayOrder[displayOrder.length - 1]?.team_name} gets the #1 pick!
                  </ThemedText>
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: c.accent }]}
                    onPress={handleDone}
                    accessibilityRole="button"
                    accessibilityLabel="Done"
                  >
                    <ThemedText style={[styles.actionButtonText, { color: c.statusText }]}>Done</ThemedText>
                  </TouchableOpacity>
                </>
              ) : isCommissioner ? (
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: c.accent }]}
                  onPress={handleRevealNext}
                  accessibilityRole="button"
                  accessibilityLabel={`Reveal Pick number ${totalSlots - revealedCount}`}
                >
                  <ThemedText style={[styles.actionButtonText, { color: c.statusText }]}>
                    Reveal Pick #{totalSlots - revealedCount}
                  </ThemedText>
                </TouchableOpacity>
              ) : (
                <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
                  Waiting for next reveal...
                </ThemedText>
              )}
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    padding: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    height: s(50),
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    textAlign: 'center',
    fontSize: ms(20),
    fontWeight: '300',
    marginHorizontal: s(40),
  },
  headerButton: { padding: s(8), width: s(36), alignItems: 'center' },
  backButton: { fontSize: ms(24) },
  body: { flex: 1 },
  preStartContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(32),
  },
  subtitle: {
    fontSize: ms(14),
    textAlign: 'center',
    marginBottom: s(24),
    lineHeight: ms(20),
  },
  actionButton: {
    paddingHorizontal: s(32),
    paddingVertical: s(14),
    borderRadius: 12,
    minWidth: s(200),
    alignItems: 'center',
  },
  actionButtonText: {
    fontSize: ms(16),
    fontWeight: '700',
  },
  revealContainer: { flex: 1 },
  slotList: {
    flex: 1,
    padding: s(16),
    gap: s(8),
  },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: s(12),
    borderRadius: 10,
    borderWidth: 1,
    minHeight: s(52),
  },
  pickNumberBadge: {
    width: s(40),
    height: s(32),
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: s(12),
  },
  pickNumber: {
    fontSize: ms(14),
    fontWeight: '800',
  },
  revealedContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  teamName: {
    fontSize: ms(15),
    flexShrink: 1,
  },
  drawnBadge: {
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: 4,
  },
  drawnText: {
    fontSize: ms(9),
    fontWeight: '700',
  },
  standing: {
    fontSize: ms(11),
    marginLeft: 'auto',
  },
  hiddenContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBar: {
    padding: s(16),
    alignItems: 'center',
  },
});
