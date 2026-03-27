import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { generateDraftPicks, generateFutureDraftPicks } from '@/lib/draft';
import { supabase } from '@/lib/supabase';
import { sanitizeHandle } from '@/utils/paymentLinks';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface EditBasicsModalProps {
  visible: boolean;
  onClose: () => void;
  league: any;
  leagueId: string;
  canChangeSize?: boolean;
  currentTeamCount?: number;
}

export function EditBasicsModal({ visible, onClose, league, leagueId, canChangeSize = false, currentTeamCount = 0 }: EditBasicsModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [buyIn, setBuyIn] = useState(0);
  const [venmoUsername, setVenmoUsername] = useState('');
  const [cashappTag, setCashappTag] = useState('');
  const [paypalUsername, setPaypalUsername] = useState('');
  const [maxTeams, setMaxTeams] = useState(12);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && league) {
      setName(league.name ?? '');
      setIsPrivate(league.private ?? false);
      setBuyIn(league.buy_in_amount ?? 0);
      setVenmoUsername(league.venmo_username ?? '');
      setCashappTag(league.cashapp_tag ?? '');
      setPaypalUsername(league.paypal_username ?? '');
      setMaxTeams(league.teams ?? 12);
    }
  }, [visible]);

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Error', 'League name cannot be empty.');
      return;
    }
    setSaving(true);
    const updates: Record<string, any> = {
      name: name.trim(),
      private: isPrivate,
      buy_in_amount: buyIn || null,
      venmo_username: sanitizeHandle(venmoUsername) || null,
      cashapp_tag: sanitizeHandle(cashappTag) || null,
      paypal_username: sanitizeHandle(paypalUsername) || null,
    };
    if (canChangeSize) {
      updates.teams = maxTeams;
      // Clamp playoff_teams if it exceeds new league size
      if (league.playoff_teams && league.playoff_teams > maxTeams) {
        updates.playoff_teams = maxTeams;
      }
    }
    const { error } = await supabase
      .from('leagues')
      .update(updates)
      .eq('id', leagueId);
    if (error) {
      setSaving(false);
      Alert.alert('Error', error.message);
      return;
    }

    // If league size changed, update draft picks_per_round and regenerate picks
    if (canChangeSize && maxTeams !== (league.teams ?? 12)) {
      try {
        const { data: draft } = await supabase
          .from('drafts')
          .select('id, rounds, draft_type, season, type')
          .eq('league_id', leagueId)
          .eq('type', 'initial')
          .maybeSingle();

        if (draft) {
          // Update picks_per_round on draft row
          await supabase
            .from('drafts')
            .update({ picks_per_round: maxTeams })
            .eq('id', draft.id);

          // Delete existing draft picks and regenerate
          await supabase
            .from('draft_picks')
            .delete()
            .eq('draft_id', draft.id);

          await generateDraftPicks(
            draft.id,
            maxTeams,
            draft.rounds,
            draft.season,
            leagueId,
            (draft.draft_type as 'snake' | 'linear') ?? 'snake',
          );
        }

        // Regenerate future draft picks (dynasty leagues)
        if (league.league_type === 'dynasty' && league.max_future_seasons > 0) {
          await supabase
            .from('draft_picks')
            .delete()
            .eq('league_id', leagueId)
            .is('draft_id', null);

          await generateFutureDraftPicks(
            leagueId,
            maxTeams,
            league.rookie_draft_rounds ?? 3,
            league.season,
            league.max_future_seasons,
          );
        }
      } catch (err: any) {
        setSaving(false);
        Alert.alert('Warning', 'League size updated but draft picks may need manual regeneration.');
        queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
        onClose();
        return;
      }
    }

    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={() => {}} accessibilityViewIsModal={true}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" style={styles.title}>League Basics</ThemedText>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            <View style={[styles.editRow, { borderBottomColor: c.border }]}>
              <ThemedText style={styles.rowLabel}>Name</ThemedText>
              <TextInput
                accessibilityLabel="League name"
                style={[styles.textInput, { color: c.text, backgroundColor: c.input, borderColor: c.border }]}
                value={name}
                onChangeText={setName}
                placeholder="League name"
                placeholderTextColor={c.secondaryText}
              />
            </View>

            <View style={[styles.editRow, { borderBottomColor: c.border }]}>
              <ThemedText style={styles.rowLabel}>Visibility</ThemedText>
              <View style={{ width: 160 }}>
                <SegmentedControl
                  options={['Public', 'Private']}
                  selectedIndex={isPrivate ? 1 : 0}
                  onSelect={(i) => setIsPrivate(i === 1)}
                />
              </View>
            </View>

            {canChangeSize && (
              <NumberStepper
                label="League Size"
                value={maxTeams}
                onValueChange={setMaxTeams}
                min={Math.max(2, currentTeamCount)}
                max={30}
                step={1}
              />
            )}

            <NumberStepper
              label="Buy-In ($)"
              value={buyIn}
              onValueChange={setBuyIn}
              min={0}
              max={1000}
              step={5}
            />

            {buyIn > 0 && (
              <>
                <ThemedText style={[styles.sectionLabel, { color: c.secondaryText }]}>
                  Payment Methods
                </ThemedText>

                <View style={[styles.editRow, { borderBottomColor: c.border }]}>
                  <ThemedText style={styles.rowLabel}>Venmo</ThemedText>
                  <TextInput
                    accessibilityLabel="Venmo username"
                    style={[styles.textInput, { color: c.text, backgroundColor: c.input, borderColor: c.border }]}
                    value={venmoUsername}
                    onChangeText={setVenmoUsername}
                    placeholder="username (no @)"
                    placeholderTextColor={c.secondaryText}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View style={[styles.editRow, { borderBottomColor: c.border }]}>
                  <ThemedText style={styles.rowLabel}>Cash App</ThemedText>
                  <TextInput
                    accessibilityLabel="Cash App tag"
                    style={[styles.textInput, { color: c.text, backgroundColor: c.input, borderColor: c.border }]}
                    value={cashappTag}
                    onChangeText={setCashappTag}
                    placeholder="cashtag (no $)"
                    placeholderTextColor={c.secondaryText}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View style={[styles.editRow, { borderBottomColor: c.border }]}>
                  <ThemedText style={styles.rowLabel}>PayPal</ThemedText>
                  <TextInput
                    accessibilityLabel="PayPal username"
                    style={[styles.textInput, { color: c.text, backgroundColor: c.input, borderColor: c.border }]}
                    value={paypalUsername}
                    onChangeText={setPaypalUsername}
                    placeholder="username"
                    placeholderTextColor={c.secondaryText}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel" style={[styles.btn, { backgroundColor: c.cardAlt }]} onPress={onClose}>
              <ThemedText style={styles.btnText}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Save"
              accessibilityState={{ disabled: saving }}
              style={[styles.btn, { backgroundColor: saving ? c.buttonDisabled : c.accent }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[styles.btnText, { color: c.accentText }]}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 12, paddingBottom: 40, maxHeight: '85%' },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  titleRow: { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: 16, marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '600' },
  scroll: { flexShrink: 1, paddingHorizontal: 16 },
  editRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 14 },
  sectionLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 4 },
  textInput: { flex: 1, marginLeft: 12, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 16 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { fontSize: 15, fontWeight: '600' },
});
