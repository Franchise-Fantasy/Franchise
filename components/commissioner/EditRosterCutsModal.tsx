import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AnimatedSection } from '@/components/ui/AnimatedSection';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { DateField } from '@/components/ui/DateField';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { ThemedText } from '@/components/ui/ThemedText';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { TablesUpdate } from '@/types/database.types';
import { formatIsoDate, toDateStr } from '@/utils/dates';
import { ms, s } from '@/utils/scale';

interface EditRosterCutsModalProps {
  visible: boolean;
  onClose: () => void;
  league: any;
  leagueId: string;
}

/** Local-midnight date `days` from today, as an ISO `yyyy-mm-dd` string. */
function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return toDateStr(d);
}

/**
 * Dynasty roster-cuts settings.
 *
 * Two related but separate values, which is why this is its own sheet rather
 * than a block inside Season Settings:
 *
 *  - `roster_cuts_grace_days` is the standing POLICY — how long teams get after
 *    every rookie draft. It is set in the create-league wizard and applies each
 *    season, so it stays editable for the whole league lifecycle.
 *  - `roster_cuts_deadline` is the one concrete date currently pending. The
 *    rookie draft arms it from the grace period; enforcement clears it. It
 *    deliberately survives the season start (an over-cap team is allowed into
 *    the regular season and still owes a cut), so the commissioner needs to be
 *    able to postpone or cancel it mid-season — something the Season card's
 *    mid-season lock would prevent.
 */
export function EditRosterCutsModal({
  visible,
  onClose,
  league,
  leagueId,
}: EditRosterCutsModalProps) {
  const c = useColors();
  const queryClient = useQueryClient();

  // null = automatic cuts off for this league.
  const [graceDays, setGraceDays] = useState<number | null>(14);
  // ISO `yyyy-mm-dd`, or null when no deadline is pending.
  const [deadline, setDeadline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seeded from `league` only, which league-info's page gate guarantees is
  // loaded before this renders — so the always-mounted-modal hydration trap
  // (CLAUDE.md) doesn't apply here.
  useEffect(() => {
    if (!visible || !league) return;
    setGraceDays(league.roster_cuts_grace_days ?? null);
    setDeadline(league.roster_cuts_deadline ?? null);
  }, [visible, league]);

  // Cuts can never be due in the past. Keyed on `visible` so a long-lived mount
  // refreshes the floor each time the sheet opens.
  const minDeadline = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
  }, [visible]);

  async function handleSave() {
    if (!league) return;
    setSaving(true);

    const update: TablesUpdate<'leagues'> = {
      roster_cuts_grace_days: graceDays,
      roster_cuts_deadline: deadline,
    };

    const { error } = await supabase.from('leagues').update(update).eq('id', leagueId);
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['cutsPlan', leagueId] });
    onClose();
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Roster Cuts"
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
      <ThemedText style={[styles.intro, { color: c.secondaryText }]}>
        Rookie drafts don&apos;t enforce roster size, so teams can finish the draft
        over the cap on purpose. An over-cap team keeps every player, but its roster
        moves stay locked until it trims. Automatic cuts are the backstop for the
        teams that never do.
      </ThemedText>

      <ToggleRow
        icon="cut-outline"
        label="Automatic Cuts"
        description={
          graceDays == null
            ? 'Off — nothing is ever trimmed for you. Over-cap teams stay locked until they trim, or you resolve it by hand.'
            : undefined
        }
        value={graceDays != null}
        onToggle={(v) => setGraceDays(v ? 14 : null)}
        c={c}
        last={graceDays == null}
      />
      <AnimatedSection visible={graceDays != null}>
        <NumberStepper
          label="Grace Period"
          value={graceDays ?? 14}
          onValueChange={setGraceDays}
          min={0}
          max={60}
          suffix=" days"
          last
        />
        <ThemedText style={[styles.helperText, { color: c.secondaryText }]}>
          Every rookie draft sets a deadline this many days out. Anyone still over
          the cap the next morning has their newest additions moved to an open taxi
          seat where one fits, and dropped where none does — so the last players
          drafted go first.
        </ThemedText>
      </AnimatedSection>

      <View style={[styles.sectionRule, { borderTopColor: c.border }]} />

      <ToggleRow
        icon="calendar-outline"
        label="Deadline Pending"
        description={
          deadline
            ? `Over-cap teams are trimmed the morning after ${formatIsoDate(deadline)}.`
            : 'No deadline right now. The next rookie draft sets one automatically.'
        }
        value={!!deadline}
        onToggle={(v) => setDeadline(v ? isoDaysFromNow(graceDays ?? 14) : null)}
        c={c}
        last={!deadline}
      />
      <AnimatedSection visible={!!deadline}>
        <DateField
          label="Cuts Due By"
          value={deadline}
          onChange={setDeadline}
          minimumDate={minDeadline}
          last
        />
        <ThemedText style={[styles.helperText, { color: c.secondaryText }]}>
          Teams get all of this day. Pushing it back gives everyone more time;
          turning it off cancels the pending cuts entirely.
        </ThemedText>
      </AnimatedSection>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: s(12) },
  footerBtn: { flex: 1 },
  intro: { fontSize: ms(13), marginBottom: s(12) },
  helperText: { fontSize: ms(13), marginTop: s(6) },
  sectionRule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginVertical: s(14),
  },
});
