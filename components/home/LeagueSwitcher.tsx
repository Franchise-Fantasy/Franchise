import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { queryKeys } from "@/constants/queryKeys";
import { LEAGUE_TYPE_DISPLAY } from "@/constants/LeagueDefaults";
import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { ms, s } from '@/utils/scale';

interface UserLeague {
  teamId: string;
  leagueId: string;
  leagueName: string;
  teamName: string;
  leagueType: string;
}

interface LeagueSwitcherProps {
  visible: boolean;
  onClose: () => void;
}

export function LeagueSwitcher({ visible, onClose }: LeagueSwitcherProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const session = useSession();
  const { leagueId, switchLeague } = useAppState();
  const queryClient = useQueryClient();
  const router = useRouter();

  const userId = session?.user?.id;

  const { data, isLoading: loading } = useQuery({
    queryKey: queryKeys.userLeagues(userId!),
    queryFn: async () => {
      const [{ data: teamsData, error }, { data: profileData }] =
        await Promise.all([
          supabase
            .from("teams")
            .select("id, name, league_id, leagues!teams_league_id_fkey(id, name, league_type)")
            .eq("user_id", userId!),
          supabase
            .from("profiles")
            .select("favorite_league_id")
            .eq("id", userId!)
            .maybeSingle(),
        ]);

      if (error) throw error;

      const leagues: UserLeague[] = (teamsData ?? []).map((team: any) => ({
        teamId: team.id,
        leagueId: team.league_id,
        leagueName: team.leagues?.name ?? "Unknown League",
        teamName: team.name,
        leagueType: team.leagues?.league_type ?? "redraft",
      }));

      return { leagues, favoriteLeagueId: profileData?.favorite_league_id ?? null };
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const leagues = data?.leagues ?? [];
  const favoriteLeagueId = data?.favoriteLeagueId ?? null;

  const handleSelect = (league: UserLeague) => {
    switchLeague(league.leagueId, league.teamId);
    // Clear all league-specific cached data so stale data from the previous
    // league never appears. User-level queries are preserved.
    queryClient.removeQueries({
      predicate: (q) => {
        const key = q.queryKey[0];
        return key !== 'user-leagues' && key !== 'userProfile';
      },
    });
    onClose();
  };

  const handleToggleFavorite = async (league: UserLeague) => {
    if (!userId) return;
    const newFavoriteId =
      league.leagueId === favoriteLeagueId ? null : league.leagueId;
    // Optimistic update
    queryClient.setQueryData(queryKeys.userLeagues(userId!), (old: typeof data) =>
      old ? { ...old, favoriteLeagueId: newFavoriteId } : old
    );
    await supabase
      .from("profiles")
      .update({ favorite_league_id: newFavoriteId })
      .eq("id", userId);
  };

  const handleCreateNew = () => {
    onClose();
    router.push("/create-league");
  };

  const handleJoin = () => {
    onClose();
    router.push("/join-league");
  };

  const handleImport = () => {
    onClose();
    router.push("/import-league");
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close league switcher">
        <Pressable
          style={[
            styles.dropdown,
            { backgroundColor: c.background, borderColor: c.border },
          ]}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="menu"
        >
          {loading ? (
            <ActivityIndicator style={styles.loader} />
          ) : leagues.length === 0 ? (
            <ThemedText
              style={[styles.emptyText, { color: c.secondaryText }]}
            >
              No leagues yet.
            </ThemedText>
          ) : (
            <ScrollView
              style={styles.leagueList}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {leagues.map((league) => {
                const isActive = league.leagueId === leagueId;
                const isFav = league.leagueId === favoriteLeagueId;
                return (
                  <TouchableOpacity
                    key={league.teamId}
                    style={[
                      styles.leagueRow,
                      {
                        backgroundColor: isActive
                          ? c.activeCard
                          : c.background,
                      },
                    ]}
                    onPress={() => handleSelect(league)}
                    activeOpacity={0.7}
                    accessibilityRole="menuitem"
                    accessibilityLabel={`${league.leagueName}, ${league.teamName}${isActive ? ', currently selected' : ''}`}
                  >
                    <View style={styles.leagueInfo}>
                      <ThemedText
                        type="defaultSemiBold"
                        style={isActive ? { color: c.activeText } : undefined}
                      >
                        {league.leagueName}
                      </ThemedText>
                      <ThemedText
                        style={[styles.teamName, { color: c.secondaryText }]}
                      >
                        {league.teamName}
                      </ThemedText>
                    </View>
                    <View style={styles.rowIcons}>
                      <Ionicons
                        name="checkmark-circle"
                        size={20}
                        color={isActive ? c.activeText : "transparent"}
                        accessibilityElementsHidden={!isActive}
                      />
                      <View
                        style={[
                          styles.typeBadge,
                          { backgroundColor: c.border },
                        ]}
                        accessibilityLabel={`${LEAGUE_TYPE_DISPLAY[league.leagueType] ?? 'Redraft'} league`}
                      >
                        <Text style={[styles.typeBadgeText, { color: c.secondaryText }]}>
                          {LEAGUE_TYPE_DISPLAY[league.leagueType] ?? 'Redraft'}
                        </Text>
                      </View>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          handleToggleFavorite(league);
                        }}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`${isFav ? 'Remove' : 'Set'} ${league.leagueName} as favorite`}
                      >
                        <Ionicons
                          name={isFav ? "star" : "star-outline"}
                          size={18}
                          color={isFav ? "#F5A623" : c.secondaryText}
                        />
                      </Pressable>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          <View style={[styles.divider, { backgroundColor: c.border }]} />

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleCreateNew}
            activeOpacity={0.7}
            accessibilityRole="menuitem"
            accessibilityLabel="Create new league"
          >
            <Ionicons name="add-circle-outline" size={18} color={c.accent} accessible={false} />
            <Text style={[styles.actionText, { color: c.accent }]}>
              Create New League
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleJoin}
            activeOpacity={0.7}
            accessibilityRole="menuitem"
            accessibilityLabel="Join a league"
          >
            <Ionicons name="people-outline" size={18} color={c.accent} accessible={false} />
            <Text style={[styles.actionText, { color: c.accent }]}>
              Join a League
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleImport}
            activeOpacity={0.7}
            accessibilityRole="menuitem"
            accessibilityLabel="Import league"
          >
            <Ionicons name="download-outline" size={18} color={c.accent} accessible={false} />
            <Text style={[styles.actionText, { color: c.accent }]}>
              Import League
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  dropdown: {
    marginTop: s(100),
    marginHorizontal: s(16),
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: s(8),
    paddingHorizontal: s(12),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  loader: {
    paddingVertical: s(16),
  },
  emptyText: {
    textAlign: "center",
    paddingVertical: s(16),
    fontSize: ms(15),
  },
  leagueList: {
    maxHeight: s(300),
  },
  leagueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: s(12),
    paddingHorizontal: s(12),
    borderRadius: 10,
  },
  leagueInfo: {
    flex: 1,
  },
  teamName: {
    fontSize: ms(13),
    marginTop: 1,
  },
  typeBadge: {
    paddingHorizontal: s(6),
    paddingVertical: 1,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: ms(11),
    fontWeight: "600",
  },
  rowIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: s(4),
    marginVertical: s(4),
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
    paddingVertical: s(10),
    paddingHorizontal: s(12),
  },
  actionText: {
    fontSize: ms(15),
    fontWeight: "600",
  },
});
