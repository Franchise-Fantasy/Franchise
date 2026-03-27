export interface PlayerNewsArticle {
  id: string;
  title: string;
  description: string | null;
  link: string;
  source: 'rotowire' | 'fantasypros';
  published_at: string;
  has_minutes_restriction: boolean;
  return_estimate: string | null;
}
