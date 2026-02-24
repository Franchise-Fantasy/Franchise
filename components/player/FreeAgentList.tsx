import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { PlayerFilterBar } from "@/components/player/PlayerFilterBar";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { usePlayerFilter } from "@/hooks/usePlayerFilter";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { calculateAvgFantasyPoints } from "@/utils/fantasyPoints";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/injuryBadge";
import { getPlayerHeadshotUrl, getTeamLogoUrl } from "@/utils/playerHeadshot";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const SKELETON_COUNT = 8;

function SkeletonRow({ color, index }: { color: string; index: number }) {
  const pulse = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
          delay: index * 60,
        }),
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={[styles.row, { borderBottomColor: color }]}>
      <Animated.View
        style={[styles.headshot, { backgroundColor: color, opacity: pulse, marginRight: 10 }]}
      />
      <View style={styles.info}>
        <Animated.View
          style={[styles.skeletonBar, { width: 120, backgroundColor: color, opacity: pulse }]}
        />
        <Animated.View
          style={[styles.skeletonBar, { width: 40, marginTop: 4, backgroundColor: color, opacity: pulse }]}
        />
      </View>
      <View style={styles.rightSide}>
        <View style={styles.stats}>
          <Animated.View
            style={[styles.skeletonBar, { width: 60, backgroundColor: color, opacity: pulse }]}
          />
          <Animated.View
            style={[styles.skeletonBar, { width: 44, marginTop: 4, backgroundColor: color, opacity: pulse }]}
          />
        </View>
        <Animated.View
          style={[styles.addButton, { backgroundColor: color, opacity: pulse }]}
        >
          <Text style={styles.addButtonText}> </Text>
        </Animated.View>
      </View>
    </View>
  );
}

function FadeInImage({ uri, style, resizeMode }: { uri: string; style: any; resizeMode: any }) {
  const opacity = useRef(new Animated.Value(0)).current;
  return (
    <Animated.Image
      source={{ uri }}
      style={[style, { opacity }]}
      resizeMode={resizeMode}
      onLoad={() => {
        Animated.timing(opacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }).start();
      }}
    />
  );
}

interface FreeAgentListProps {
  leagueId: string;
  teamId: string;
}

