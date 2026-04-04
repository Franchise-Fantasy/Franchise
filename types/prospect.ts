import type { RichTextDocument } from './cms';

/** Minimal prospect data for list cards (Hub screen). */
export interface ProspectCardData {
  /** players.id UUID */
  playerId: string;
  /** Contentful sys.id */
  contentfulEntryId: string;
  name: string;
  position: string;
  school: string;
  classYear?: string;
  photoUrl?: string;
  dynastyValueScore: number;
  projectedDraftYear: string;
  recruitingRank?: number;
  lastUpdated?: string;
}

/** Full prospect data for the profile screen. */
export interface ProspectProfileData extends ProspectCardData {
  height?: string;
  weight?: string;
  hometown?: string;
  scoutingReport?: RichTextDocument;
  landingSpotAnalysis?: RichTextDocument;
  projectedTeams: LandingSpot[];
  youtubeId?: string;
  hudlUrl?: string;
  xEmbedUrl?: string;
}

export interface LandingSpot {
  team: string;
  odds: string;
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
