import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  View,
} from 'react-native';

import { AppTextInput } from '@/components/ui/AppTextInput';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { type Sport } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { buildDraftPicks, buildFutureDraftPicks } from '@/lib/draft';
import { supabase } from '@/lib/supabase';
import { Json, TablesUpdate } from '@/types/database.types';
import { sanitizeHandle } from '@/utils/league/paymentLinks';
import { containsBlockedContent } from '@/utils/moderation';
import { ms, s } from '@/utils/scale';

interface EditBasicsModalProps {
  visible: boolean;
  onClose: () => void;
  league: any;
  leagueId: string;
  canChangeSize?: boolean;
  currentTeamCount?: number;
}

export function EditBasicsModal({ visible, onClose, league, leagueId, canChangeSize = false, currentTeamCount = 0 }: EditBasicsModalProps) {
  const c = useColors();
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
    if (containsBlockedContent(name)) {
      Alert.alert('Invalid name', 'That league name contains language that isn’t allowed.');
      return;
    }
    setSaving(true);
    const updates: TablesUpdate<'leagues'> = {
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

    // If league size changed, rebuild every draft pick for the new size.
    //
    // This was a delete-then-regenerate across two pick sets, and a failure
    // between them left the league with NO draft picks — the old catch block
    // said as much ("picks may need manual regeneration"). The picks are laid
    // out here and swapped in by replace_draft_picks in a single transaction, so
    // a failure keeps the old picks instead of destroying them.
    if (canChangeSize && maxTeams !== (league.teams ?? 12)) {
      try {
        const { data: draft } = await supabase
          .from('drafts')
          .select('id, rounds, draft_type, season, type')
          .eq('league_id', leagueId)
          .eq('type', 'initial')
          .maybeSingle();

        const hasInitial = !!draft && draft.rounds != null && !!draft.season;
        const isDynasty = league.league_type === 'dynasty' && league.max_future_seasons > 0;

        const { error: picksError } = await supabase.rpc('replace_draft_picks', {
          p_league_id: leagueId,
          ...(hasInitial
            ? {
                p_draft_id: draft!.id,
                p_picks_per_round: maxTeams,
                p_initial_picks: buildDraftPicks(
                  maxTeams,
                  draft!.rounds!,
                  draft!.season!,
                  (draft!.draft_type as 'snake' | 'linear') ?? 'snake',
                ) as unknown as Json,
              }
            : {}),
          ...(isDynasty
            ? {
                p_future_picks: buildFutureDraftPicks(
                  maxTeams,
                  league.rookie_draft_rounds ?? 3,
                  league.season,
                  league.max_future_seasons,
                  (league.sport as Sport | null) ?? 'nba',
                ) as unknown as Json,
              }
            : {}),
        });
        if (picksError) throw picksError;
      } catch {
        setSaving(false);
        Alert.alert('Warning', 'League size updated but draft picks were not regenerated. Try saving again.');
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
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="League Basics"
      keyboardAvoiding
      footer={
        <View style={styles.footer}>
          <BrandButton
            label="Cancel"
            variant="secondary"
            size="large"
            onPress={onClose}
            fullWidth
            style={styles.footerBtn}
            accessibilityLabel="Cancel"
          />
          <BrandButton
            label="Save"
            variant="primary"
            size="large"
            onPress={handleSave}
            loading={saving}
            fullWidth
            style={styles.footerBtn}
            accessibilityLabel="Save"
          />
        </View>
      }
    >
      <View style={[styles.editRow, { borderBottomColor: c.border }]}>
        <ThemedText style={styles.rowLabel}>Name</ThemedText>
        <AppTextInput
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
        <View style={{ width: s(160) }}>
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
            <AppTextInput
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
            <AppTextInput
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
            <AppTextInput
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
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  editRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: s(12), borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: ms(14) },
  sectionLabel: { fontSize: ms(12), fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: s(16), marginBottom: s(4) },
  textInput: { flex: 1, marginLeft: s(12), borderWidth: 1, borderRadius: 8, paddingHorizontal: s(10), paddingVertical: s(8), fontSize: ms(14) },
  footer: { flexDirection: 'row', gap: s(12) },
  footerBtn: { flex: 1 },
});
