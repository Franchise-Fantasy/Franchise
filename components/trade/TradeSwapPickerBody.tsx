import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { BrandButton } from '@/components/ui/BrandButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { formatPickLabel } from '@/types/trade';
import { swapPartiesWithoutPick } from '@/utils/league/swapEligibility';
import { ms, s } from '@/utils/scale';

interface TradeSwapPickerBodyProps {
  validSeasons: string[];
  rookieDraftRounds: number;
  /** The team giving up the swap advantage (counterparty). */
  counterpartyTeamId: string;
  counterpartyTeamName: string;
  /** The team receiving the swap advantage (beneficiary) — used for 2-team trades. */
  beneficiaryTeamId?: string;
  beneficiaryTeamName?: string;
  /** Other teams in the trade to pick beneficiary from — used for multi-team trades. */
  beneficiaryOptions?: { id: string; name: string }[];
  /** Post-trade pick counts per team/season/round — see `projectPickHoldings`. */
  holdings: Map<string, number>;
  holdingsStatus: 'loading' | 'ready' | 'error';
  onAdd: (season: string, round: number, beneficiaryTeamId?: string) => void;
}

/**
 * Interactive body of the swap picker — three filter rows (Swap With /
 * Season / Round) using the underline-active varsity-caps pattern, a
 * preview card, and the "Add Swap" CTA.
 *
 * Extracted so it composes into both the full-screen `TradeSwapPicker`
 * and the inline reveal in the upcoming `TradeFloor` rework.
 *
 * Selection state (season / round / beneficiary) is local; nothing here
 * needs to persist across mount because the picker doesn't search and
 * reopens always start at sensible defaults.
 */
export function TradeSwapPickerBody({
  validSeasons,
  rookieDraftRounds,
  counterpartyTeamId,
  counterpartyTeamName,
  beneficiaryTeamId,
  beneficiaryTeamName,
  beneficiaryOptions,
  holdings,
  holdingsStatus,
  onAdd,
}: TradeSwapPickerBodyProps) {
  const c = useColors();
  const [selectedSeason, setSelectedSeason] = useState(validSeasons[0] ?? '');
  const [selectedRound, setSelectedRound] = useState(1);
  const [selectedBeneficiary, setSelectedBeneficiary] = useState(
    beneficiaryOptions?.[0]?.id ?? beneficiaryTeamId ?? '',
  );

  const resolvedBeneficiaryName = beneficiaryOptions
    ? beneficiaryOptions.find((o) => o.id === selectedBeneficiary)?.name ?? ''
    : beneficiaryTeamName ?? '';

  const rounds = Array.from({ length: rookieDraftRounds }, (_, i) => i + 1);

  // A swap only conveys if BOTH teams hold a pick in the round — otherwise it
  // voids at the lottery, after someone already paid for it. Block it here and
  // name who's short; execute-trade re-checks at commit time.
  const nameOf = (teamId: string) =>
    teamId === counterpartyTeamId ? counterpartyTeamName : resolvedBeneficiaryName;
  const missingTeamIds = swapPartiesWithoutPick(holdings, {
    season: selectedSeason,
    round: selectedRound,
    beneficiary_team_id: selectedBeneficiary,
    counterparty_team_id: counterpartyTeamId,
  });
  const blockedReason =
    holdingsStatus === 'error'
      ? "Couldn't check which picks these teams hold. Try again."
      : holdingsStatus === 'ready' && missingTeamIds.length > 0
        ? `${missingTeamIds.map(nameOf).join(' and ')} ${missingTeamIds.length > 1 ? 'have' : 'has'} no ` +
          `${formatPickLabel(selectedSeason, selectedRound)} pick, so this swap could never convey.`
        : null;
  const canAdd = holdingsStatus === 'ready' && !blockedReason;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* Info banner — spells out who gets the favorable pick. */}
      <View style={[styles.infoCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
        <Ionicons name="swap-horizontal" size={20} color={c.gold} accessible={false} />
        <ThemedText style={[styles.infoText, { color: c.secondaryText }]}>
          <ThemedText style={{ color: c.text, fontWeight: '600' }}>{resolvedBeneficiaryName}</ThemedText>
          {' '}will receive the more favorable pick between both teams for the selected round.
        </ThemedText>
      </View>

      {beneficiaryOptions && beneficiaryOptions.length > 1 && (
        <SectionLabel label="Swap With" c={c} />
      )}
      {beneficiaryOptions && beneficiaryOptions.length > 1 && (
        <UnderlineRow
          options={beneficiaryOptions.map((opt) => ({ key: opt.id, label: opt.name }))}
          selectedKey={selectedBeneficiary}
          onSelect={setSelectedBeneficiary}
          c={c}
        />
      )}

      <SectionLabel label="Season" c={c} />
      <UnderlineRow
        options={validSeasons.map((season) => ({
          key: season,
          label: String(parseInt(season.split('-')[0], 10)),
        }))}
        selectedKey={selectedSeason}
        onSelect={setSelectedSeason}
        c={c}
      />

      <SectionLabel label="Round" c={c} />
      <UnderlineRow
        options={rounds.map((r) => ({ key: String(r), label: `Round ${r}` }))}
        selectedKey={String(selectedRound)}
        onSelect={(key) => setSelectedRound(parseInt(key, 10))}
        c={c}
      />

      <View style={[styles.preview, { borderColor: c.border, backgroundColor: c.card }]}>
        <View style={styles.previewEyebrowRow}>
          <View style={[styles.previewRule, { backgroundColor: c.gold }]} />
          <ThemedText
            type="varsitySmall"
            style={[styles.previewEyebrow, { color: c.gold }]}
          >
            Preview
          </ThemedText>
        </View>
        <View style={styles.previewBody}>
          <Ionicons name="swap-horizontal" size={16} color={c.gold} accessible={false} />
          <ThemedText style={[styles.previewText, { color: c.text }]}>
            {formatPickLabel(selectedSeason, selectedRound)} swap
          </ThemedText>
        </View>
        <ThemedText
          type="varsitySmall"
          style={[styles.previewSub, { color: c.secondaryText }]}
          numberOfLines={1}
        >
          {counterpartyTeamName} ↔ {resolvedBeneficiaryName}
        </ThemedText>
        {blockedReason && (
          <View style={styles.blockedRow}>
            <Ionicons name="alert-circle" size={16} color={c.danger} accessible={false} />
            <ThemedText style={[styles.blockedText, { color: c.danger }]}>
              {blockedReason}
            </ThemedText>
          </View>
        )}
      </View>

      <BrandButton
        label="Add Swap"
        icon="add"
        variant="primary"
        fullWidth
        loading={holdingsStatus === 'loading'}
        disabled={!canAdd}
        onPress={() =>
          onAdd(selectedSeason, selectedRound, beneficiaryOptions ? selectedBeneficiary : undefined)
        }
        accessibilityLabel="Add swap"
        accessibilityHint={blockedReason ?? undefined}
      />
    </ScrollView>
  );
}

