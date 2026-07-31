import { StyleSheet } from 'react-native';

import { ms, s } from '@/utils/scale';

// Extracted from ProposeTradeModal per the big-file decomposition pattern.
export const styles = StyleSheet.create({
  page: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(10),
  },
  headerClose: { padding: s(2) },
  headerCenter: {
    flex: 1,
    gap: s(2),
  },
  headerEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  headerEyebrowRule: { height: 2, width: s(14) },
  headerEyebrow: {
    fontSize: ms(9),
    letterSpacing: 1.4,
  },
  headerTitle: {
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.3,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: s(10),
  },
  footerSubmitWrap: { flex: 1 },
});
