import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useColors } from '@/hooks/useColors';
import { s } from '@/utils/scale';

import { FormSheetProvider } from './formSheet';
import { Section } from './Section';
import { ThemedText } from './ThemedText';

interface FormSectionProps {
  title?: string;
  children: ReactNode;
}

/**
 * Wizard-form field group. Two renderings from one API:
 *
 * **Native / phone** — `Section`'s gold-rule label over a bordered card, with
 * fields stacked label-above-control. Unchanged.
 *
 * **Desktop web** — the charter sheet: no card at all, just a section head (gold
 * tick, varsity label, a rule running out to the edge) over ruled field rows.
 * Floating rounded cards are a grouped-table-view idiom straight off iOS and are
 * the loudest "this is a phone app" tell on a monitor; a ruled sheet is how a
 * settings form reads on the web — and how a league charter reads on paper.
 * Fields switch themselves to gutter rows via `useFormSheet()`.
 */
export function FormSection({ title, children }: FormSectionProps) {
  const { isDesktop } = useBreakpoint();
  const c = useColors();

  if (isDesktop) {
    return (
      <View style={sheet.section}>
        {title ? (
          <View style={sheet.head}>
            <View style={[sheet.tick, { backgroundColor: c.gold }]} />
            <ThemedText
              type="varsity"
              style={[sheet.headLabel, { color: c.text }]}
              accessibilityRole="header"
            >
              {title}
            </ThemedText>
            <View style={[sheet.headRule, { backgroundColor: c.border }]} />
          </View>
        ) : null}
        <FormSheetProvider value>{children}</FormSheetProvider>
      </View>
    );
  }

  return (
    <Section title={title ?? ''} noLabel={!title} cardStyle={styles.formCard}>
      {children}
    </Section>
  );
}

// With no card to draw the boundary, a section is grouped by exactly two
// things: the head above it and the gap before the next head. Both have to be
// unambiguous — the gap between sections must clearly beat the gap between the
// rows inside one, or the whole sheet reads as a single undifferentiated list.
const sheet = StyleSheet.create({
  section: { marginBottom: 44 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  tick: { height: 3, width: 22 },
  headLabel: { fontSize: 15.5, letterSpacing: 1 },
  headRule: { flex: 1, height: StyleSheet.hairlineWidth },
});

const styles = StyleSheet.create({
  formCard: {
    paddingTop: s(12),
    paddingBottom: s(12),
    // Consistent breathing room between successive field groups
    // (text inputs, labelled segmented pickers, number steppers,
    // toggle rows). Field wrappers can drop their own marginTop
    // shims — let the card handle vertical rhythm.
    gap: s(14),
  },
});
