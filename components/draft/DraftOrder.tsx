import { supabase } from '@/lib/supabase';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText } from '../ThemedText';
import { ThemedView } from '../ThemedView';

interface Pick {
  id: string;
  pick_number: number;
  round: number;
  current_team_id: string;
  player_id?: string;
  slot_number: number;
  current_team?: {
    name: string;
  };
  player?: {
    name: string;
    position: string;
  };
}



interface DraftOrderProps {
  draftId: string;
  onCurrentPickChange: (pick: { id: string; current_team_id: string } | null) => void;
}

export function DraftOrder({ draftId, onCurrentPickChange }: DraftOrderProps) {
  const scrollViewRef = useRef<ScrollView>(null);
  const queryClient = useQueryClient();
  const [lastPickId, setLastPickId] = useState<string | null>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;

  // Create flash animation
  const flashPick = (pickId: string) => {
    setLastPickId(pickId);
    Animated.sequence([
      Animated.timing(flashAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: false,
      }),
      Animated.timing(flashAnim, {
        toValue: 0,
        duration: 600,
        useNativeDriver: false,
      }),
    ]).start(() => {
      // Clear the lastPickId after animation
      setTimeout(() => setLastPickId(null), 500);
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
    console.log('Setting up subscription for draft:', draftId);
    
    const channel = supabase
      .channel(`draft_picks_${draftId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'draft_picks',
          filter: `draft_id=eq.${draftId}`,
        },
        (payload) => {
          console.log('Received change:', payload);
          if (payload.eventType === 'UPDATE' && payload.new.player_id) {
            flashPick(payload.new.id);
            // Delay the query invalidation
            setTimeout(() => {
              queryClient.invalidateQueries({
                queryKey: ['draftOrder', draftId]
              });
            }, 1000); // Wait 1 second before updating
          }
        }
      );

    // Log subscription status
    channel
      .subscribe((status) => {
        console.log('Subscription status:', status);
      });

    // Cleanup subscription on unmount
    return () => {
      console.log('Cleaning up subscription');
      channel.unsubscribe();
    };
  }, [draftId, queryClient]);

  // Find the index of the first unmade pick
  const currentPickIndex = picks.findIndex(pick => !pick.player_id);

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
    <ScrollView 
      ref={scrollViewRef}
      horizontal 
      style={styles.container}
      showsHorizontalScrollIndicator={false}
    >
      {picks.map((pick, index) => (
        <Animated.View 
          key={pick.id} 
          style={[
            styles.pickBlock,
            pick.player_id && styles.pickMade,
            index === currentPickIndex && styles.currentPick,
            pick.id === lastPickId && {
              backgroundColor: flashAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['#e6f3ff', '#ffeb3b']
              })
            }
          ]}
        >
          <View style={styles.pickHeader}>
            <ThemedText style={styles.pickNumber}>
            {pick.round}-{pick.pick_number}
            </ThemedText>
            <ThemedText style={styles.teamName}>
              {pick.current_team?.name || 'TBD'}
            </ThemedText>
          </View>
          
          <View style={styles.pickContent}>
            {pick.player_id && (
              <ThemedText style={styles.playerName}>
                {pick.player?.name}
                {'\n'}
                <ThemedText style={styles.playerPosition}>
                  {pick.player?.position}
                </ThemedText>
              </ThemedText>
            )}
          </View>
        </Animated.View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    maxHeight: 100,  // Reduced height
    borderBottomWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#f8f8f8',
  },
  pickBlock: {
    width: 120,  // Reduced width
    height: 80,  // Reduced height
    padding: 6,  // Reduced padding
    margin: 4,   // Reduced margin
    backgroundColor: '#fff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  pickHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,  // Reduced margin
  },
  pickContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickNumber: {
    fontSize: 11,  // Slightly smaller font
    color: '#666',
    fontWeight: 'bold',
  },
  teamName: {
    fontSize: 11,  // Slightly smaller font
    color: '#666',
    textAlign: 'right',
  },
  playerName: {
    fontSize: 12,  // Slightly smaller font
    textAlign: 'center',
    color: '#0066cc',
  },
  playerPosition: {
    fontSize: 10,  // Slightly smaller font
    color: '#666',
  },
  pickMade: {
    backgroundColor: '#e6f3ff',
    borderColor: '#0066cc',
  },
  currentPick: {
    borderColor: '#ffa500',
    borderWidth: 2,
  },
  flashAnimation: {
    backgroundColor: '#ffeb3b', // Yellow flash color
  }
});