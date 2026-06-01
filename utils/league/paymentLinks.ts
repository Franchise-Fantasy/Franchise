import { Linking } from 'react-native';

export type PaymentMethod = 'venmo' | 'paypal' | 'cashapp';

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

export interface OpenPaymentResult {
  ok: boolean;
  /** Why the open failed. `not-installed` = no app and no web fallback. */
  reason?: 'not-installed' | 'error';
}

/** Try native URL scheme, fall back to web URL. Never shows UI itself. */
async function openWithFallback(url: string, webFallback?: string): Promise<OpenPaymentResult> {
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
      return { ok: true };
    }
    if (webFallback) {
      await Linking.openURL(webFallback);
      return { ok: true };
    }
    return { ok: false, reason: 'not-installed' };
  } catch {
    if (webFallback) {
      try {
        await Linking.openURL(webFallback);
        return { ok: true };
      } catch {
        return { ok: false, reason: 'error' };
      }
    }
    return { ok: false, reason: 'error' };
  }
}

/**
 * Open the payment app/web URL for a method. Pure side-effect — no confirm,
 * no UI. Callers show the branded confirm via `usePaymentLink()` first.
 */
export function openPayment(
  method: PaymentMethod,
  handle: string,
  opts?: { amount?: number; note?: string },
): Promise<OpenPaymentResult> {
  if (method === 'venmo') {
    const urls = buildVenmoUrl(handle, { amount: opts?.amount, note: opts?.note });
    return openWithFallback(urls.native, urls.web);
  }
  if (method === 'paypal') {
    return openWithFallback(buildPayPalUrl(handle, opts?.amount));
  }
  return openWithFallback(buildCashAppUrl(handle));
}

/** Title + message for the "are you sure you want to pay" confirm. */
export function paymentConfirmCopy(
  method: PaymentMethod,
  handle: string,
  opts?: { amount?: number },
): { title: string; message: string } {
  const displayHandle =
    method === 'venmo' ? `@${handle}` : method === 'cashapp' ? `$${handle}` : handle;
  const appName = method === 'venmo' ? 'Venmo' : method === 'paypal' ? 'PayPal' : 'Cash App';
  const amountStr = opts?.amount ? `$${opts.amount}` : '';
  return {
    title: `Pay via ${appName}?`,
    message: amountStr
      ? `You'll be paying ${displayHandle} ${amountStr}.`
      : `You'll be paying ${displayHandle}.`,
  };
}

/** Strip leading @/$ and non-alphanumeric chars (except - and _) */
export function sanitizeHandle(raw: string): string {
  return raw.replace(/^[@$]+/, '').replace(/[^a-zA-Z0-9_-]/g, '');
}
