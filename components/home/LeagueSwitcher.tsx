import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { supabase } from "@/lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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
import { GestureHandlerRootView } from "react-native-gesture-handler";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import type { SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";

interface UserLeague {
  teamId: string;
  leagueId: string;
  leagueName: string;
  teamName: string;
}

interface LeagueSwitcherProps {
  visible: boolean;
  onClose: () => void;
}

export function LeagueSwitcher({ visible, onClose }: LeagueSwitcherProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const session = useSession();
  const { leagueId, setLeagueId, setTeamId } = useAppState();
  const queryClient = useQueryClient();
  const router = useRouter();

  const [leagues, setLeagues] = useState<UserLeague[]>([]);
  const [loading, setLoading] = useState(true);
  const [favoriteLeagueId, setFavoriteLeagueId] = useState<string | null>(null);
  const swipeableRefs = useRef<Map<string, React.RefObject<SwipeableMethods | null>>>(new Map());

  const getSwipeableRef = (leagueId: string) => {
    if (!swipeableRefs.current.has(leagueId)) {
      swipeableRefs.current.set(leagueId, React.createRef<SwipeableMethods | null>());
    }
    return swipeableRefs.current.get(leagueId)!;
  };

  useEffect(() => {
    if (!visible || !session?.user) return;

    const fetchData = async () => {
      setLoading(true);
      const [{ data: teamsData, error }, { data: profileData }] =
        await Promise.all([
          supabase
            .from("teams")
            .select("id, name, league_id, leagues(id, name)")
            .eq("user_id", session.user.id),
          supabase
            .from("profiles")
            .select("favorite_league_id")
            .eq("id", session.user.id)
            .maybeSingle(),
        ]);

      if (error) {
        console.error("Failed to fetch leagues:", error);
        setLoading(false);
        return;
      }

      const mapped: UserLeague[] = (teamsData ?? []).map((team: any) => ({
        teamId: team.id,
        leagueId: team.league_id,
        leagueName: team.leagues?.name ?? "Unknown League",
        teamName: team.name,
      }));

      setLeagues(mapped);
      setFavoriteLeagueId(profileData?.favorite_league_id ?? null);
      setLoading(false);
    };

    fetchData();
  }, [visible, session?.user?.id]);

  const handleSelect = (league: UserLeague) => {
    setLeagueId(league.leagueId);
    setTeamId(league.teamId);
    queryClient.invalidateQueries({ queryKey: ["league"] });
    onClose();
  };

  const handleToggleFavorite = async (league: UserLeague) => {
    if (!session?.user) return;
    const newFavoriteId =
      league.leagueId === favoriteLeagueId ? null : league.leagueId;
    setFavoriteLeagueId(newFavoriteId); // optimistic
    swipeableRefs.current.get(league.leagueId)?.current?.close();
    await supabase
      .from("profiles")
      .update({ favorite_league_id: newFavoriteId })
      .eq("id", session.user.id);
  };

  const handleCreateNew = () => {
    onClose();
    router.push("/create-league");
  };

  const handleJoin = () => {
    onClose();
    router.push("/join-league");
  };

  const renderRightAction = (league: UserLeague) => {
    const isFav = league.leagueId === favoriteLeagueId;
    return (
      <TouchableOpacity
        style={[
          styles.starAction,
          { backgroundColor: isFav ? c.border : "#F5A623" },
        ]}
        onPress={() => handleToggleFavorite(league)}
        activeOpacity={0.8}
      >
        <Ionicons
          name={isFav ? "star" : "star-outline"}
          size={22}
          color={isFav ? c.secondaryText : "#fff"}
        />
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable
            style={[
              styles.dropdown,
              { backgroundColor: c.background, borderColor: c.border },
            ]}
            onPress={(e) => e.stopPropagation()}
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
                    <ReanimatedSwipeable
                      key={league.teamId}
                      ref={getSwipeableRef(league.leagueId)}
                      renderRightActions={() => renderRightAction(league)}
                      friction={2}
                      rightThreshold={40}
                    >
                      <TouchableOpacity
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
                          {isFav && (
                            <Ionicons name="star" size={16} color="#F5A623" />
                          )}
                          {isActive && (
                            <Ionicons
                              name="checkmark-circle"
                              size={20}
                              color={c.activeText}
                            />
                          )}
                        </View>
                      </TouchableOpacity>
                    </ReanimatedSwipeable>
                  );
                })}
              </ScrollView>
            )}

            <View style={[styles.divider, { backgroundColor: c.border }]} />

            <TouchableOpacity
              style={styles.actionRow}
              onPress={handleCreateNew}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={18} color={c.accent} />
              <Text style={[styles.actionText, { color: c.accent }]}>
                Create New League
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionRow}
              onPress={handleJoin}
              activeOpacity={0.7}
            >
              <Ionicons name="people-outline" size={18} color={c.accent} />
              <Text style={[styles.actionText, { color: c.accent }]}>
                Join a League
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  dropdown: {
    marginTop: 100,
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  loader: {
    paddingVertical: 16,
  },
  emptyText: {
    textAlign: "center",
    paddingVertical: 16,
    fontSize: 15,
  },
  leagueList: {
    maxHeight: 300,
  },
  leagueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  leagueInfo: {
    flex: 1,
  },
  teamName: {
    fontSize: 13,
    marginTop: 1,
  },
  rowIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  starAction: {
    justifyContent: "center",
    alignItems: "center",
    width: 60,
    borderRadius: 10,
    marginVertical: 2,
    marginRight: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 4,
    marginVertical: 4,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  actionText: {
    fontSize: 15,
    fontWeight: "600",
  },
});
