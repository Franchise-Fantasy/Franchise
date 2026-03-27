import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { formatPickLabel } from '@/types/trade';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

interface TradeSwapPickerProps {
  validSeasons: string[];
  rookieDraftRounds: number;
  /** The team giving up the swap advantage (counterparty) */
  counterpartyTeamId: string;
  counterpartyTeamName: string;
  /** The team receiving the swap advantage (beneficiary) — used for 2-team trades */
  beneficiaryTeamId?: string;
  beneficiaryTeamName?: string;
  /** Other teams in the trade to pick beneficiary from — used for multi-team trades */
  beneficiaryOptions?: { id: string; name: string }[];
  onAdd: (season: string, round: number, beneficiaryTeamId?: string) => void;
  onBack: () => void;
}

export function TradeSwapPicker({
  validSeasons,
  rookieDraftRounds,
  counterpartyTeamName,
  beneficiaryTeamId,
  beneficiaryTeamName,
  beneficiaryOptions,
  onAdd,
  onBack,
}: TradeSwapPickerProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [selectedSeason, setSelectedSeason] = useState(validSeasons[0] ?? '');
  const [selectedRound, setSelectedRound] = useState(1);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState(beneficiaryOptions?.[0]?.id ?? beneficiaryTeamId ?? '');

  const resolvedBeneficiaryName = beneficiaryOptions
    ? beneficiaryOptions.find((o) => o.id === selectedBeneficiary)?.name ?? ''
    : beneficiaryTeamName ?? '';

  const rounds = Array.from({ length: rookieDraftRounds }, (_, i) => i + 1);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.backBtn}>
          <ThemedText style={[styles.backText, { color: c.accent }]}>‹ Back</ThemedText>
        </TouchableOpacity>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.headerTitle}>Pick Swap</ThemedText>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.infoCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
          <Ionicons name="swap-horizontal" size={20} color={c.accent} accessible={false} />
          <ThemedText style={[styles.infoText, { color: c.secondaryText }]}>
            {resolvedBeneficiaryName} will receive the more favorable pick between both teams for the selected round.
          </ThemedText>
        </View>

        {beneficiaryOptions && beneficiaryOptions.length > 1 && (
          <>
            <ThemedText accessibilityRole="header" style={[styles.sectionLabel, { color: c.secondaryText }]}>Swap With</ThemedText>
            <View style={styles.pillRow}>
              {beneficiaryOptions.map((opt) => {
                const active = opt.id === selectedBeneficiary;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    accessibilityRole="button"
                    accessibilityLabel={opt.name}
                    accessibilityState={{ selected: active }}
                    style={[styles.pill, { backgroundColor: active ? c.accent : c.cardAlt, borderColor: active ? c.accent : c.border }]}
                    onPress={() => setSelectedBeneficiary(opt.id)}
                  >
                    <ThemedText style={[styles.pillText, { color: active ? c.accentText : c.text }]}>
                      {opt.name}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        <ThemedText accessibilityRole="header" style={[styles.sectionLabel, { color: c.secondaryText }]}>Season</ThemedText>
        <View style={styles.pillRow}>
          {validSeasons.map((s) => {
            const active = s === selectedSeason;
            return (
              <TouchableOpacity
                key={s}
                accessibilityRole="button"
                accessibilityLabel={`Season ${s}`}
                accessibilityState={{ selected: active }}
                style={[styles.pill, { backgroundColor: active ? c.accent : c.cardAlt, borderColor: active ? c.accent : c.border }]}
                onPress={() => setSelectedSeason(s)}
              >
                <ThemedText style={[styles.pillText, { color: active ? c.accentText : c.text }]}>
                  {parseInt(s.split('-')[0], 10)}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        <ThemedText accessibilityRole="header" style={[styles.sectionLabel, { color: c.secondaryText }]}>Round</ThemedText>
        <View style={styles.pillRow}>
          {rounds.map((r) => {
            const active = r === selectedRound;
            return (
              <TouchableOpacity
                key={r}
                accessibilityRole="button"
                accessibilityLabel={`Round ${r}`}
                accessibilityState={{ selected: active }}
                style={[styles.pill, { backgroundColor: active ? c.accent : c.cardAlt, borderColor: active ? c.accent : c.border }]}
                onPress={() => setSelectedRound(r)}
              >
                <ThemedText style={[styles.pillText, { color: active ? c.accentText : c.text }]}>
                  Round {r}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={[styles.preview, { borderColor: c.border, backgroundColor: c.card }]}>
          <Ionicons name="swap-horizontal" size={16} color={c.accent} accessible={false} />
          <ThemedText style={styles.previewText}>
            {formatPickLabel(selectedSeason, selectedRound)} swap
          </ThemedText>
          <ThemedText style={[styles.previewSub, { color: c.secondaryText }]}>
            {counterpartyTeamName} vs {resolvedBeneficiaryName}
          </ThemedText>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Add swap"
          style={[styles.addBtn, { backgroundColor: c.accent }]}
          onPress={() => onAdd(selectedSeason, selectedRound, beneficiaryOptions ? selectedBeneficiary : undefined)}
        >
          <ThemedText style={[styles.addBtnText, { color: c.accentText }]}>Add Swap</ThemedText>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 60 },
  backText: { fontSize: 16, fontWeight: '500' },
  headerTitle: { flex: 1, fontSize: 16, textAlign: 'center' },
  content: { padding: 16, gap: 16 },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18 },
  sectionLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  pillText: { fontSize: 13, fontWeight: '600' },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    padding: 14,
    borderWidth: 1,
    borderRadius: 10,
  },
  previewText: { fontSize: 14, fontWeight: '600' },
  previewSub: { fontSize: 12 },
  addBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
  },
  addBtnText: { fontSize: 15, fontWeight: '600' },
});
