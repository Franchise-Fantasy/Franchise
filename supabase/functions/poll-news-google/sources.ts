// Allowlist of news sources we trust for Google News results.
// Google News returns articles from thousands of outlets — many low-quality,
// SEO-spam, or gambling-affiliate sites. We keep this list tight to maintain
// signal quality similar to RotoWire's editorial bar.
//
// The map keys are normalized lowercase outlet names as they appear in the
// Google News <source> tag or after the trailing " - Source" suffix in titles.
// Values are the display string we store in player_news.source (lowercase to
// match the existing 'rotowire' convention — the UI uppercases on render).

export const SOURCE_ALLOWLIST: Record<string, string> = {
  // National sports media
  'espn': 'espn',
  'espn.com': 'espn',
  'the athletic': 'the athletic',
  'theathletic.com': 'the athletic',
  'yahoo sports': 'yahoo sports',
  'yahoo': 'yahoo sports',
  'sports.yahoo.com': 'yahoo sports',
  'bleacher report': 'bleacher report',
  'bleacherreport.com': 'bleacher report',
  'cbs sports': 'cbs sports',
  'cbssports.com': 'cbs sports',
  'nbc sports': 'nbc sports',
  'nbcsports.com': 'nbc sports',
  'sports illustrated': 'sports illustrated',
  'si.com': 'sports illustrated',
  'fox sports': 'fox sports',
  'foxsports.com': 'fox sports',
  'usa today': 'usa today',
  'usatoday.com': 'usa today',
  'sporting news': 'sporting news',
  'sportingnews.com': 'sporting news',
  'the ringer': 'the ringer',
  'theringer.com': 'the ringer',

  // League/team official
  'nba.com': 'nba.com',
  'wnba.com': 'wnba.com',
  'mlb.com': 'mlb.com',
  'nfl.com': 'nfl.com',

  // Major national papers with strong sports desks
  'the new york times': 'nyt',
  'nytimes.com': 'nyt',
  'the washington post': 'washington post',
  'washingtonpost.com': 'washington post',
  'los angeles times': 'la times',
  'latimes.com': 'la times',
  'the boston globe': 'boston globe',
  'bostonglobe.com': 'boston globe',

  // Wire services
  'associated press': 'ap',
  'apnews.com': 'ap',
  'reuters': 'reuters',
  'reuters.com': 'reuters',

  // Beat/local reporting that fantasy users actually care about
  'the philadelphia inquirer': 'philly inquirer',
  'inquirer.com': 'philly inquirer',
  'new york post': 'ny post',
  'nypost.com': 'ny post',
  'chicago tribune': 'chicago tribune',
  'chicagotribune.com': 'chicago tribune',
  'the dallas morning news': 'dallas morning news',
  'dallasnews.com': 'dallas morning news',
  'denver post': 'denver post',
  'denverpost.com': 'denver post',
  'the oklahoman': 'the oklahoman',
  'oklahoman.com': 'the oklahoman',
  'tampa bay times': 'tampa bay times',
  'tampabay.com': 'tampa bay times',
  'the athletic - bay area': 'the athletic',
  'arizona sports': 'arizona sports',
  'arizonasports.com': 'arizona sports',
  'sb nation': 'sb nation',
  'sbnation.com': 'sb nation',
};

/** Look up a source by name OR by domain. Returns display name if allowed, else null. */
export function lookupSource(rawNameOrDomain: string): string | null {
  if (!rawNameOrDomain) return null;
  const key = rawNameOrDomain.trim().toLowerCase();
  return SOURCE_ALLOWLIST[key] ?? null;
}
