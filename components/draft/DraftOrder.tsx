import { useDraftTimer } from '@/hooks/useDraftTimer';
import { supabase } from '@/lib/supabase';
import { DraftState, Pick } from '@/types/draft';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText } from '../ThemedText';
import { ThemedView } from '../ThemedView';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';


interface DraftOrderProps {
  draftId: string;
  leagueId: string;
  teamId: string;
  onCurrentPickChange: (pick: { id: string; current_team_id: string } | null) => void;
}

export function DraftOrder({ draftId, leagueId, teamId, onCurrentPickChange }: DraftOrderProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const scrollViewRef = useRef<ScrollView>(null);
  const queryClient = useQueryClient();
  const [lastPickId, setLastPickId] = useState<string | null>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;

    // NEW: Fetch the main draft state for the timer
  const { data: draftState, isLoading: isLoadingDraftState } = useQuery<DraftState>({
    queryKey: ['draftState', draftId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drafts')
        .select('*')
        .eq('id', draftId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const [currentPickTimestamp, setCurrentPickTimestamp] = useState<string | undefined>(draftState?.current_pick_timestamp);

  // update this whenever draftState changes
  useEffect(() => {
    if (draftState?.current_pick_timestamp) {
      setCurrentPickTimestamp(draftState.current_pick_timestamp);
    }
  }, [draftState?.current_pick_timestamp, draftState?.current_pick_number]);


  // NEW: Use the timer hook with the fetched draft state
  const countdown = useDraftTimer(currentPickTimestamp, draftState?.time_limit);

  // Create flash animation
  const flashPick = (pickId: string) => {
    setLastPickId(pickId);
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 800, useNativeDriver: false }),
      Animated.timing(flashAnim, { toValue: 0, duration: 800, useNativeDriver: false }),
    ]).start(() => {
      setTimeout(() => setLastPickId(null), 200);
    });
  };

  const { data: picks = [], isLoading, error } = useQuery({
    queryKey: ['draftOrder', draftId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('draft_picks')
        .select(`
          id,
          pick_number,
          round,
          current_team_id,
          player_id,
          slot_number,
          current_team:current_team_id (
            name
          ),
          player:player_id (
            name,
            position
          )
        `)
        .eq('draft_id', draftId)
        .order('pick_number');

      if (error) throw error;
      // Map arrays to objects for current_team and player
      return (data ?? []).map((pick: any) => ({
        ...pick,
        current_team: Array.isArray(pick.current_team) ? pick.current_team[0] : pick.current_team,
        player: Array.isArray(pick.player) ? pick.player[0] : pick.player,
      })) as Pick[];
    }
  });

  // Update subscription to trigger flash
  useEffect(() => {

      // NEW: Subscription for the main draft state (for timer)
    const draftChannel = supabase
      .channel(`draft_room_${draftId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drafts', filter: `id=eq.${draftId}` },
        (payload) => {
          queryClient.setQueryData(['draftState', draftId], payload.new);
        }
      )
      .subscribe();
    // Subscription for the pick list (for flashing)
    const picksChannel = supabase
      .channel(`draft_picks_${draftId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'draft_picks', filter: `draft_id=eq.${draftId}` },
        (payload) => {
          if (payload.eventType === 'UPDATE' && payload.new.player_id) {
            flashPick(payload.new.id);
              setCurrentPickTimestamp(new Date().toISOString());

          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['draftOrder', draftId] });
          }, 1000);
          }
        }
      ).subscribe();



    return () => {
      picksChannel.unsubscribe();
      draftChannel.unsubscribe();
    };
  }, [draftId, queryClient]);

  // Find the index of the first unmade pick
    const currentPickIndex = picks.findIndex(pick => !pick.player_id);
    const currentPick = picks[currentPickIndex];
    const isMyTurn = currentPick?.current_team_id === teamId;

  // Scroll to current pick when component mounts or picks change
  useEffect(() => {
    if (currentPickIndex > -1) {
      // Add a small delay to ensure layout is complete
      setTimeout(() => {
        const blockWidth = 120; // width of block
        const margin = 4; // margin on each side
        const padding = 2; // reduced padding before block
        
        const scrollPosition = Math.max(
          0, 
          (currentPickIndex * (blockWidth + margin * 2)) - padding
        );
        
        scrollViewRef.current?.scrollTo({
          x: scrollPosition,
          animated: true
        });
      }, 100);
    }
  }, [currentPickIndex]);



  // Find the current pick and notify parent
  useEffect(() => {
    const currentPick = picks.find(pick => !pick.player_id);
    onCurrentPickChange(currentPick ? {
      id: currentPick.id,
      current_team_id: currentPick.current_team_id
    } : null);
  }, [picks, onCurrentPickChange]);

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (error) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText>Error loading draft order</ThemedText>
      </ThemedView>
    );
  }

  return (
    
    <ScrollView ref={scrollViewRef} horizontal style={[styles.container, { borderColor: colors.border, backgroundColor: colors.cardAlt }]} showsHorizontalScrollIndicator={false}>
      {picks.map((pick, index) => {
        const isCurrentOnTheClock = index === currentPickIndex;
        return (
          <Animated.View key={pick.id} style={[
            styles.pickBlock,
            { backgroundColor: colors.card, borderColor: colors.border },
            pick.player_id && { backgroundColor: colors.activeCard, borderColor: colors.activeBorder },
            isCurrentOnTheClock && styles.currentPick,
            pick.id === lastPickId && { backgroundColor: flashAnim.interpolate({ inputRange: [0, 1], outputRange: [colors.activeCard, '#ffeb3b'] }) }
          ]}>
            <View style={styles.pickHeader}>
              <ThemedText style={[styles.pickNumber, { color: colors.secondaryText }]}>{pick.round}-{pick.slot_number}</ThemedText>
              <ThemedText style={[styles.teamName, { color: colors.secondaryText }]}>{pick.current_team?.name || 'TBD'}</ThemedText>
            </View>
            <View style={styles.pickContent}>
              {pick.player_id ? (
                <ThemedText style={[styles.playerName, { color: colors.activeText }]}>
                  {pick.player?.name}{'\n'}
                  <ThemedText style={[styles.playerPosition, { color: colors.secondaryText }]}>{pick.player?.position}</ThemedText>
                </ThemedText>
              ) : isCurrentOnTheClock ? (
                <ThemedText style={styles.timerText}>{countdown}</ThemedText>
              ) : null}
            </View>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    maxHeight: 100,
    borderBottomWidth: 1,
  },
  timerText: {
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: "center",
  },
  pickBlock: {
    width: 120,
    height: 80,
    padding: 6,
    margin: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  pickHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  pickContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickNumber: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  teamName: {
    fontSize: 11,
    textAlign: 'right',
  },
  playerName: {
    fontSize: 12,
    textAlign: 'center',
  },
  playerPosition: {
    fontSize: 10,
  },
  currentPick: {
    borderColor: '#ffa500',
    borderWidth: 2,
  },
});