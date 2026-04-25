/**
 * Centralized React Query key factory.
 * Every query key in the app should be defined here so that
 * invalidation, cancellation, and cache reads stay consistent.
 */
export const queryKeys = {
  // ── League ───────────────────────────────────────────────
  league: (leagueId: string) => ["league", leagueId] as const,
  leagueDeadline: (leagueId: string) => ["leagueDeadline", leagueId] as const,
  leagueDraft: (leagueId: string) => ["leagueDraft", leagueId] as const,
  leagueSchedule: (leagueId: string) => ["leagueSchedule", leagueId] as const,
  leagueScoring: (leagueId: string) => ["leagueScoring", leagueId] as const,
  leagueScoringType: (leagueId: string) =>
    ["leagueScoringType", leagueId] as const,
  leagueRosterConfig: (leagueId: string) =>
    ["leagueRosterConfig", leagueId] as const,
  leagueRosterStats: (leagueId: string) =>
    ["leagueRosterStats", leagueId] as const,
  leagueTeams: (leagueId: string) => ["leagueTeams", leagueId] as const,
  leagueTradeConditions: (leagueId: string) =>
    ["leagueTradeConditions", leagueId] as const,
  leagueTradeSettings: (leagueId: string) =>
    ["leagueTradeSettings", leagueId] as const,
  leagueWaivers: (leagueId: string) => ["leagueWaivers", leagueId] as const,
  leagueOwnership: (leagueId: string) =>
    ["leagueOwnership", leagueId] as const,
  publicLeagues: () => ["public-leagues"] as const,
  unclaimedTeams: (leagueId: string) =>
    ["unclaimed-teams", leagueId] as const,
  userLeagues: (userId: string) => ["user-leagues", userId] as const,
  isCommissioner: (id: string) => ["isCommissioner", id] as const,

  // ── Standings / Season ───────────────────────────────────
  standings: (leagueId: string) => ["standings", leagueId] as const,
  standingsH2h: (leagueId: string) => ["standings-h2h", leagueId] as const,
  remainingGames: (leagueId: string) =>
    ["remaining-games", leagueId] as const,
  futureMatchups: (leagueId: string) =>
    ["future-matchups", leagueId] as const,
  seasonStatus: (leagueId: string) => ["seasonStatus", leagueId] as const,
  seasonHistory: (leagueId: string) => ["seasonHistory", leagueId] as const,
  championshipCheck: (leagueId: string, season: number) =>
    ["championship-check", leagueId, season] as const,
  leagueTeamsRecord: (leagueId: string) =>
    ["leagueTeamsRecord", leagueId] as const,

  // ── League History ───────────────────────────────────────
  leagueChampions: (leagueId: string) =>
    ["leagueChampions", leagueId] as const,
  seasonStandings: (leagueId: string) =>
    ["seasonStandings", leagueId] as const,
  allTimeRecords: (leagueId: string) => ["allTimeRecords", leagueId] as const,
  headToHead: (leagueId: string) => ["headToHead", leagueId] as const,
  draftHistory: (leagueId: string) => ["draftHistory", leagueId] as const,
  bracketHistory: (leagueId: string) => ["bracketHistory", leagueId] as const,

  // ── Team / Roster ────────────────────────────────────────
  teamRoster: (teamId: string, ...rest: (string | undefined)[]) =>
    ["teamRoster", teamId, ...rest] as const,
  teamRosterStats: (leagueId: string, teamId: string) =>
    ["teamRosterStats", leagueId, teamId] as const,
  teamRosterForTrade: (teamId: string, leagueId: string) =>
    ["teamRosterForTrade", teamId, leagueId] as const,
  teamName: (teamId: string) => ["teamName", teamId] as const,
  viewTeamRoster: (teamId: string, date: string) =>
    ["viewTeamRoster", teamId, date] as const,
  rosterInfo: (leagueId: string, teamId: string) =>
    ["rosterInfo", leagueId, teamId] as const,
  rosterStartDate: (teamId: string) => ["rosterStartDate", teamId] as const,
  rosterCompliance: (leagueId: string, teamId: string) =>
    ["rosterCompliance", leagueId, teamId] as const,
  currentMatchupWeek: (leagueId: string, today: string) =>
    ["currentMatchupWeek", leagueId, today] as const,
  dayGameStats: (teamId: string, date: string) =>
    ["dayGameStats", teamId, date] as const,
  daySchedule: (date: string) => ["daySchedule", date] as const,
  todaySchedule: (date: string) => ["todaySchedule", date] as const,
  weeklyAdds: (leagueId: string, teamId: string) =>
    ["weeklyAdds", leagueId, teamId] as const,
  weeklyAcqLimit: (leagueId: string) =>
    ["weeklyAcqLimit", leagueId] as const,
  lockedTradeAssets: (teamId: string, leagueId: string) =>
    ["lockedTradeAssets", teamId, leagueId] as const,
  pendingDropPlayerIds: (teamId: string, leagueId: string) =>
    ["pendingDropPlayerIds", teamId, leagueId] as const,
  myTeamInfo: (teamId: string) => ["myTeamInfo", teamId] as const,
  teamLogos: (leagueId: string) => ["teamLogos", leagueId] as const,
  teamGamesPlayed: (nbaTeam: string) =>
    ["teamGamesPlayed", nbaTeam] as const,
  importedTeamStatus: (leagueId: string) =>
    ["imported-team-status", leagueId] as const,
  importedTeams: (leagueId: string) => ["imported-teams", leagueId] as const,

  // ── Matchup / Scoreboard ─────────────────────────────────
  matchupDetail: (matchupId: string) =>
    ["matchupDetail", matchupId] as const,
  matchupTeams: (matchupId: string, date: string) =>
    ["matchupTeams", matchupId, date] as const,
  matchupResult: (leagueId: string, teamId: string) =>
    ["matchupResult", leagueId, teamId] as const,
  matchupById: (matchupId: string, date: string) =>
    ["matchupById", matchupId, date] as const,
  matchupSeeds: (leagueId: string, weekNumber: number) =>
    ["matchupSeeds", leagueId, weekNumber] as const,
  weekMatchup: (leagueId: string, ...rest: (string | undefined)[]) =>
    ["weekMatchup", leagueId, ...rest] as const,
  weekAllMatchups: (weekId: string) => ["weekAllMatchups", weekId] as const,
  scoreboardMatchups: (weekId: string) =>
    ["scoreboardMatchups", weekId] as const,
  futureSchedule: (date: string) => ["futureSchedule", date] as const,
  teamScheduleMatchups: (leagueId: string, teamId: string) =>
    ["teamScheduleMatchups", leagueId, teamId] as const,
  weekScores: (leagueId: string, scheduleId: string) =>
    ["weekScores", leagueId, scheduleId] as const,

  // ── Playoffs ─────────────────────────────────────────────
  playoffBracket: (leagueId: string, season: number) =>
    ["playoffBracket", leagueId, season] as const,
  playoffSeeds: (
    leagueId: string,
    season: string,
    round: number | undefined
  ) => ["playoffSeeds", leagueId, season, round] as const,
  seedPicks: (
    leagueId: string,
    season: number,
    round: number | undefined
  ) => ["seedPicks", leagueId, season, round] as const,
  pendingSeedPick: (leagueId: string, teamId: string, season: number) =>
    ["pendingSeedPick", leagueId, teamId, season] as const,
  bracketTeamData: (leagueId: string) =>
    ["bracketTeamData", leagueId] as const,
  playoffLiveScores: (leagueId: string, season: number, scheduleIds: string[]) =>
    ["playoffLiveScores", leagueId, season, scheduleIds] as const,

  // ── Player ───────────────────────────────────────────────
  playerSeasonStats: (excludePlayerIds: string[]) =>
    ["playerSeasonStats", excludePlayerIds] as const,
  playerGameLog: (playerId: string) => ["playerGameLog", playerId] as const,
  playerHistoricalStats: (playerId: string) =>
    ["playerHistoricalStats", playerId] as const,
  playerHistory: (leagueId: string, playerId: string) =>
    ["playerHistory", leagueId, playerId] as const,
  playerNews: (playerId: string) => ["playerNews", playerId] as const,
  playerOwnership: (
    leagueId: string,
    teamId: string,
    playerId: string | undefined
  ) => ["playerOwnership", leagueId, teamId, playerId] as const,
  playerLeagueOwnership: (
    leagueId: string,
    playerId: string | undefined
  ) => ["playerLeagueOwnership", leagueId, playerId] as const,
  playerOnWaivers: (leagueId: string, playerId: string | undefined) =>
    ["playerOnWaivers", leagueId, playerId] as const,
  upcomingGames: (nbaTeam: string) => ["upcomingGames", nbaTeam] as const,
  teamNews: (mode: string, playerIds: string[]) =>
    ["teamNews", mode, playerIds] as const,
  watchlist: (userId: string) => ["watchlist", userId] as const,

  // ── News ─────────────────────────────────────────────────
  newsRosterIds: (leagueId: string, teamId: string) =>
    ["newsRosterIds", leagueId, teamId] as const,
  newsMatchupIds: (leagueId: string, teamId: string) =>
    ["newsMatchupIds", leagueId, teamId] as const,

  // ── Free Agents / Waivers ────────────────────────────────
  allPlayers: (leagueId: string) => ["allPlayers", leagueId] as const,
  availablePlayers: (leagueId: string) =>
    ["availablePlayers", leagueId] as const,
  hasActiveDraft: (leagueId: string) =>
    ["hasActiveDraft", leagueId] as const,
  freeAgentRosterInfo: (leagueId: string, teamId: string) =>
    ["freeAgentRosterInfo", leagueId, teamId] as const,
  faabRemaining: (leagueId: string, teamId: string) =>
    ["faabRemaining", leagueId, teamId] as const,
  waiverOrder: (leagueId: string) => ["waiverOrder", leagueId] as const,
  pendingClaims: (leagueId: string, teamId: string) =>
    ["pendingClaims", leagueId, teamId] as const,
  recentGameLogs: (leagueId: string) =>
    ["recentGameLogs", leagueId] as const,

  // ── Draft ────────────────────────────────────────────────
  draftRoomInit: (draftId: string) => ["draftRoomInit", draftId] as const,
  draftState: (draftId: string) => ["draftState", draftId] as const,
  draftOrder: (draftId: string, ...rest: (number | undefined)[]) =>
    ["draftOrder", draftId, ...rest] as const,
  draftQueue: (draftId: string, teamId: string) =>
    ["draftQueue", draftId, teamId] as const,
  draftHub: (leagueId: string) => ["draftHub", leagueId] as const,
  offseasonLotteryOrder: (leagueId: string, step: string) =>
    ["offseasonLotteryOrder", leagueId, step] as const,
  draftRecentGameLogs: (leagueId: string) =>
    ["draftRecentGameLogs", leagueId] as const,
  draftHistoricalStats: (leagueId: string) =>
    ["draftHistoricalStats", leagueId] as const,
  activeDraft: (leagueId: string) => ["activeDraft", leagueId] as const,
  leagueDraftOrder: (leagueId: string) =>
    ["leagueDraftOrder", leagueId] as const,
  draftSlotsAssigned: (draftId: string) =>
    ["draftSlotsAssigned", draftId] as const,
  rookieDraft: (leagueId: string, season: number) =>
    ["rookieDraft", leagueId, season] as const,
  seasonDraft: (leagueId: string, season: number) =>
    ["seasonDraft", leagueId, season] as const,

  // ── Keepers ──────────────────────────────────────────────
  keeperRoster: (leagueId: string, teamId: string) =>
    ["keeperRoster", leagueId, teamId] as const,
  keeperDeclarations: (
    leagueId: string,
    teamId: string | "all",
    season: number
  ) => ["keeperDeclarations", leagueId, teamId, season] as const,

  // ── Trades ───────────────────────────────────────────────
  tradeProposals: (leagueId: string) =>
    ["tradeProposals", leagueId] as const,
  tradeVotes: (proposalId: string) => ["tradeVotes", proposalId] as const,
  tradablePicks: (
    teamId: string,
    leagueId: string,
    enabled: boolean | undefined
  ) => ["tradablePicks", teamId, leagueId, enabled] as const,
  pendingTradeCount: (teamId: string, leagueId: string) =>
    ["pendingTradeCount", teamId, leagueId] as const,
  tradeBlock: (leagueId: string) => ["tradeBlock", leagueId] as const,
  tradePlayerStats: (playerIds: string[]) =>
    ["tradePlayerStats", playerIds] as const,
  tradeRosterCheck: (
    teamId: string,
    leagueId: string,
    proposalId: string
  ) => ["tradeRosterCheck", teamId, leagueId, proposalId] as const,
  tradeRosterWarnings: (leagueId: string, ...rest: string[]) =>
    ["tradeRosterWarnings", leagueId, ...rest] as const,
  tradeByTransaction: (transactionId: string) =>
    ["tradeByTransaction", transactionId] as const,
  dropPickerRoster: (teamId: string, leagueId: string, proposalId: string) =>
    ["dropPickerRoster", teamId, leagueId, proposalId] as const,

  // ── Chat ─────────────────────────────────────────────────
  conversations: (leagueId: string) =>
    ["conversations", leagueId] as const,
  chatUnread: (leagueId: string) => ["chatUnread", leagueId] as const,
  messages: (conversationId: string) =>
    ["messages", conversationId] as const,
  reactions: (conversationId: string, ...rest: (string[] | undefined)[]) =>
    ["reactions", conversationId, ...rest] as const,
  pinnedMessages: (conversationId: string) =>
    ["pinnedMessages", conversationId] as const,
  conversationMeta: (conversationId: string) =>
    ["conversationMeta", conversationId] as const,
  leagueConversationId: (leagueId: string) =>
    ["leagueConversationId", leagueId] as const,
  canLeak: (proposalId: string) => ["canLeak", proposalId] as const,
  tradeConversation: (proposalId: string) =>
    ["tradeConversation", proposalId] as const,

  // ── Polls / Surveys ──────────────────────────────────────
  poll: (pollId: string) => ["poll", pollId] as const,
  pollResults: (pollId: string) => ["pollResults", pollId] as const,
  survey: (surveyId: string) => ["survey", surveyId] as const,
  surveyStatus: (surveyId: string, teamId: string) =>
    ["surveyStatus", surveyId, teamId] as const,
  surveyResponseCount: (surveyId: string) =>
    ["surveyResponseCount", surveyId] as const,
  surveyResults: (surveyId: string) => ["surveyResults", surveyId] as const,
  surveyCompletion: (surveyId: string) =>
    ["surveyCompletion", surveyId] as const,

  // ── Transactions / Announcements ─────────────────────────
  transactions: (leagueId: string, typeFilter: string) =>
    ["transactions", leagueId, typeFilter] as const,
  announcements: (leagueId: string) =>
    ["announcements", leagueId] as const,
  latestAnnouncement: (leagueId: string) =>
    ["latestAnnouncement", leagueId] as const,

  // ── Subscription / Payments ──────────────────────────────
  userSubscription: (userId: string) =>
    ["userSubscription", userId] as const,
  leagueSubscription: (leagueId: string) =>
    ["leagueSubscription", leagueId] as const,
  rcOfferings: () => ["rcOfferings"] as const,
  paymentLedger: (leagueId: string, season: number) =>
    ["paymentLedger", leagueId, season] as const,

  // ── Commissioner ─────────────────────────────────────────
  commishPickConditions: (leagueId: string) =>
    ["commishPickConditions", leagueId] as const,
  commishAllPicks: (leagueId: string) =>
    ["commishAllPicks", leagueId] as const,
  commishSwaps: (leagueId: string) => ["commishSwaps", leagueId] as const,
  commishTeamRoster: (teamId: string | undefined, leagueId: string) =>
    ["commishTeamRoster", teamId, leagueId] as const,
  commishFreeAgents: (leagueId: string) =>
    ["commishFreeAgents", leagueId] as const,
  commishRosterMove: (teamId: string | undefined, leagueId: string) =>
    ["commishRosterMove", teamId, leagueId] as const,

  // ── Lottery ──────────────────────────────────────────────
  lotteryResults: (
    leagueId: string,
    season: string | undefined
  ) => ["lotteryResults", leagueId, season] as const,

  // ── Offseason ────────────────────────────────────────────
  champion: (leagueId: string) => ["champion", leagueId] as const,

  // ── CMS (test) ───────────────────────────────────────────
  contentfulTypes: () => ["contentful", "types"] as const,
  contentfulEntries: (contentType: string) =>
    ["contentful", "entries", contentType] as const,

  // ── Prospects ───────────────────────────────────────────
  prospects: (draftYear: string) => ["prospects", draftYear] as const,
  prospect: (entryId: string) => ["prospect", entryId] as const,
  prospectPlayers: (leagueId: string) =>
    ["prospectPlayers", leagueId] as const,
  prospectBoard: (userId: string) => ["prospectBoard", userId] as const,
  prospectNews: (playerId: string) => ["prospectNews", playerId] as const,
} as const;
