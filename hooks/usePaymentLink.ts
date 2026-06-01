import { useCallback } from 'react';

import { useConfirm } from '@/context/ConfirmProvider';
import {
  openPayment,
  paymentConfirmCopy,
  type PaymentMethod,
} from '@/utils/league/paymentLinks';

/**
 * Brand-chromed replacement for the old native `Alert.alert` payment confirm.
 * Returns a `payWithConfirm(method, handle, opts)` that shows the in-app
 * confirm dialog (via `DialogHost`) and only then opens the payment app —
 * so the whole flow stays inside our chrome instead of an iOS-native popup.
 */
export function usePaymentLink() {
  const confirm = useConfirm();

  return useCallback(
    (method: PaymentMethod, handle: string, opts?: { amount?: number; note?: string }) => {
      const { title, message } = paymentConfirmCopy(method, handle, opts);
      confirm({
        title,
        message,
        action: {
          label: 'Continue',
          onPress: async () => {
            const result = await openPayment(method, handle, opts);
            if (result.ok) return;
            confirm({
              title: result.reason === 'not-installed' ? 'Cannot Open' : 'Error',
              message:
                result.reason === 'not-installed'
                  ? 'The payment app does not appear to be installed.'
                  : 'Could not open the payment app.',
              action: { label: 'OK', onPress: () => {} },
            });
          },
        },
      });
    },
    [confirm],
  );
}
