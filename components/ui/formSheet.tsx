import React, { createContext, useContext } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';

/**
 * True when the enclosing FormSection is rendering the desktop-web "charter
 * sheet" — a ruled document rather than a stack of cards. Field primitives read
 * this to switch from the phone's stacked label-over-control layout to a
 * gutter row. Always false on native, so phone layout is untouched.
 */
const FormSheetContext = createContext(false);

export const FormSheetProvider = FormSheetContext.Provider;

export function useFormSheet(): boolean {
  return useContext(FormSheetContext);
}

/** Width of the label gutter. Wide enough for two lines of tracked varsity caps. */
export const SHEET_GUTTER = 150;

interface SheetRowProps {
  label: string;
  /** Muted explainer under the control — the consequence of the choice. */
  helper?: string;
  /** Drops the bottom rule. Use on the final row of a sheet. */
  last?: boolean;
  children: React.ReactNode;
}

/**
 * One ruled row of the charter sheet: varsity label in a left gutter, the
 * control in a value column, hairline rule beneath.
 *
 * The gutter is the web-first move. A 390px phone has no room for it, which is
 * exactly why the native layout stacks label above control and wraps everything
 * in a card. On a desktop the gutter buys back all that vertical space and lets
 * the eye scan labels down a single edge — the way a settings form reads on the
 * web, and the way a printed league charter reads on paper.
 */
export function SheetRow({ label, helper, last, children }: SheetRowProps) {
  const c = useColors();

  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
      ]}
    >
      <View style={styles.gutter}>
        <ThemedText type="varsitySmall" style={[styles.label, { color: c.secondaryText }]}>
          {label}
        </ThemedText>
      </View>
      <View style={styles.control}>
        {children}
        {helper ? (
          <ThemedText style={[styles.helper, { color: c.secondaryText }]}>{helper}</ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // The rule between rows is a hairline at ~12% opacity, which carries far less
  // weight on a wide sheet than the phone's card borders do. Vertical air is
  // what actually separates these rows on a monitor — keep it generous.
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 24,
    paddingVertical: 16,
  },
  // paddingTop nudges the label's cap-height onto the control's first baseline.
  gutter: { width: SHEET_GUTTER, paddingTop: 10 },
  // Tracked varsity caps in muted ink: at 11px the tracking was fighting
  // legibility rather than helping it, so the size went up and tracking down.
  label: { fontSize: 12, letterSpacing: 0.9, lineHeight: 16 },
  control: { flex: 1, minWidth: 0, gap: 8, alignItems: 'flex-start' },
  helper: { fontSize: 12.5, lineHeight: 18 },
});