// Gold-rule + varsity caps section header — shared across the three
// filter rows so they read as the same chrome.
function SectionLabel({ label, c }: { label: string; c: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.sectionLabelRow}>
      <View style={[styles.sectionLabelRule, { backgroundColor: c.gold }]} />
      <ThemedText
        type="varsitySmall"
        style={[styles.sectionLabel, { color: c.gold }]}
        accessibilityRole="header"
      >
        {label}
      </ThemedText>
    </View>
  );
}

// Underline-active varsity-caps option row — same pattern as ByYearTab,
// ProspectsTab, prospect-board, draft-room toggle bar, DraftBoard.
function UnderlineRow({
  options,
  selectedKey,
  onSelect,
  c,
}: {
  options: { key: string; label: string }[];
  selectedKey: string;
  onSelect: (key: string) => void;
  c: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.underlineRow}>
      {options.map((opt) => {
        const active = opt.key === selectedKey;
        return (
          <TouchableOpacity
            key={opt.key}
            accessibilityRole="button"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected: active }}
            style={styles.underlineBtn}
            onPress={() => onSelect(opt.key)}
            activeOpacity={0.7}
          >
            <ThemedText
              type="varsity"
              style={[
                styles.underlineText,
                { color: active ? c.text : c.secondaryText },
              ]}
            >
              {opt.label}
            </ThemedText>
            <View
              style={[
                styles.underlineUnderline,
                { backgroundColor: active ? c.gold : 'transparent' },
              ]}
            />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: s(16),
    gap: s(14),
  },

  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    padding: s(12),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
  },
  infoText: { flex: 1, fontSize: ms(13), lineHeight: ms(18) },

  sectionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginTop: s(4),
  },
  sectionLabelRule: { height: 2, width: s(14) },
  sectionLabel: {
    fontSize: ms(9),
    letterSpacing: 1.4,
  },

  underlineRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(20),
    marginTop: s(2),
  },
  underlineBtn: {
    alignItems: 'center',
    paddingTop: s(2),
  },
  underlineText: {
    fontSize: ms(11),
    letterSpacing: 1.0,
  },
  underlineUnderline: {
    marginTop: s(6),
    height: 2,
    width: '100%',
    minWidth: s(28),
  },

  preview: {
    padding: s(14),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    gap: s(6),
  },
  previewEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  previewRule: { height: 2, width: s(14) },
  previewEyebrow: {
    fontSize: ms(9),
    letterSpacing: 1.4,
  },
  previewBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    marginTop: s(2),
  },
  previewText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
  previewSub: {
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
  blockedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: s(6),
    marginTop: s(6),
  },
  blockedText: { flex: 1, fontSize: ms(12), lineHeight: ms(17) },
});
