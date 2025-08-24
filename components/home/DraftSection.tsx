import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { supabase } from '@/lib/supabase';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
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

  const { data: draft, isLoading } = useQuery({
    queryKey: ['activeDraft', leagueId],
    queryFn: async (): Promise<Draft | null> => {
      const { data, error } = await supabase
        .from('drafts')
        .select('id, type, status, season, draft_date')
        .eq('league_id', leagueId)
        .neq('status', 'completed')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!leagueId
  });

  const handleDateChange = (event: any, date?: Date) => {
    if (event.type === 'set' && date) {
      setSelectedDate(date);
    }
  };

  const handleConfirm = async () => {
    if (!selectedDate || !draft) return;
    const startTime = selectedDate.toISOString()
    
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
    return diffInMinutes <= 30 && diffInMinutes > -180; // Allow access from 30 mins before until 3 hours after
  };

  const handlePress = () => {
    if (!draft) return;

    if (draft.draft_date && isDraftSoon(draft.draft_date)) {
      // Update the navigation path
      router.push({
        pathname: '/draft-room/[id]',
        params: { id: draft.id }
      });
      return;
    }

    // Existing scheduling logic
    if (draft.status !== 'in_progress' && isCommissioner) {
      setInitialDate(draft.draft_date ? new Date(draft.draft_date) : new Date());
      setShowDatePicker(true);
    }
  };

  if (isLoading) return <ActivityIndicator />;
  if (!draft) return null;

  return (
    <ThemedView style={styles.section}>
      <TouchableOpacity 
        style={[
          styles.draftCard,
          draft.draft_date && isDraftSoon(draft.draft_date) && styles.draftCardActive
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
          <ThemedText style={styles.tapToReschedule}>
            Tap to reschedule
          </ThemedText>
        )}
        {draft.draft_date && isDraftSoon(draft.draft_date) && (
          <ThemedText style={styles.enterDraft}>
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
          <ThemedView style={styles.modalContent}>
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
                style={[styles.button, styles.cancelButton]}
                onPress={() => {
                  setShowDatePicker(false);
                  setSelectedDate(null);
                }}
              >
                <ThemedText>Cancel</ThemedText>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[styles.button, styles.confirmButton]}
                onPress={handleConfirm}
                disabled={!selectedDate}
              >
                <ThemedText style={{ color: selectedDate ? '#000' : '#999' }}>
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
    backgroundColor: 'white',
    borderRadius: 8,
  },
  draftCard: {
    padding: 12,
    backgroundColor: '#f5f5f5',
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
    backgroundColor: 'white',
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
  cancelButton: {
    backgroundColor: '#f5f5f5',
  },
  confirmButton: {
    backgroundColor: '#e6e6e6',
  },
  tapToReschedule: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    fontStyle: 'italic'
  },
  draftCardActive: {
    backgroundColor: '#e6f3ff',
    borderColor: '#0066cc',
    borderWidth: 1,
  },
  enterDraft: {
    color: '#0066cc',
    fontWeight: 'bold',
    marginTop: 4,
  }
});