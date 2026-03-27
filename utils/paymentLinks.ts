import { Alert, Linking } from 'react-native';

interface VenmoParams {
  amount?: number;
  note?: string;
}

export function buildVenmoUrl(
  username: string,
  params?: VenmoParams,
): { native: string; web: string } {
  const rawNote = params?.note ?? '';
  const amount = params?.amount ?? '';
  return {
    native: `venmo://paycharge?txn=pay&recipients=${username}&amount=${amount}&note=${rawNote}`,
    web: `https://venmo.com/${username}?txn=pay&amount=${amount}&note=${encodeURIComponent(rawNote)}`,
  };
}

export function buildPayPalUrl(username: string, amount?: number): string {
  const base = `https://paypal.me/${username}`;
  return amount ? `${base}/${amount}` : base;
}

export function buildCashAppUrl(cashtag: string): string {
  return `https://cash.app/$${cashtag}`;
}

/** Try native URL scheme, fall back to web URL */
async function openWithFallback(url: string, webFallback?: string): Promise<void> {
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
    } else if (webFallback) {
      await Linking.openURL(webFallback);
    } else {
      Alert.alert('Cannot Open', 'The payment app does not appear to be installed.');
    }
  } catch {
    if (webFallback) {
      await Linking.openURL(webFallback);
    } else {
      Alert.alert('Error', 'Could not open the payment app.');
    }
  }
}

/** Show confirmation, then open the payment app */
export function openPaymentConfirmed(
  method: 'venmo' | 'paypal' | 'cashapp',
  handle: string,
  opts?: { amount?: number; note?: string },
): void {
  const displayHandle =
    method === 'venmo' ? `@${handle}` : method === 'cashapp' ? `$${handle}` : handle;
  const amountStr = opts?.amount ? `$${opts.amount}` : '';
  const title = `Pay via ${method === 'venmo' ? 'Venmo' : method === 'paypal' ? 'PayPal' : 'Cash App'}?`;
  const message = amountStr
    ? `You'll be paying ${displayHandle} ${amountStr}.`
    : `You'll be paying ${displayHandle}.`;

  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Continue',
      onPress: () => {
        if (method === 'venmo') {
          const urls = buildVenmoUrl(handle, { amount: opts?.amount, note: opts?.note });
          openWithFallback(urls.native, urls.web);
        } else if (method === 'paypal') {
          openWithFallback(buildPayPalUrl(handle, opts?.amount));
        } else {
          openWithFallback(buildCashAppUrl(handle));
        }
      },
    },
  ]);
}

/** Strip leading @/$ and non-alphanumeric chars (except - and _) */
export function sanitizeHandle(raw: string): string {
  return raw.replace(/^[@$]+/, '').replace(/[^a-zA-Z0-9_-]/g, '');
}
