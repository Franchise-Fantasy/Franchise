import Purchases, {
  LOG_LEVEL,
  PurchasesOffering,
  PurchasesPackage,
} from "react-native-purchases";
import { Platform } from "react-native";

const API_KEY_IOS = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";
const API_KEY_ANDROID = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "";

let isConfigured = false;

export function isReady(): boolean {
  return isConfigured;
}

/**
 * Initialize RevenueCat SDK. Call once on app startup after auth is ready.
 * Pass the Supabase user ID so RevenueCat ties purchases to your user.
 * Fails silently if RevenueCat isn't set up yet (no app configured in dashboard).
 */
export async function initPurchases(userId: string): Promise<void> {
  try {
    if (isConfigured) {
      await Purchases.logIn(userId);
      return;
    }

    const apiKey = Platform.OS === "ios" ? API_KEY_IOS : API_KEY_ANDROID;
    if (!apiKey) return;

    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    }

    await Purchases.configure({ apiKey, appUserID: userId });
    isConfigured = true;
  } catch (e) {
    console.warn("RevenueCat init skipped:", e);
  }
}

/** Fetch all available subscription offerings from RevenueCat. */
export async function getOfferings(): Promise<PurchasesOffering | null> {
  if (!isConfigured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? null;
  } catch (e: any) {
    console.warn("RevenueCat getOfferings failed:", e?.message, e?.code, e?.underlyingErrorMessage);
    return null;
  }
}

/** Trigger the native Apple/Google payment sheet for a package. */
export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<boolean> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  const activeEntitlements = Object.keys(
    customerInfo.entitlements.active,
  );
  return activeEntitlements.length > 0;
}

/** Restore purchases after reinstall or device switch. */
export async function restorePurchases(): Promise<boolean> {
  if (!isConfigured) return false;
  try {
    const customerInfo = await Purchases.restorePurchases();
    const activeEntitlements = Object.keys(
      customerInfo.entitlements.active,
    );
    return activeEntitlements.length > 0;
  } catch (e) {
    console.warn("RevenueCat restore failed:", e);
    return false;
  }
}

/** Reset RevenueCat identity on sign-out. */
export async function logoutPurchases(): Promise<void> {
  if (!isConfigured) return;
  try {
    await Purchases.logOut();
  } catch (e) {
    console.warn("RevenueCat logout failed:", e);
  }
}
