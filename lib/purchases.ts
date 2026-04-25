import { Platform } from "react-native";
import Purchases, {
  LOG_LEVEL,
  PurchasesOffering,
  PurchasesPackage,
} from "react-native-purchases";

import { supabase } from "@/lib/supabase";

const API_KEY_IOS = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? "";
const API_KEY_ANDROID = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? "";

/**
 * Force the server to re-pull the user's subscription state from RevenueCat
 * and upsert our subscription tables. Use this whenever the client suspects
 * the DB row is stale — after Restore, after a Purchase whose webhook didn't
 * land in time, or as a self-heal probe when a user with prior subs lands on
 * the paywall. Returns the reconciled state (null on either side means no
 * active entitlement at RC).
 */
export async function syncSubscriptionFromRC(): Promise<
  | {
      individual: { tier: "pro" | "premium"; expiresAt: string; period: string } | null;
      league: { tier: "pro" | "premium"; expiresAt: string; period: string; leagueId: string } | null;
    }
  | null
> {
  try {
    const { data, error } = await supabase.functions.invoke("sync-subscription", {
      body: {},
    });
    if (error) {
      console.warn("sync-subscription failed:", error.message);
      return null;
    }
    return {
      individual: data?.individual ?? null,
      league: data?.league ?? null,
    };
  } catch (e) {
    console.warn("sync-subscription threw:", e);
    return null;
  }
}

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

/**
 * Restore purchases after reinstall or device switch.
 * Always follows up with a server-side sync so the DB reflects whatever RC
 * returns — even if RC didn't fire a fresh webhook (which it won't if it
 * already considers the subscription delivered).
 */
export async function restorePurchases(): Promise<boolean> {
  if (!isConfigured) return false;
  try {
    const customerInfo = await Purchases.restorePurchases();
    const hasActive = Object.keys(customerInfo.entitlements.active).length > 0;
    await syncSubscriptionFromRC();
    return hasActive;
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
