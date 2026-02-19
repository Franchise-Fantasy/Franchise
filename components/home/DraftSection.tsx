import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';

interface Draft {
  id: string;
  type: 'initial' | 'rookie';
  status: 'unscheduled' | 'scheduled' | 'pending' | 'in_progress';
  season: string;
  draft_date?: string;
}

interface DraftSectionProps {
  leagueId: string;
  isCommissioner?: boolean;
}

export function DraftSection({ leagueId, isCommissioner }: DraftSectionProps) {
  const router = useRouter();
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [initialDate, setInitialDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const queryClient = useQueryClient();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: draft, isLoading } = useQuery({
    queryKey: ['activeDraft', leagueId],
    queryFn: async (): Promise<Draft | null> => {
      const { data, error } = await supabase
        .from('drafts')
        .select('id, type, status, season, draft_date')
        .eq('league_id', leagueId)
        .neq('status', 'complete')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    enabled: !!leagueId
  });

  // Invalidate when the draft status changes (e.g. marked complete by the last pick)
  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(`draft_status_${leagueId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drafts', filter: `league_id=eq.${leagueId}` },
        () => { queryClient.invalidateQueries({ queryKey: ['activeDraft', leagueId] }); }
      )
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [leagueId, queryClient]);

  const handleDateChange = (event: any, date?: Date) => {
    if (event.type === 'set' && date) {
      setSelectedDate(date);
    }
  };

  const handleConfirm = async () => {
    if (!selectedDate || !draft) return;
    const startTime = selectedDate.toISOString();
    
    const { error } = await supabase
      .from('drafts')
      .update({ 
        status: 'pending',
        draft_date: startTime,
        current_pick_timestamp: startTime
      })
      .eq('id', draft.id);

    if (error) {
      console.error('Draft scheduling error:', error);
      Alert.alert('Error', 'Failed to schedule draft');
      return;
    }

    queryClient.invalidateQueries({ queryKey: ['activeDraft', leagueId] });
    setShowDatePicker(false);
    setSelectedDate(null);
  };

  const isDraftSoon = (date: string) => {
    const draftTime = new Date(date);
    const now = new Date();
    const diffInMinutes = (draftTime.getTime() - now.getTime()) / (1000 * 60);
    return diffInMinutes <= 30 && diffInMinutes > -180;
  };

  const handlePress = () => {
    if (!draft) return;

    if (draft.draft_date && isDraftSoon(draft.draft_date)) {
      router.push({
        pathname: '/draft-room/[id]',
        params: { id: draft.id }
      });
      return;
    }

    if (draft.status !== 'in_progress' && isCommissioner) {
      setInitialDate(draft.draft_date ? new Date(draft.draft_date) : new Date());
      setShowDatePicker(true);
    }
  };

  if (isLoading) return <ActivityIndicator />;
  if (!draft) return null;

  const isActive = !!(draft.draft_date && isDraftSoon(draft.draft_date));

  return (
    <ThemedView style={[styles.section, { backgroundColor: c.card }]}>
      <TouchableOpacity 
        style={[
          styles.draftCard,
          { backgroundColor: c.cardAlt },
          isActive && { backgroundColor: c.activeCard, borderColor: c.activeBorder, borderWidth: 1 }
        ]}
        onPress={handlePress}
      >
        <ThemedText type="defaultSemiBold">
          {draft.season} {draft.type.charAt(0).toUpperCase() + draft.type.slice(1)} Draft
        </ThemedText>
        <ThemedText>
          {draft.status === 'unscheduled' 
            ? 'Schedule Draft'
            : `Scheduled for ${new Date(draft.draft_date!).toLocaleString()}`
          }
        </ThemedText>
        {draft.status !== 'unscheduled' && isCommissioner && !isDraftSoon(draft.draft_date!) && (
          <ThemedText style={[styles.tapToReschedule, { color: c.secondaryText }]}>
            Tap to reschedule
          </ThemedText>
        )}
        {isActive && (
          <ThemedText style={[styles.enterDraft, { color: c.activeText }]}>
            Enter Draft Room
          </ThemedText>
        )}
      </TouchableOpacity>

      <Modal
        animationType="fade"
        transparent={true}
        visible={showDatePicker}
        onRequestClose={() => {
          setShowDatePicker(false);
          setSelectedDate(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <ThemedView style={[styles.modalContent, { backgroundColor: c.card }]}>
            <ThemedText type="title" style={styles.modalTitle}>
              {draft.status === 'unscheduled' ? 'Schedule Draft' : 'Reschedule Draft'}
            </ThemedText>
            
            <DateTimePicker
              value={selectedDate || initialDate}
              mode="datetime"
              display="inline"
              onChange={handleDateChange}
              minimumDate={new Date()}
            />

            <View style={styles.buttonContainer}>
              <TouchableOpacity 
                style={[styles.button, { backgroundColor: c.cardAlt }]}
                onPress={() => {
                  setShowDatePicker(false);
                  setSelectedDate(null);
                }}
              >
                <ThemedText>Cancel</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.button, { backgroundColor: c.border }]}
                onPress={handleConfirm}
                disabled={!selectedDate}
              >
                <ThemedText style={{ color: selectedDate ? c.text : c.secondaryText }}>
                  Confirm
                </ThemedText>
              </TouchableOpacity>
            </View>
          </ThemedView>
        </View>
      </Modal>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 16,
    padding: 16,
    borderRadius: 8,
  },
  draftCard: {
    padding: 12,
    borderRadius: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalTitle: {
    marginBottom: 20,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
    paddingHorizontal: 20,
  },
  button: {
    padding: 12,
    borderRadius: 6,
    minWidth: 100,
    alignItems: 'center',
  },
  tapToReschedule: {
    fontSize: 12,
    marginTop: 4,
    fontStyle: 'italic',
  },
  enterDraft: {
    fontWeight: 'bold',
    marginTop: 4,
  },
});
