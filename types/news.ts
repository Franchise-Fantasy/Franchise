export interface PlayerNewsArticle {
  id: string;
  title: string;
  description: string | null;
  link: string;
  source: 'rotowire' | 'cbssports';
  published_at: string;
  has_minutes_restriction: boolean;
  return_estimate: string | null;
  /** Populated by useTeamNews for the News screen (not by usePlayerNews). */
  mentioned_players?: { player_id: string; name: string; external_id_nba: string | null }[];
}
