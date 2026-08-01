import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import Animated, { Easing, FadeOut, withTiming } from "react-native-reanimated";

import { Badge } from "@/components/ui/Badge";
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { SportBadge } from "@/components/ui/SportBadge";
import { ThemedText } from "@/components/ui/ThemedText";
import { Brand, Colors, SPORT_THEMES, cardShadow } from "@/constants/Colors";
import {
  LEAGUE_TYPE_DISPLAY,
  SPORT_DISPLAY,
  type Sport,
} from "@/constants/LeagueDefaults";
import { queryKeys } from "@/constants/queryKeys";
import { useAppState } from "@/context/AppStateProvider";
import { useSession } from "@/context/AuthProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { supabase } from "@/lib/supabase";
import { ms, s } from '@/utils/scale';

/**
 * Sidebar variant's open animation: the panel grows downward out of the league
 * card rather than sliding or cross-fading in. Paired with
 * `transformOrigin: 'top'` on the panel so the top edge stays pinned to the
 * card and only the bottom travels. Short enough that the scaleY squash on the
 * content isn't perceptible.
 */
function expandDown() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scaleY: 0.85 }] },
    animations: {
      // Opacity lands first so the panel is solid while it's still settling,
      // rather than fading and growing in lockstep.
      opacity: withTiming(1, { duration: 160 }),
      transform: [
        {
          scaleY: withTiming(1, {
            duration: 300,
            easing: Easing.out(Easing.cubic),
          }),
        },
      ],
    },
  };
}

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
  /**
   * `modal` (default) is the phone dropdown — a centred sheet over a scrim.
   * `sidebar` fills the web sidebar column in place, so switching leagues
   * stays inside the nav chrome instead of becoming a screen-level popup.
   */
  variant?: "modal" | "sidebar";
}

