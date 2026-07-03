import { Platform, StyleSheet, Switch, View } from 'react-native';

import { NumberStepper } from '@/components/ui/NumberStepper';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { getLimitablePositions, LimitablePosition, PositionLimits, Sport } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

/** Seed value when a position's limit is first switched on. */
const DEFAULT_POSITION_LIMIT = 5;

interface PositionLimitsEditorProps {
  sport: Sport;
  limits: PositionLimits;
  onChange: (next: PositionLimits) => void;
}

/**
 * Per-position roster-cap rows, shared by the create-league wizard
 * (StepRoster) and the commissioner's EditRosterModal. Each position
 * gets its own switch — off means no limit (the default), on reveals
 * a stepper for the cap. Mirrors the Trade Deadline toggle idiom;
 * replaces the old "0 = no limit" steppers that took five taps to
 * exempt a single position.
 */
export function PositionLimitsEditor({ sport, limits, onChange }: PositionLimitsEditorProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const positions = getLimitablePositions(sport);

  const setLimit = (pos: LimitablePosition, value: number | undefined) => {
    const next: PositionLimits = { ...limits };
    if (value === undefined) {
      delete next[pos];
    } else {
      next[pos] = value;
    }
    onChange(next);
  };

  return (
    <View>
      {positions.map((pos, i) => {
        const limit = limits[pos];
        const enabled = typeof limit === 'number' && limit > 0;
        return (
          <View
            key={pos}
            style={[
              styles.row,
              { borderBottomColor: c.border },
              i === positions.length - 1 && styles.rowLast,
            ]}
          >
            <View style={styles.rowBody}>
              {enabled ? (
                <NumberStepper
                  label={pos}
                  value={limit}
                  onValueChange={(v) => setLimit(pos, v)}
                  min={1}
                  max={15}
                  accessibilityLabel={`${pos} limit`}
                  last
                />
              ) : (
                <View style={styles.offRow}>
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.offLabel, { color: c.secondaryText }]}
                  >
                    {pos}
                  </ThemedText>
                  <ThemedText style={[styles.noLimit, { color: c.secondaryText }]}>
                    No limit
                  </ThemedText>
                </View>
              )}
            </View>
            <Switch
              value={enabled}
              onValueChange={(on) => setLimit(pos, on ? DEFAULT_POSITION_LIMIT : undefined)}
              trackColor={{ false: c.border, true: c.accent }}
              thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
              ios_backgroundColor={c.border}
              accessibilityLabel={`Limit ${pos} players`}
              accessibilityState={{ checked: enabled }}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    paddingVertical: s(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowBody: {
    flex: 1,
  },
  offRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: s(12),
  },
  // Matches NumberStepper's label style so rows don't shift when toggled.
  offLabel: {
    flex: 1,
    fontSize: ms(10),
  },
  noLimit: {
    fontSize: ms(13),
  },
});
