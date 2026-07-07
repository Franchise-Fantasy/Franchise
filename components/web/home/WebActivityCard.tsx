import { useRouter } from "expo-router";
import { useMemo } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";

import { TransactionCard } from "@/components/activity/TransactionCard";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import { mergeTransactionGroups, useTransactions } from "@/hooks/useTransactions";

const PREVIEW_COUNT = 5;

/**
 * Desktop web "Recent Activity" feed — the most recent league transactions
 * (adds/drops/trades/waivers), reusing the same TransactionCard the mobile
 * activity screen renders and the same useTransactions query. A compact
 * preview with a "View all" link into the full activity page. Web-only.
 */
export function WebActivityCard() {
  const c = useColors();
  const router = useRouter();
  const { data, isLoading } = useTransactions();

  const txns = useMemo(
    () => mergeTransactionGroups((data?.pages ?? []).flat()).slice(0, PREVIEW_COUNT),
    [data],
  );

  // Nothing has happened in this league yet — don't render an empty card.
  if (!isLoading && txns.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <View style={[styles.rule, { backgroundColor: c.gold }]} />
          <ThemedText type="sectionLabel" style={{ color: c.text }}>
            Recent Activity
          </ThemedText>
        </View>
        <TouchableOpacity
          onPress={() => router.push("/activity" as never)}
          accessibilityRole="link"
          accessibilityLabel="View all league activity"
        >
          <ThemedText type="varsitySmall" style={{ color: c.accent }}>
            View all →
          </ThemedText>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loading}>
          <LogoSpinner />
        </View>
      ) : (
        <View style={styles.list}>
          {txns.map((txn) => (
            <TransactionCard key={txn.id} txn={txn} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 18,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rule: {
    height: 2,
    width: 18,
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
  list: {
    gap: 10,
  },
});