export function LeagueSwitcher({
  visible,
  onClose,
  variant = "modal",
}: LeagueSwitcherProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const session = useSession();
  const { leagueId, teamId, switchLeague } = useAppState();
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

      const leagues: UserLeague[] = (teamsData ?? [])
        // Archived (soft-deleted) leagues are RLS-hidden, so their embed comes
        // back null — drop those teams instead of showing a ghost league row.
        .filter((team: any) => team.leagues != null)
        .map((team: any) => ({
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

  // Sport filter. Only the sports the user actually plays get a pill, and the
  // filter resets on close so reopening never shows a mysteriously short list.
  const [sportFilter, setSportFilter] = useState<Sport | null>(null);

  const availableSports = useMemo(() => {
    const present = new Set(leagues.map((l) => l.sport));
    return (Object.keys(SPORT_DISPLAY) as Sport[]).filter((sp) =>
      present.has(sp)
    );
  }, [leagues]);

  // Guard against a filter left pointing at a sport the user no longer has a
  // league in (last league of that sport left while the switcher is open).
  const activeSport =
    sportFilter && availableSports.includes(sportFilter) ? sportFilter : null;

  const visibleLeagues = useMemo(
    () => (activeSport ? leagues.filter((l) => l.sport === activeSport) : leagues),
    [leagues, activeSport]
  );

  // Every close path routes through here so the filter never survives into the
  // next open — reopening to a short list with no memory of filtering it reads
  // as leagues gone missing. Both call sites only close via `onClose`.
  const handleClose = () => {
    setSportFilter(null);
    onClose();
  };

  const handleSelect = (league: UserLeague) => {
    const prevLeagueId = leagueId;
    const prevTeamId = teamId;
    switchLeague(league.leagueId, league.teamId);

    // Drop only the cache entries scoped to the league we're LEAVING. Every
    // league-scoped query key embeds its leagueId/teamId, so the new league's
    // screens query under fresh keys and can't read stale data regardless —
    // this just frees the old league's memory. Crucially we leave globally-
    // shared, league-independent caches warm (NBA player pool / season stats,
    // schedules, archives, watchlist, subscription); re-fetching those on
    // every switch is what made switching slow. The target league's own
    // cached data (if visited recently) also survives, so a switch back is
    // instant instead of a cold spinner.
    if (prevLeagueId && prevLeagueId !== league.leagueId) {
      queryClient.removeQueries({
        predicate: (q) =>
          q.queryKey.includes(prevLeagueId) ||
          (prevTeamId != null && q.queryKey.includes(prevTeamId)),
      });
    }
    handleClose();
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
    handleClose();
  };

  const handleJoin = () => {
    router.push("/join-league");
    handleClose();
  };

  const handleImport = () => {
    router.push("/import-league");
    handleClose();
  };

  // `c.cardAlt` is the warmer of the two card tones (#F4EFDC in light
  // mode) — sits between the ecru page and the near-white `c.card`, so
  // the dropdown reads as "paper" rather than "paint." Dark mode keeps
  // its existing cardAlt value which handles the equivalent step there.
  const surfaceBg = c.cardAlt;

  // On phone the dropdown fills the screen minus its margins, which is right.
  // A browser window has no such bound, so without a cap it stretches to the
  // full viewport (~2000px) and reads as a stretched-out phone sheet rather
  // than a menu. Cap the width and centre it; the list also gets to use the
  // extra vertical room instead of the phone's fixed 320.
  const isWeb = Platform.OS === "web";
  const isSidebar = variant === "sidebar";
  const { height: windowHeight } = useWindowDimensions();
  // Leave room for the top offset, header, divider and the action tiles so the
  // dropdown never runs past the bottom of a short window. The sidebar variant
  // is already bounded by the column, so it just flexes into the space left
  // between the header and the action tiles.
  const listMaxHeight = isWeb
    ? Math.max(200, Math.min(480, windowHeight - s(320)))
    : s(320);

  // Sport filter pills — each one wears its own sport's brand fill when on,
  // the same color as that sport's SportBadge, so the pill and the rows it
  // keeps read as the same thing. Pointless with a single sport.
  const sportFilters =
    availableSports.length > 1 ? (
      <View style={styles.filterRow}>
        {availableSports.map((sp) => {
          const on = activeSport === sp;
          const tint = SPORT_THEMES[sp]?.[scheme]?.primary ?? c.primary;
          return (
            <TouchableOpacity
              key={sp}
              onPress={() => setSportFilter(on ? null : sp)}
              activeOpacity={0.7}
              // The pill itself is only ~20pt tall; grow the target vertically
              // without letting neighbours (s(6) apart) overlap horizontally.
              hitSlop={{ top: 12, bottom: 12, left: 3, right: 3 }}
              style={[
                styles.filterPill,
                { borderColor: tint, backgroundColor: on ? tint : "transparent" },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Show only ${SPORT_DISPLAY[sp]} leagues`}
            >
              <ThemedText
                type="varsitySmall"
                style={[
                  styles.filterPillText,
                  { color: on ? c.statusText : tint },
                ]}
              >
                {SPORT_DISPLAY[sp]}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>
    ) : null;

  const body = (
    <>
      {/* Header — gold rule + varsity label + close button. Gives
          the dropdown a real identity instead of a floating list. */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={[styles.headerRule, { backgroundColor: c.gold }]} />
          <ThemedText type="varsity" style={{ color: c.text }} numberOfLines={1}>
            Your Leagues
          </ThemedText>
        </View>
        <View style={styles.headerRight}>
          {/* The 264px nav column can't fit the title, three pills and the
              close button on one line — sidebar puts them on their own row. */}
          {!isSidebar && sportFilters}
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={18} color={c.secondaryText} />
          </TouchableOpacity>
        </View>
      </View>

      {isSidebar && sportFilters ? (
        <View style={styles.filterRowSidebar}>{sportFilters}</View>
      ) : null}

      {loading ? (
        <View style={styles.loader}><LogoSpinner /></View>
      ) : leagues.length === 0 ? (
        <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
          No leagues yet — create, join, or import one below.
        </ThemedText>
      ) : (
        <ScrollView
          style={isSidebar ? styles.leagueListFlex : { maxHeight: listMaxHeight }}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {visibleLeagues.map((league) => {
            const isActive = league.leagueId === leagueId;
            const isFav = league.leagueId === favoriteLeagueId;

            const nameBlock = (
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
            );

            const badges = (
              <>
                <SportBadge sport={league.sport} style={styles.sportPill} />
                {/* Transparent, not `neutral` — neutral's fill IS the panel's
                    own cardAlt, so it reads as bare text on a normal row and
                    then pops into a visible chip on the active row's tinted
                    background. The sport pill is the only filled one. */}
                <Badge
                  label={LEAGUE_TYPE_DISPLAY[league.leagueType] ?? 'Redraft'}
                  backgroundColor="transparent"
                  style={styles.typePill}
                />
              </>
            );

            const favStar = (
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
            );

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
                  {isSidebar ? (
                    // The 264px nav column can't fit name + badges + star on
                    // one line — the name loses the race and ellipsizes to a
                    // few characters. Drop the badges to their own line so the
                    // league name gets the full width.
                    <View style={styles.rowStack}>
                      <View style={styles.rowStackTop}>
                        {nameBlock}
                        {favStar}
                      </View>
                      <View style={styles.rowIcons}>{badges}</View>
                    </View>
                  ) : (
                    <>
                      {nameBlock}
                      <View style={styles.rowIcons}>
                        {badges}
                        {favStar}
                      </View>
                    </>
                  )}
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
    </>
  );

  // Sidebar variant: an in-place panel over the nav column. No Modal and no
  // full-screen scrim — switching leagues is navigation, not a screen-level
  // interruption, so it stays within the sidebar's own bounds.
  if (isSidebar) {
    if (!visible) return null;
    return (
      <Animated.View
        entering={expandDown}
        exiting={FadeOut.duration(140)}
        style={[
          styles.sidebarPanel,
          { backgroundColor: surfaceBg, borderColor: c.border },
        ]}
        accessibilityRole="menu"
        accessibilityLabel="Your leagues"
      >
        {body}
      </Animated.View>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose} accessibilityLabel="Close league switcher">
        <Pressable
          style={[
            styles.dropdown,
            isWeb && styles.dropdownWeb,
            { backgroundColor: surfaceBg, borderColor: c.border },
          ]}
          onPress={(e) => e.stopPropagation()}
          accessibilityRole="menu"
        >
          {body}
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
  // Web-only: bound the menu width instead of letting it span the viewport.
  // Still used by the modal variant at narrow web widths, where the home
  // screen keeps its own switcher trigger and there is no sidebar to fill.
  dropdownWeb: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
  },
  // Reads as the sidebar's league card expanding down over the nav: same
  // border + radius as the card, aligned to the same column, growing from
  // its top edge. Sits below the brand, which stays visible.
  sidebarPanel: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    transformOrigin: "top",
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
    flexShrink: 1,
    gap: s(10),
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  headerRule: {
    height: 2,
    width: s(18),
  },

  // ─── Sport filter ─────────────────────────────────────────
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  filterRowSidebar: {
    paddingHorizontal: s(6),
    paddingBottom: s(10),
  },
  filterPill: {
    paddingHorizontal: s(7),
    paddingVertical: s(2),
    borderRadius: 4,
    borderWidth: 1,
  },
  filterPillText: {
    fontSize: ms(9),
    letterSpacing: 0.8,
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
  // Sidebar variant: take the room left between header and action tiles.
  leagueListFlex: {
    flex: 1,
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
    gap: s(0),
  },
  // Both pills get a fixed column (and a shared height) so they line up down
  // the list instead of each row placing them wherever its own labels end —
  // "NBA / DYNASTY" and "WNBA / KEEPER" otherwise land in different spots.
  // minWidth, not width: a longer label grows the pill rather than clipping.
  sportPill: {
    minWidth: ms(48),
    minHeight: ms(19),
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  typePill: {
    minWidth: ms(64),
    minHeight: ms(19),
    alignItems: "center",
    justifyContent: "center",
  },
  // Sidebar variant: name + star on top, badges beneath.
  rowStack: {
    flex: 1,
    minWidth: 0,
    gap: s(8),
  },
  rowStackTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
