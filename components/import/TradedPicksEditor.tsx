import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { FormSection } from '@/components/ui/FormSection';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, Fonts } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

import {
  draftYearLabel,
  isCompleteTradedPick,
  isDuplicateTradedPick,
  type ImportTeamRef,
  type TradedPickDraft,
} from './draftPhase';

interface Props {
  teams: ImportTeamRef[];
  /** Seasons a pick can target (S0..SN or S1..SN depending on draft phase). */
  seasons: string[];
  /** Number of rookie-draft rounds (picks can be traded per round). */
  rounds: number;
  value: TradedPickDraft[];
  onChange: (next: TradedPickDraft[]) => void;
}

/**
 * Manually capture future draft picks that have been traded — {season, round,
 * from-team → to-team}. The from/to teams are referenced by import key (Sleeper
 * roster_id or screenshot team name); the edge function resolves them to team
 * UUIDs at import time and sets `current_team_id` accordingly.
 *
 * Add flow uses the shared `BottomSheet` primitive (no nested Modal). Pickers
 * are pre-constrained to valid seasons/rounds/teams so invalid rows can't be
 * entered; duplicates of an existing (season, round, from) are blocked too.
 */
export function TradedPicksEditor({ teams, seasons, rounds, value, onChange }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<TradedPickDraft>>({});

  const nameByKey = new Map(teams.map(t => [t.key, t.name]));
  const roundOptions = Array.from({ length: Math.max(1, rounds) }, (_, i) => i + 1);

  const openAdd = () => {
    setDraft({ season: seasons[0], round: 1 });
    setAdding(true);
  };

  const canSave =
    isCompleteTradedPick(draft) && !isDuplicateTradedPick(value, draft);

  const save = () => {
    if (!isCompleteTradedPick(draft)) return;
    if (isDuplicateTradedPick(value, draft)) return;
    onChange([...value, draft]);
    setAdding(false);
    setDraft({});
  };

  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <FormSection title="Traded Draft Picks">
      <ThemedText style={[styles.intro, { color: c.secondaryText }]}>
        Add any future picks that have changed hands so ownership imports correctly.
      </ThemedText>

      {value.length === 0 ? (
        <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
          No traded picks added.
        </ThemedText>
      ) : (
        <View style={[styles.list, { borderColor: c.border }]}>
          {value.map((p, index) => (
            <View
              key={`${p.season}-${p.round}-${p.fromKey}`}
              style={[
                styles.row,
                index < value.length - 1 && { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <View style={styles.rowText}>
                <ThemedText style={[styles.rowTitle, { color: c.text }]} numberOfLines={1}>
                  {draftYearLabel(p.season)} · R{p.round}
                </ThemedText>
                <ThemedText style={[styles.rowSub, { color: c.secondaryText }]} numberOfLines={1}>
                  {nameByKey.get(p.fromKey) ?? p.fromKey} → {nameByKey.get(p.toKey) ?? p.toKey}
                </ThemedText>
              </View>
              <TouchableOpacity
                onPress={() => remove(index)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove traded pick ${draftYearLabel(p.season)} round ${p.round}`}
                style={styles.removeBtn}
              >
                <Ionicons name="close-circle" size={ms(20)} color={c.secondaryText} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <BrandButton
        label="Add Traded Pick"
        onPress={openAdd}
        variant="secondary"
        size="default"
        icon="add"
        fullWidth
        accessibilityLabel="Add a traded draft pick"
        style={styles.addBtn}
      />

      <BottomSheet
        visible={adding}
        onClose={() => setAdding(false)}
        title="Traded Pick"
        footer={
          <BrandButton
            label="Add Pick"
            onPress={save}
            variant="primary"
            size="default"
            fullWidth
            disabled={!canSave}
            accessibilityLabel="Save traded pick"
          />
        }
      >
        <FieldGroup label="Season">
          <PillRow
            options={seasons.map(season => ({ key: season, label: draftYearLabel(season) }))}
            selectedKey={draft.season}
            onSelect={season => setDraft(d => ({ ...d, season }))}
            c={c}
          />
        </FieldGroup>

        <FieldGroup label="Round">
          <PillRow
            options={roundOptions.map(r => ({ key: String(r), label: `R${r}` }))}
            selectedKey={draft.round != null ? String(draft.round) : undefined}
            onSelect={key => setDraft(d => ({ ...d, round: Number(key) }))}
            c={c}
          />
        </FieldGroup>

        <FieldGroup label="New Owner" helperText="Who owns it now?">
          <TeamPicker
            teams={teams}
            selectedKey={draft.toKey}
            disabledKey={draft.fromKey}
            onSelect={toKey => setDraft(d => ({ ...d, toKey }))}
            c={c}
          />
        </FieldGroup>

        <FieldGroup label="Original Team" helperText="Whose pick is it originally?">
          <TeamPicker
            teams={teams}
            selectedKey={draft.fromKey}
            disabledKey={draft.toKey}
            onSelect={fromKey => setDraft(d => ({ ...d, fromKey }))}
            c={c}
          />
        </FieldGroup>

        {isCompleteTradedPick(draft) && isDuplicateTradedPick(value, draft) && (
          <ThemedText style={[styles.dupWarn, { color: c.danger }]}>
            That pick has already been added.
          </ThemedText>
        )}
      </BottomSheet>
    </FormSection>
  );
}

// ─── Internal pickers ───────────────────────────────────────────────

type Palette = (typeof Colors)['light'];

function PillRow({
  options,
  selectedKey,
  onSelect,
  c,
}: {
  options: { key: string; label: string }[];
  selectedKey: string | undefined;
  onSelect: (key: string) => void;
  c: Palette;
}) {
  return (
    <View style={styles.pillRow}>
      {options.map(o => {
        const selected = o.key === selectedKey;
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => onSelect(o.key)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={o.label}
            style={[
              styles.pill,
              { borderColor: c.border },
              selected && { backgroundColor: c.primary, borderColor: c.primary },
            ]}
          >
            <ThemedText style={[styles.pillText, { color: selected ? c.background : c.text }]}>
              {o.label}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function TeamPicker({
  teams,
  selectedKey,
  disabledKey,
  onSelect,
  c,
}: {
  teams: ImportTeamRef[];
  selectedKey: string | undefined;
  disabledKey: string | undefined;
  onSelect: (key: string) => void;
  c: Palette;
}) {
  return (
    <View style={[styles.teamList, { borderColor: c.border }]}>
      {teams.map((t, index) => {
        const selected = t.key === selectedKey;
        const disabled = t.key === disabledKey;
        return (
          <TouchableOpacity
            key={t.key}
            onPress={() => onSelect(t.key)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={t.name}
            style={[
              styles.teamRow,
              index < teams.length - 1 && { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth },
              disabled && styles.teamRowDisabled,
            ]}
          >
            <ThemedText style={[styles.teamRowText, { color: c.text }]} numberOfLines={1}>
              {t.name}
            </ThemedText>
            {selected && <Ionicons name="checkmark" size={ms(18)} color={c.primary} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontSize: ms(13),
    lineHeight: ms(18),
    marginBottom: s(10),
  },
  empty: {
    fontSize: ms(13),
    fontStyle: 'italic',
    marginBottom: s(10),
  },
  list: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: s(10),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(12),
    gap: s(10),
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  rowSub: {
    fontSize: ms(13),
    marginTop: s(2),
  },
  removeBtn: {
    padding: s(2),
  },
  addBtn: {
    marginTop: s(2),
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: s(7),
    paddingHorizontal: s(14),
  },
  pillText: {
    fontSize: ms(13),
    fontWeight: '600',
  },
  teamList: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    gap: s(8),
  },
  teamRowDisabled: {
    opacity: 0.35,
  },
  teamRowText: {
    flex: 1,
    fontSize: ms(14),
  },
  dupWarn: {
    fontSize: ms(13),
    marginTop: s(8),
  },
});
