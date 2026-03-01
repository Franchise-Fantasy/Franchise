import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
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
    // Use a unique channel name to avoid getting a stale cached instance
    // when the component remounts before removeChannel fully completes.
    const channel = supabase
      .channel(`draft_status_${leagueId}_${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drafts', filter: `league_id=eq.${leagueId}` },
        () => { queryClient.invalidateQueries({ queryKey: ['activeDraft', leagueId] }); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
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

  // Draft is enterable if it's actively running OR starting soon
  const isDraftEnterable = draft?.status === 'in_progress' ||
    !!(draft?.draft_date && isDraftSoon(draft.draft_date));

  const handlePress = () => {
    if (!draft) return;

    if (isDraftEnterable) {
      router.push({
        pathname: '/draft-room/[id]',
        params: { id: draft.id }
      });
      return;
    }

    if (isCommissioner) {
      setInitialDate(draft.draft_date ? new Date(draft.draft_date) : new Date());
      setShowDatePicker(true);
    }
  };

  if (isLoading) return <ActivityIndicator />;
  if (!draft) return null;

  const isActive = isDraftEnterable;

  return (
    <View style={[styles.section, { backgroundColor: isActive ? c.activeCard : c.card, borderColor: isActive ? c.activeBorder : c.border }]}>
      <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Draft</ThemedText>
      <TouchableOpacity
        style={[styles.draftRow, { borderBottomWidth: 0 }]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={styles.draftInfo}>
          <ThemedText type="defaultSemiBold">
            {draft.season} {draft.type.charAt(0).toUpperCase() + draft.type.slice(1)} Draft
          </ThemedText>
          <ThemedText style={{ color: isActive ? c.activeText : c.secondaryText, fontSize: 14, marginTop: 2 }}>
            {draft.status === 'unscheduled'
              ? 'Not yet scheduled'
              : `${new Date(draft.draft_date!).toLocaleString()}`}
          </ThemedText>
          {draft.status !== 'unscheduled' && isCommissioner && !isDraftEnterable && (
            <ThemedText style={[styles.tapToReschedule, { color: c.secondaryText }]}>
              Tap to reschedule
            </ThemedText>
          )}
        </View>
        {isActive ? (
          <ThemedText style={[styles.enterDraft, { color: c.activeText }]}>Enter</ThemedText>
        ) : (
          <Ionicons name="chevron-forward" size={18} color={c.secondaryText} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    marginBottom: 16,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  draftInfo: {
    flex: 1,
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
    fontSize: 14,
  },
});
