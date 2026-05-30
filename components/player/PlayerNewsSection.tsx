import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { NewsCard } from "@/components/player/NewsCard";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { Section } from "@/components/ui/Section";
import { ThemedText } from "@/components/ui/ThemedText";
import { useColors } from "@/hooks/useColors";
import type { PlayerNewsArticle } from "@/types/news";
import { ms, s } from "@/utils/scale";

interface PlayerNewsSectionProps {
  news: PlayerNewsArticle[] | undefined;
  isLoading: boolean;
}

const MAX_NEWS = 10;

/**
 * News block for the player detail sheet — shows the single most recent item,
 * with a "More news (N)" button that expands the rest inline (no extra swipe
 * gesture). Renders nothing when the player has no news.
 */
export function PlayerNewsSection({ news, isLoading }: PlayerNewsSectionProps) {
  const c = useColors();
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <Section noCard title="NEWS">
        <View style={styles.loader}>
          <LogoSpinner />
        </View>
      </Section>
    );
  }

  const items = (news ?? []).slice(0, MAX_NEWS);
  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, 1);
  const remaining = items.length - 1;

  return (
    <Section noCard title="NEWS">
      <View style={styles.list}>
        {visible.map((article) => (
          <NewsCard key={article.id} article={article} />
        ))}
      </View>
      {!expanded && remaining > 0 && (
        <Pressable
          onPress={() => setExpanded(true)}
          style={styles.moreBtn}
          accessibilityRole="button"
          accessibilityLabel={`Show ${remaining} more news ${remaining === 1 ? "item" : "items"}`}
        >
          <ThemedText type="varsity" style={[styles.moreText, { color: c.accent }]}>
            More News ({remaining})
          </ThemedText>
          <Ionicons name="chevron-down" size={ms(14)} color={c.accent} />
        </Pressable>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  loader: {
    paddingVertical: s(16),
    alignItems: "center",
  },
  list: {
    gap: s(10),
  },
  moreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: s(4),
    paddingVertical: s(10),
    marginTop: s(4),
  },
  moreText: {
    fontSize: ms(11),
    letterSpacing: 0.8,
  },
});
