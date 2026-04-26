import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ManualDraftOrderModal } from '@/components/commissioner/ManualDraftOrderModal';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { Colors, cardShadow } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { logger } from '@/utils/logger';
import { ms, s } from '@/utils/scale';

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
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [initialDate, setInitialDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const queryClient = useQueryClient();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: draft, isLoading } = useQuery({
    queryKey: queryKeys.activeDraft(leagueId),
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
      return data as Draft | null;
    },
    enabled: !!leagueId
  });

  // Fetch league's initial_draft_order setting
  const { data: leagueSettings } = useQuery({
    queryKey: queryKeys.leagueDraftOrder(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('initial_draft_order')
        .eq('id', leagueId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
  });

  // Check if draft slots are assigned (for manual order gating)
  const { data: slotsAssigned } = useQuery({
    queryKey: queryKeys.draftSlotsAssigned(draft?.id ?? ''),
    queryFn: async () => {
      if (!draft?.id) return false;
      const { count, error } = await supabase
        .from('draft_picks')
        .select('id', { count: 'exact', head: true })
        .eq('draft_id', draft.id)
        .eq('round', 1)
        .not('current_team_id', 'is', null);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: !!draft?.id,
  });

  const isManual = leagueSettings?.initial_draft_order === 'manual';
  const isInitialDraft = draft?.type === 'initial';
  const needsManualOrder = isManual && isInitialDraft && !slotsAssigned;

  // Invalidate when the draft status changes (e.g. marked complete by the last pick)
  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(`draft_status_${leagueId}-${Date.now()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drafts', filter: `league_id=eq.${leagueId}` },
        () => { queryClient.invalidateQueries({ queryKey: queryKeys.activeDraft(leagueId) }); }
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
    const rounded = new Date(selectedDate);
    rounded.setSeconds(0, 0);
    const startTime = rounded.toISOString();

    const { error } = await supabase
      .from('drafts')
      .update({
        status: 'pending',
        draft_date: startTime,
      })
      .eq('id', draft.id);

    if (error) {
      logger.error('Draft scheduling failed', error);
      Alert.alert('Error', 'Failed to schedule draft');
      return;
    }

    queryClient.invalidateQueries({ queryKey: queryKeys.activeDraft(leagueId) });
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
      // If manual order not yet set, block scheduling
      if (needsManualOrder) {
        Alert.alert('Set Draft Order', 'You need to set the draft order before scheduling the draft.');
        return;
      }
      setInitialDate(draft.draft_date ? new Date(draft.draft_date) : new Date());
      setShowDatePicker(true);
    }
  };

  if (isLoading) return <LogoSpinner />;
  if (!draft) return null;

  const isActive = isDraftEnterable;
  const showPreDraft = !isActive && (draft.status === 'unscheduled' || draft.status === 'pending');

  return (
    <View style={[styles.section, { backgroundColor: isActive ? c.activeCard : c.card, borderColor: isActive ? c.activeBorder : c.border }]}>
      <TouchableOpacity
        style={[styles.draftRow, { borderBottomWidth: needsManualOrder && isCommissioner && showPreDraft ? StyleSheet.hairlineWidth : 0, borderBottomColor: c.border }]}
        onPress={handlePress}
        activeOpacity={0.7}
      >
        <View style={styles.draftInfo}>
          <ThemedText type="defaultSemiBold">
            {draft.season} {draft.type.charAt(0).toUpperCase() + draft.type.slice(1)} Draft
          </ThemedText>
          <ThemedText style={{ color: isActive ? c.activeText : c.secondaryText, fontSize: ms(14), marginTop: s(2) }}>
            {draft.status === 'unscheduled'
              ? 'Not yet scheduled'
              : `${new Date(draft.draft_date!).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
          </ThemedText>
          {/* Draft order status line */}
          {isInitialDraft && showPreDraft && (
            <ThemedText style={{ color: c.secondaryText, fontSize: ms(13), marginTop: s(2) }}>
              {isManual
                ? (slotsAssigned ? 'Draft order set by commissioner' : 'Draft order not yet set')
                : 'Draft order randomized'}
            </ThemedText>
          )}
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

      {/* "Set Draft Order" button for commissioner when manual + not yet set */}
      {isCommissioner && isInitialDraft && isManual && showPreDraft && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={slotsAssigned ? 'Edit draft order' : 'Set draft order'}
          style={[styles.setOrderBtn, { backgroundColor: c.accent }]}
          onPress={() => setShowOrderModal(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="reorder-three" size={18} color={c.accentText} />
          <ThemedText style={[styles.setOrderText, { color: c.accentText }]}>
            {slotsAssigned ? 'Edit Draft Order' : 'Set Draft Order'}
          </ThemedText>
        </TouchableOpacity>
      )}

      {/* Manual Draft Order Modal */}
      {draft && (
        <ManualDraftOrderModal
          visible={showOrderModal}
          onClose={() => {
            setShowOrderModal(false);
            queryClient.invalidateQueries({ queryKey: queryKeys.draftSlotsAssigned(draft.id) });
          }}
          leagueId={leagueId}
          draftId={draft.id}
        />
      )}

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
              display="spinner"
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
    paddingHorizontal: s(16),
    paddingVertical: s(4),
    marginBottom: s(16),
    ...cardShadow,
  },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(12),
  },
  draftInfo: {
    flex: 1,
  },
  setOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
    paddingVertical: s(10),
    borderRadius: 8,
    marginTop: s(4),
    marginBottom: s(4),
  },
  setOrderText: {
    fontSize: ms(14),
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    padding: s(20),
    borderRadius: 12,
    alignItems: 'center',
  },
  modalTitle: {
    marginBottom: s(20),
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: s(20),
    paddingHorizontal: s(20),
  },
  button: {
    padding: s(12),
    borderRadius: 6,
    minWidth: s(100),
    alignItems: 'center',
  },
  tapToReschedule: {
    fontSize: ms(12),
    marginTop: s(4),
    fontStyle: 'italic',
  },
  enterDraft: {
    fontWeight: 'bold',
    fontSize: ms(14),
  },
});
