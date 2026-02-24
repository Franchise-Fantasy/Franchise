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
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
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
  const [showClaimsSection, setShowClaimsSection] = useState(false);
  const [showWaiverOrder, setShowWaiverOrder] = useState(false);

  // FAAB bid modal state
  const [faabModalPlayer, setFaabModalPlayer] = useState<PlayerSeasonStats | null>(null);
  const [bidAmount, setBidAmount] = useState("0");
  const [faabDropPlayerId, setFaabDropPlayerId] = useState<string | null>(null);

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

  // Fetch roster info + league waiver settings
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
          .select("roster_size, waiver_type, waiver_day_of_week")
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
        waiverType: (leagueRes.data?.waiver_type ?? 'none') as 'standard' | 'faab' | 'none',
        waiverDayOfWeek: leagueRes.data?.waiver_day_of_week ?? 3,
      };
    },
    enabled: !!leagueId && !!teamId,
  });

  const rosterIsFull = rosterInfo
    ? rosterInfo.activeCount >= rosterInfo.maxSize
    : false;
  const waiverType = rosterInfo?.waiverType ?? 'none';

  // Fetch players currently on waivers in this league (with expiry times)
  const { data: waiverPlayerMap } = useQuery({
    queryKey: ["leagueWaivers", leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("league_waivers")
        .select("player_id, on_waivers_until")
        .eq("league_id", leagueId)
        .gt("on_waivers_until", new Date().toISOString());
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of data ?? []) map.set(r.player_id, r.on_waivers_until);
      return map;
    },
    enabled: !!leagueId && waiverType !== 'none',
  });

  // Fetch team's FAAB remaining (for FAAB mode)
  const { data: faabRemaining } = useQuery({
    queryKey: ["faabRemaining", leagueId, teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waiver_priority")
        .select("faab_remaining")
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .single();
      if (error) return null;
      return data?.faab_remaining ?? 0;
    },
    enabled: !!leagueId && !!teamId && waiverType === 'faab',
  });

  // Fetch waiver priority order for all teams in the league
  const { data: waiverOrder } = useQuery({
    queryKey: ["waiverOrder", leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waiver_priority")
        .select("team_id, priority, faab_remaining, team:teams!waiver_priority_team_id_fkey(name)")
        .eq("league_id", leagueId)
        .order("priority", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId && waiverType !== 'none',
  });

  // Fetch pending claims for this team
  const { data: pendingClaims } = useQuery({
    queryKey: ["pendingClaims", leagueId, teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waiver_claims")
        .select("id, player_id, bid_amount, created_at, player:players!waiver_claims_player_id_fkey(name, position, nba_team)")
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId && !!teamId && waiverType !== 'none',
  });

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

  // Compute when a claim will process
  function getProcessDate(playerId: string): string {
    if (waiverType === 'standard') {
      const until = waiverPlayerMap?.get(playerId);
      if (until) {
        const d = new Date(until);
        return `${d.getMonth() + 1}/${d.getDate()}`;
      }
      return '—';
    }
    if (waiverType === 'faab') {
      const targetDay = rosterInfo?.waiverDayOfWeek ?? 3;
      const now = new Date();
      const currentDay = now.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      const next = new Date(now);
      next.setDate(now.getDate() + daysUntil);
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return `${dayNames[targetDay]} ${next.getMonth() + 1}/${next.getDate()}`;
    }
    return '—';
  }

  // Determine if a player requires a waiver claim
  function isOnWaivers(playerId: string): boolean {
    if (waiverType === 'none') return false;
    if (waiverType === 'faab') return true; // FAAB: all adds go through bidding
    // Standard: only recently dropped players
    return waiverPlayerMap?.has(playerId) ?? false;
  }

  // Instant add (free agent, no waivers)
  const handleAddPlayer = async (player: PlayerSeasonStats) => {
    setAddingPlayerId(player.player_id);
    try {
      // Re-check roster limit before adding
      const [allRes, irRes, leagueRes] = await Promise.all([
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
      const activeCount = (allRes.count ?? 0) - (irRes.count ?? 0);
      const maxSize = leagueRes.data?.roster_size ?? 13;
      if (activeCount >= maxSize) {
        queryClient.invalidateQueries({ queryKey: ["rosterInfo", leagueId, teamId] });
        setOpenAsDropPicker(true);
        setSelectedPlayer(player);
        setAddingPlayerId(null);
        return;
      }

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
      queryClient.invalidateQueries({ queryKey: ["rosterInfo", leagueId, teamId] });
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to add player");
    } finally {
      setAddingPlayerId(null);
    }
  };

  // Submit a waiver claim (standard mode)
  const handleSubmitClaim = async (player: PlayerSeasonStats, dropPlayerId?: string) => {
    setAddingPlayerId(player.player_id);
    try {
      // Get current waiver priority
      const { data: wp } = await supabase
        .from("waiver_priority")
        .select("priority")
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .single();

      const { error } = await supabase.from("waiver_claims").insert({
        league_id: leagueId,
        team_id: teamId,
        player_id: player.player_id,
        drop_player_id: dropPlayerId ?? null,
        bid_amount: 0,
        priority: wp?.priority ?? 99,
      });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["pendingClaims", leagueId, teamId] });
      Alert.alert("Claim Submitted", `Waiver claim for ${player.name} submitted.`);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to submit claim");
    } finally {
      setAddingPlayerId(null);
    }
  };

  // Submit a FAAB bid
  const handleSubmitFaabBid = async (player: PlayerSeasonStats, bid: number, dropPlayerId?: string) => {
    setAddingPlayerId(player.player_id);
    try {
      const { data: wp } = await supabase
        .from("waiver_priority")
        .select("priority")
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .single();

      const { error } = await supabase.from("waiver_claims").insert({
        league_id: leagueId,
        team_id: teamId,
        player_id: player.player_id,
        drop_player_id: dropPlayerId ?? null,
        bid_amount: bid,
        priority: wp?.priority ?? 99,
      });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["pendingClaims", leagueId, teamId] });
      Alert.alert("Bid Submitted", `$${bid} bid for ${player.name} submitted.`);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to submit bid");
    } finally {
      setAddingPlayerId(null);
    }
  };

  // Cancel a pending claim
  const handleCancelClaim = async (claimId: string) => {
    const { error } = await supabase
      .from("waiver_claims")
      .update({ status: "cancelled" })
      .eq("id", claimId);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["pendingClaims", leagueId, teamId] });
  };

  // State to track if the drop picker is in "claim with drop" mode
  const [claimWithDropPlayer, setClaimWithDropPlayer] = useState<PlayerSeasonStats | null>(null);

  // Trigger the claim flow (standard or FAAB) for a player, optionally with a drop
  const triggerClaimFlow = (player: PlayerSeasonStats, dropPlayerId?: string) => {
    if (waiverType === 'faab') {
      setBidAmount("0");
      setFaabModalPlayer(player);
      // Store drop player id for when bid is submitted
      if (dropPlayerId) setFaabDropPlayerId(dropPlayerId);
    } else {
      Alert.alert(
        "Submit Waiver Claim",
        `Claim ${player.name}?${dropPlayerId ? '' : ''}`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Submit", onPress: () => handleSubmitClaim(player, dropPlayerId) },
        ],
      );
    }
  };

  // Handle the add/claim button press
  const handleButtonPress = (player: PlayerSeasonStats) => {
    const needsClaim = isOnWaivers(player.player_id);

    if (!needsClaim) {
      if (rosterIsFull) {
        setOpenAsDropPicker(true);
        setSelectedPlayer(player);
      } else {
        handleAddPlayer(player);
      }
      return;
    }

    // Needs waiver claim
    if (rosterIsFull) {
      // Open drop picker in claim mode — player will be claimed, not instant added
      setClaimWithDropPlayer(player);
      setOpenAsDropPicker(true);
      setSelectedPlayer(player);
    } else {
      triggerClaimFlow(player);
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
    const needsClaim = isOnWaivers(item.player_id);

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
              needsClaim ? styles.claimButton : styles.addButton,
              (isAdding || draftInProgress) && styles.addButtonDisabled,
            ]}
            onPress={() => handleButtonPress(item)}
            disabled={isAdding || draftInProgress}
          >
            <ThemedText style={styles.addButtonText}>
              {needsClaim ? "Claim" : "+"}
            </ThemedText>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const claimCount = pendingClaims?.length ?? 0;

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

      {/* Pending Claims Header */}
      {claimCount > 0 && (
        <View>
          <TouchableOpacity
            style={[styles.claimsHeader, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => setShowClaimsSection(!showClaimsSection)}
          >
            <View style={styles.claimsHeaderLeft}>
              <Ionicons name="time-outline" size={16} color="#D4A017" />
              <ThemedText style={styles.claimsHeaderText}>
                Pending Claims ({claimCount})
              </ThemedText>
            </View>
            <Ionicons
              name={showClaimsSection ? "chevron-up" : "chevron-down"}
              size={16}
              color={c.secondaryText}
            />
          </TouchableOpacity>
          {showClaimsSection && (
            <View style={[styles.claimsList, { backgroundColor: c.card, borderColor: c.border }]}>
              {pendingClaims!.map((claim: any) => (
                <View key={claim.id} style={[styles.claimRow, { borderBottomColor: c.border }]}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>
                      {claim.player?.name ?? 'Unknown'}
                    </ThemedText>
                    <ThemedText style={{ fontSize: 11, color: c.secondaryText }}>
                      {claim.player?.position} - {claim.player?.nba_team}
                      {waiverType === 'faab' ? ` | $${claim.bid_amount} bid` : ''}
                      {' · Processes ' + getProcessDate(claim.player_id)}
                    </ThemedText>
                  </View>
                  <TouchableOpacity
                    onPress={() =>
                      Alert.alert("Cancel Claim", "Remove this waiver claim?", [
                        { text: "Keep", style: "cancel" },
                        { text: "Cancel Claim", style: "destructive", onPress: () => handleCancelClaim(claim.id) },
                      ])
                    }
                    hitSlop={8}
                  >
                    <Ionicons name="close-circle" size={20} color={c.secondaryText} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Waiver Priority Order */}
      {waiverType !== 'none' && waiverOrder && waiverOrder.length > 0 && (
        <View>
          <TouchableOpacity
            style={[styles.claimsHeader, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => setShowWaiverOrder(!showWaiverOrder)}
          >
            <View style={styles.claimsHeaderLeft}>
              <Ionicons name="list-outline" size={16} color={c.accent} />
              <ThemedText style={styles.claimsHeaderText}>
                Waiver Order{waiverType === 'faab' ? ' / FAAB' : ''}
              </ThemedText>
            </View>
            <Ionicons
              name={showWaiverOrder ? "chevron-up" : "chevron-down"}
              size={16}
              color={c.secondaryText}
            />
          </TouchableOpacity>
          {showWaiverOrder && (
            <View style={[styles.claimsList, { backgroundColor: c.card, borderColor: c.border }]}>
              {waiverOrder.map((wp: any) => (
                <View key={wp.team_id} style={[styles.claimRow, { borderBottomColor: c.border }]}>
                  <ThemedText style={{ fontSize: 14, fontWeight: '700', width: 24, color: c.secondaryText }}>
                    {wp.priority}
                  </ThemedText>
                  <ThemedText style={{ flex: 1, fontSize: 13, fontWeight: wp.team_id === teamId ? '700' : '400' }}>
                    {wp.team?.name ?? 'Unknown'}{wp.team_id === teamId ? ' (You)' : ''}
                  </ThemedText>
                  {waiverType === 'faab' && (
                    <ThemedText style={{ fontSize: 12, color: c.secondaryText }}>
                      ${wp.faab_remaining}
                    </ThemedText>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* FAAB remaining badge */}
      {waiverType === 'faab' && faabRemaining != null && (
        <View style={[styles.faabBadge, { backgroundColor: c.card, borderColor: c.border }]}>
          <ThemedText style={{ fontSize: 12, color: c.secondaryText }}>
            FAAB Budget: <Text style={{ fontWeight: '700', color: c.text }}>${faabRemaining}</Text>
          </ThemedText>
        </View>
      )}

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
          setClaimWithDropPlayer(null);
        }}
        startInDropPicker={openAsDropPicker}
        onDropForClaim={claimWithDropPlayer ? (dropPlayer) => {
          triggerClaimFlow(claimWithDropPlayer, dropPlayer.player_id);
          setClaimWithDropPlayer(null);
        } : undefined}
        onClaimPlayer={selectedPlayer && isOnWaivers(selectedPlayer.player_id) ? () => {
          triggerClaimFlow(selectedPlayer);
        } : undefined}
      />

      {/* FAAB Bid Modal */}
      <Modal visible={!!faabModalPlayer} animationType="fade" transparent onRequestClose={() => setFaabModalPlayer(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.faabModal, { backgroundColor: c.card }]}>
            <ThemedText type="defaultSemiBold" style={{ fontSize: 16, marginBottom: 4 }}>
              Place FAAB Bid
            </ThemedText>
            <ThemedText style={{ fontSize: 13, color: c.secondaryText, marginBottom: 16 }}>
              {faabModalPlayer?.name} - {formatPosition(faabModalPlayer?.position ?? '')}
            </ThemedText>

            <View style={styles.bidRow}>
              <ThemedText style={{ fontSize: 14, color: c.secondaryText }}>Bid Amount ($)</ThemedText>
              <TextInput
                style={[styles.bidInput, { color: c.text, borderColor: c.border, backgroundColor: c.input }]}
                value={bidAmount}
                onChangeText={setBidAmount}
                keyboardType="number-pad"
                selectTextOnFocus
              />
            </View>
            <ThemedText style={{ fontSize: 11, color: c.secondaryText, marginBottom: 16 }}>
              Remaining budget: ${faabRemaining ?? 0}
            </ThemedText>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: c.cardAlt }]}
                onPress={() => { setFaabModalPlayer(null); setFaabDropPlayerId(null); }}
              >
                <ThemedText>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: c.accent }]}
                onPress={() => {
                  const bid = Math.max(0, Math.min(parseInt(bidAmount) || 0, faabRemaining ?? 0));
                  const dropId = faabDropPlayerId ?? undefined;
                  setFaabModalPlayer(null);
                  setFaabDropPlayerId(null);
                  handleSubmitFaabBid(faabModalPlayer!, bid, dropId);
                }}
              >
                <Text style={{ color: c.accentText, fontWeight: '600' }}>Submit Bid</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
    paddingVertical: 6,
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
    marginTop: 0,
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
    width: 48,
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: "center" as const,
  },
  claimButton: {
    backgroundColor: "#D4A017",
    width: 48,
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: "center" as const,
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

  // Pending claims
  claimsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 8,
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 8,
  },
  claimsHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  claimsHeaderText: {
    fontSize: 13,
    fontWeight: "600",
  },
  claimsList: {
    marginHorizontal: 8,
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    paddingHorizontal: 12,
  },
  claimRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  // FAAB badge
  faabBadge: {
    marginHorizontal: 8,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
  },

  // FAAB bid modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  faabModal: {
    width: "80%",
    borderRadius: 12,
    padding: 20,
  },
  bidRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  bidInput: {
    width: 80,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    minWidth: 80,
  },
});
