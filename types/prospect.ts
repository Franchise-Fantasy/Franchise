import type { RichTextDocument } from './cms';

/** Minimal prospect data for list cards (Hub screen). */
export interface ProspectCardData {
  /** players.id UUID — resolved from the slug bridge; '' until an entry is published/synced. */
  playerId: string;
  /** Contentful sys.id */
  contentfulEntryId: string;
  /** Join key with the rankings pipeline (prospect_board.player_slug). */
  slug: string;
  name: string;
  position: string;
  school: string;
  classYear?: string;
  photoUrl?: string;
  /** Draft class (integer year) — the ProspectProfile.draftYear field. */
  draftYear?: number;
  /** Blended consensus rank within the class (prospect_board.display_rank). */
  displayRank?: number;
  /** Week-over-week movement: >0 rose, <0 fell, 0 steady, null = new to the board. */
  rankChange?: number | null;
  /** Actual current NBA team once drafted (prospect_board.team, tracks trades). */
  currentTeam?: string;
  /** prospect_rankings.updated_at — drives the "Updated …" freshness eyebrow. */
  lastUpdated?: string;
}

/** Full prospect data for the profile screen. */
export interface ProspectProfileData extends ProspectCardData {
  height?: string;
  weight?: string;
  hometown?: string;
  scoutingReport?: RichTextDocument;
  youtubeId?: string;
  /** Last 3 game lines (player_last_games), newest first; empty when uncovered. */
  recentGames: RecentGame[];
}

/** A recent game line from the ESPN stats sync (recent_games / player_last_games). */
export interface RecentGame {
  competition: 'college' | 'summer-league' | 'nba';
  gameDate: string;
  opponent: string | null;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  fg: string | null;
  fg3: string | null;
  ft: string | null;
}

/** A row from the prospect_boards table. */
export interface ProspectBoardRow {
  id: string;
  user_id: string;
  player_id: string;
  rank: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A prospect news article. */
export interface ProspectNewsItem {
  id: string;
  title: string;
  description: string | null;
  link: string;
  source: string;
  published_at: string;
}