export function FreeAgentList({ leagueId, teamId }: FreeAgentListProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSeasonStats | null>(null);
  const [openAsDropPicker, setOpenAsDropPicker] = useState(false);
  const [addingPlayerId, setAddingPlayerId] = useState<string | null>(null);

  const { data: scoringWeights } = useLeagueScoring(leagueId);

  const { data: hasActiveDraft } = useQuery({
    queryKey: ["hasActiveDraft", leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drafts")
        .select("id")
        .eq("league_id", leagueId)
        .neq("status", "complete")
        .limit(1);

      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    enabled: !!leagueId,
  });

  const draftInProgress = hasActiveDraft ?? true;

  const { data: rosterInfo } = useQuery({
    queryKey: ["rosterInfo", leagueId, teamId],
    queryFn: async () => {
      const [allPlayersRes, irPlayersRes, leagueRes] = await Promise.all([
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId),
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("roster_slot", "IR"),
        supabase
          .from("leagues")
          .select("roster_size")
          .eq("id", leagueId)
          .single(),
      ]);
      if (allPlayersRes.error) throw allPlayersRes.error;
      if (irPlayersRes.error) throw irPlayersRes.error;
      if (leagueRes.error) throw leagueRes.error;
      const activeCount =
        (allPlayersRes.count ?? 0) - (irPlayersRes.count ?? 0);
      return {
        activeCount,
        maxSize: leagueRes.data?.roster_size ?? 13,
      };
    },
    enabled: !!leagueId && !!teamId,
  });

  const rosterIsFull = rosterInfo
    ? rosterInfo.activeCount >= rosterInfo.maxSize
    : false;

  const { data: freeAgents, isLoading } = useQuery<PlayerSeasonStats[]>({
    queryKey: ["freeAgents", leagueId],
    queryFn: async () => {
      const { data: rosteredPlayers, error: rpError } = await supabase
        .from("league_players")
        .select("player_id")
        .eq("league_id", leagueId);

      if (rpError) throw rpError;
      const rosteredIds =
        rosteredPlayers?.map((p) => String(p.player_id)) || [];

      let query = supabase
        .from("player_season_stats")
        .select("*")
        .gt("games_played", 0)
        .order("avg_pts", { ascending: false });

      if (rosteredIds.length > 0) {
        query = query.filter(
          "player_id",
          "not.in",
          `(${rosteredIds.join(",")})`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as PlayerSeasonStats[];
    },
    enabled: !!leagueId,
  });

  const { filteredPlayers, filterBarProps } = usePlayerFilter(
    freeAgents,
    scoringWeights,
  );

  const handleAddPlayer = async (player: PlayerSeasonStats) => {
    setAddingPlayerId(player.player_id);
    try {
      const { error: lpError } = await supabase.from("league_players").insert({
        league_id: leagueId,
        player_id: player.player_id,
        team_id: teamId,
        acquired_via: "free_agent",
        acquired_at: new Date().toISOString(),
        position: player.position,
      });

      if (lpError) throw lpError;

      const { data: txn, error: txnError } = await supabase
        .from("league_transactions")
        .insert({
          league_id: leagueId,
          type: "waiver",
          notes: `Added ${player.name} from free agency`,
        })
        .select("id")
        .single();

      if (txnError) throw txnError;

      await supabase.from("league_transaction_items").insert({
        transaction_id: txn.id,
        player_id: player.player_id,
        team_to_id: teamId,
      });

      queryClient.invalidateQueries({ queryKey: ["freeAgents", leagueId] });
      queryClient.invalidateQueries({ queryKey: ["teamRoster", teamId] });
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to add player");
    } finally {
      setAddingPlayerId(null);
    }
  };

  const renderPlayer = ({ item }: { item: PlayerSeasonStats }) => {
    const fpts = scoringWeights
      ? calculateAvgFantasyPoints(item, scoringWeights)
      : undefined;
    const isAdding = addingPlayerId === item.player_id;
    const headshotUrl = getPlayerHeadshotUrl(item.external_id_nba);
    const logoUrl = getTeamLogoUrl(item.nba_team);
    const badge = getInjuryBadge(item.status);

    return (
      <TouchableOpacity
        style={[styles.row, { borderBottomColor: c.border }]}
        onPress={() => setSelectedPlayer(item)}
        activeOpacity={0.7}
      >
        <View style={styles.portraitWrap}>
          {headshotUrl ? (
            <FadeInImage
              uri={headshotUrl}
              style={styles.headshot}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.headshot, { backgroundColor: c.border }]} />
          )}
          <View style={styles.teamPill}>
            {logoUrl && (
              <Image
                source={{ uri: logoUrl }}
                style={styles.teamPillLogo}
                resizeMode="contain"
              />
            )}
            <Text style={styles.teamPillText}>{item.nba_team}</Text>
          </View>
        </View>

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <ThemedText
              type="defaultSemiBold"
              numberOfLines={1}
              style={{ flexShrink: 1, fontSize: 14 }}
            >
              {item.name}
            </ThemedText>
            {badge && (
              <View style={[styles.badge, { backgroundColor: badge.color }]}>
                <Text style={styles.badgeText}>{badge.label}</Text>
              </View>
            )}
          </View>
          <ThemedText style={[styles.posText, { color: c.secondaryText }]}>
            {formatPosition(item.position)}
          </ThemedText>
        </View>

        <View style={styles.rightSide}>
          <View style={styles.stats}>
            <ThemedText style={[styles.statLine, { color: c.secondaryText }]}>
              {item.avg_pts}/{item.avg_reb}/{item.avg_ast}
            </ThemedText>
            {fpts !== undefined && (
              <ThemedText style={[styles.fpts, { color: c.accent }]}>
                {fpts} FPTS
              </ThemedText>
            )}
          </View>
          <TouchableOpacity
            style={[
              styles.addButton,
              (isAdding || draftInProgress) && styles.addButtonDisabled,
            ]}
            onPress={() => {
              if (rosterIsFull) {
                setOpenAsDropPicker(true);
                setSelectedPlayer(item);
              } else {
                handleAddPlayer(item);
              }
            }}
            disabled={isAdding || draftInProgress}
          >
            <ThemedText style={styles.addButtonText}>+</ThemedText>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <PlayerFilterBar {...filterBarProps} />
        <View style={styles.listContent}>
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <SkeletonRow key={i} color={c.border} index={i} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PlayerFilterBar {...filterBarProps} />
      <FlatList<PlayerSeasonStats>
        data={filteredPlayers}
        renderItem={renderPlayer}
        keyExtractor={(item) => item.player_id}
        contentContainerStyle={styles.listContent}
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={5}
      />
      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId}
        teamId={teamId}
        onClose={() => {
          setSelectedPlayer(null);
          setOpenAsDropPicker(false);
        }}
        startInDropPicker={openAsDropPicker}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  portraitWrap: {
    width: 52,
    height: 48,
    marginRight: 10,
  },
  headshot: {
    width: 52,
    height: 40,
    borderRadius: 6,
  },
  teamPill: {
    position: "absolute",
    bottom: 0,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    gap: 2,
  },
  teamPillLogo: {
    width: 10,
    height: 10,
  },
  teamPillText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  badge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  badgeText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  posText: {
    fontSize: 11,
    marginTop: 1,
  },
  rightSide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stats: {
    alignItems: "flex-end",
  },
  statLine: {
    fontSize: 12,
  },
  fpts: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 1,
  },
  addButton: {
    backgroundColor: "#28a745",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  addButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
  addButtonDisabled: {
    backgroundColor: "#ccc",
  },
  skeletonBar: {
    height: 12,
    borderRadius: 4,
  },
});
