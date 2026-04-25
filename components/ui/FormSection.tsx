import { ReactNode } from 'react';
import { StyleSheet } from 'react-native';

import { s } from '@/utils/scale';

import { Section } from './Section';

interface FormSectionProps {
  title?: string;
  children: ReactNode;
}

/**
 * Thin wrapper over `Section` for wizard-form field groups. Keeps the
 * legacy `{ title, children }` API while inheriting Section's gold-rule
 * label + varsity-anchored typography, so the ~20 wizard call sites
 * don't need to be edited one-by-one.
 *
 * Wizard cards are denser than data-screen cards (many fields stacked),
 * so we trim the vertical padding on the inner card from the Section
 * default. Surface matches the app's standard `c.card` (the same
 * near-white/dark-card tone used on data screens).
 */
export function FormSection({ title, children }: FormSectionProps) {
  return (
    <Section
      title={title ?? ''}
      noLabel={!title}
      cardStyle={styles.formCard}
    >
      {children}
    </Section>
  );
}

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
