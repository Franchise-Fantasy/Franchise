// Barrel for the League History hooks. The implementation is split by data
// source under hooks/leagueHistory/ (season results, matchup records, draft
// history, bracket history); this file preserves the original import path so
// consumers can keep importing from '@/hooks/useLeagueHistory'.

export type {
  ChampionEntry,
  TeamSeasonRow,
  RecordEntry,
  H2HRecord,
  MatchupRow,
  ScheduleRow,
  H2HData,
  DraftSummary,
  DraftHistoryPick,
  BracketSlotHistory,
  BracketHistoryData,
} from './leagueHistory/types';

export { useChampions, useSeasonStandings } from './leagueHistory/seasonResults';
export { useAllTimeRecords, useHeadToHead } from './leagueHistory/matchupRecords';
export { useDraftHistory } from './leagueHistory/draftHistory';
export { useBracketHistory } from './leagueHistory/bracketHistory';
