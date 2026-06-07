/**
 * Full-screen blocking busy state for slow, one-shot actions (e.g. the
 * offseason commissioner edge functions). A lone top-level Modal — only shown
 * once any inline confirm/picker has already dismissed — so it never stacks on
 * another Modal (see the InlineConfirm note on Modal stacking). Unmissable, and
 * the scrim blocks a second tap while the action is in flight.
 *
 * Wraps the shared BrandDialogCard (gold top rule + Alfa Slab title) so the
 * loader matches the app's other dialogs instead of being a generic card.
 */
import { Modal, StyleSheet, View } from 'react-native';

import { BrandDialogCard } from '@/components/ui/BrandDialogCard';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { s } from '@/utils/scale';

interface Props {
  visible: boolean;
  title: string;
  subtitle?: string;
}

export function BusyOverlay({ visible, title, subtitle }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.scrim} accessibilityViewIsModal accessibilityLabel={title}>
        <BrandDialogCard title={title} message={subtitle}>
          <View style={styles.spinnerWrap}>
            <LogoSpinner size={32} />
          </View>
        </BrandDialogCard>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20, 16, 16, 0.55)', // Brand.ink @ 55%, matches InlineConfirm
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(24),
  },
  spinnerWrap: {
    alignItems: 'center',
    paddingTop: s(6),
    paddingBottom: s(2),
  },
});
