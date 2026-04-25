import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";

import { Badge } from "@/components/ui/Badge";
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { SportBadge } from "@/components/ui/SportBadge";
import { ThemedText } from "@/components/ui/ThemedText";
import { Brand, Colors, cardShadow } from "@/constants/Colors";
import { LEAGUE_TYPE_DISPLAY, SPORT_DISPLAY, type Sport } from "@/constants/LeagueDefaults";
import { queryKeys } from "@/constants/queryKeys";
import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { supabase } from "@/lib/supabase";
import { ms, s } from '@/utils/scale';

interface UserLeague {
  teamId: string;
  leagueId: string;
  leagueName: string;
  teamName: string;
  leagueType: string;
  sport: Sport;
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
            .select("id, name, league_id, leagues!teams_league_id_fkey(id, name, league_type, sport)")
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
        sport: (team.leagues?.sport as Sport) ?? "nba",
      }));

      return { leagues, favoriteLeagueId: profileData?.favorite_league_id ?? null };
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const favoriteLeagueId = data?.favoriteLeagueId ?? null;

  // Pin the favorite league to the top of the list. Everything else
  // keeps its original order (the server returns teams in whatever
  // order Postgres hands them back, which is stable enough for this).
  const leagues = useMemo(() => {
    const raw = data?.leagues ?? [];
    if (!favoriteLeagueId) return raw;
    return [...raw].sort((a, b) => {
      if (a.leagueId === favoriteLeagueId) return -1;
      if (b.leagueId === favoriteLeagueId) return 1;
      return 0;
    });
  }, [data?.leagues, favoriteLeagueId]);

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

  // Route first, then close. Calling onClose() first kicks off the
  // Modal's fade-out animation before navigation fires, which the user
  // perceives as a lag — the dropdown visibly fades before the next
  // screen slides in. Pushing first lets the navigation animation
  // cover the modal's fade, so the transition feels instant.
  const handleCreateNew = () => {
    router.push("/create-league");
    onClose();
  };

  const handleJoin = () => {
    router.push("/join-league");
    onClose();
  };

  const handleImport = () => {
    router.push("/import-league");
    onClose();
  };

  // `c.cardAlt` is the warmer of the two card tones (#F4EFDC in light
  // mode) — sits between the ecru page and the near-white `c.card`, so
  // the dropdown reads as "paper" rather than "paint." Dark mode keeps
  // its existing cardAlt value which handles the equivalent step there.
  const surfaceBg = c.cardAlt;

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
            { backgroundColor: surfaceBg, borderColor: c.border },
          ]}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="menu"
        >
          {/* Header — gold rule + varsity label + close button. Gives
              the dropdown a real identity instead of a floating list. */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={[styles.headerRule, { backgroundColor: c.gold }]} />
              <ThemedText type="varsity" style={{ color: c.text }}>
                Your Leagues
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={18} color={c.secondaryText} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loader}><LogoSpinner /></View>
          ) : leagues.length === 0 ? (
            <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
              No leagues yet — create, join, or import one below.
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
                    style={styles.rowOuter}
                    onPress={() => handleSelect(league)}
                    activeOpacity={0.7}
                    accessibilityRole="menuitem"
                    accessibilityLabel={`${league.leagueName}, ${league.teamName}${isActive ? ', currently selected' : ''}`}
                  >
                    {/* Gold left-bar signals "this is where you are" —
                        same pattern the schedule uses for the current week. */}
                    <View
                      style={[
                        styles.leftBar,
                        { backgroundColor: isActive ? Brand.vintageGold : 'transparent' },
                      ]}
                    />
                    <View
                      style={[
                        styles.rowInner,
                        isActive && { backgroundColor: c.activeCard },
                      ]}
                    >
                      <View style={styles.leagueInfo}>
                        <ThemedText
                          type="sectionLabel"
                          style={[
                            styles.leagueName,
                            { color: isActive ? c.activeText : c.text },
                          ]}
                          numberOfLines={1}
                        >
                          {league.leagueName}
                        </ThemedText>
                        <ThemedText
                          style={[styles.teamName, { color: c.secondaryText }]}
                          numberOfLines={1}
                        >
                          {league.teamName}
                        </ThemedText>
                      </View>
                      <View style={styles.rowIcons}>
                        <SportBadge sport={league.sport} />
                        <Badge
                          label={LEAGUE_TYPE_DISPLAY[league.leagueType] ?? 'Redraft'}
                          variant="neutral"
                        />
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
                            color={isFav ? Brand.vintageGold : c.secondaryText}
                          />
                        </Pressable>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* Divider — small centered gold stamp over a hairline.
              Breaks the list from the actions without a heavy rule. */}
          <View style={styles.dividerRow}>
            <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
            <View style={[styles.dividerStamp, { backgroundColor: c.gold }]} />
            <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
          </View>

          {/* Quick actions — a 3-up tile row that fills the dropdown
              width instead of stacking mostly-empty rows. Icon on top,
              varsity small-caps label under, lifted c.card surface
              against the dropdown's warmer cardAlt tone. */}
          <View style={styles.actionGrid}>
            <TouchableOpacity
              style={[styles.actionTile, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={handleCreateNew}
              activeOpacity={0.7}
              accessibilityRole="menuitem"
              accessibilityLabel="Create new league"
            >
              <Ionicons name="add-circle-outline" size={22} color={c.accent} accessible={false} />
              <ThemedText type="varsitySmall" style={[styles.actionTileLabel, { color: c.text }]}>
                Create
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionTile, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={handleJoin}
              activeOpacity={0.7}
              accessibilityRole="menuitem"
              accessibilityLabel="Join a league"
            >
              <Ionicons name="people-outline" size={22} color={c.accent} accessible={false} />
              <ThemedText type="varsitySmall" style={[styles.actionTileLabel, { color: c.text }]}>
                Join
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionTile, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={handleImport}
              activeOpacity={0.7}
              accessibilityRole="menuitem"
              accessibilityLabel="Import league"
            >
              <Ionicons name="download-outline" size={22} color={c.accent} accessible={false} />
              <ThemedText type="varsitySmall" style={[styles.actionTileLabel, { color: c.text }]}>
                Import
              </ThemedText>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  dropdown: {
    marginTop: s(100),
    marginHorizontal: s(16),
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: s(10),
    paddingHorizontal: s(10),
    ...cardShadow,
  },

  // ─── Header ───────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(6),
    paddingBottom: s(10),
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  headerRule: {
    height: 2,
    width: s(18),
  },

  // ─── States ───────────────────────────────────────────────
  loader: {
    paddingVertical: s(20),
  },
  emptyText: {
    textAlign: "center",
    paddingVertical: s(20),
    paddingHorizontal: s(12),
    fontSize: ms(13),
    lineHeight: ms(18),
  },

  // ─── League rows ──────────────────────────────────────────
  leagueList: {
    maxHeight: s(320),
  },
  rowOuter: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginVertical: s(2),
    borderRadius: 10,
    overflow: 'hidden',
  },
  leftBar: {
    width: 3,
  },
  rowInner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(11),
    paddingHorizontal: s(12),
    gap: s(10),
  },
  leagueInfo: {
    flex: 1,
    minWidth: 0,
  },
  leagueName: {
    // sectionLabel's default is 17px — pull back slightly for the
    // denser dropdown context.
    fontSize: ms(15),
    lineHeight: ms(20),
  },
  teamName: {
    fontSize: ms(12),
    marginTop: s(2),
  },
  rowIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },

  // ─── Divider ──────────────────────────────────────────────
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingHorizontal: s(6),
    paddingTop: s(4),
    paddingBottom: s(10),
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerStamp: {
    height: 2,
    width: s(18),
  },

  // ─── Actions ──────────────────────────────────────────────
  actionGrid: {
    flexDirection: 'row',
    gap: s(8),
    paddingHorizontal: s(4),
    paddingTop: s(2),
    paddingBottom: s(4),
  },
  actionTile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(12),
    paddingHorizontal: s(6),
    borderRadius: 10,
    borderWidth: 1,
    gap: s(4),
  },
  actionTileLabel: {
    fontSize: ms(10),
  },
});
