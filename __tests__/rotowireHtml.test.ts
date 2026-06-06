import { parseRotowireNewsHtml } from '../supabase/functions/poll-news/rotowire-html';

// Two cards mirroring RotoWire's real /basketball/news.php markup: one injured,
// one not. Each card opens with `<div class="news-update">` (or ` is-injured`),
// with `news-update__*` inner elements. The body lives in `news-update__news`;
// the paywalled `news-update__analysis` ("Subscribe now") must NOT leak in.
const SAMPLE = `
<div class="page-wrapper">
<div class="news-update is-injured">
  <div class="news-update__top">
    <img class="news-update__logo" src="https://content.rotowire.com/100NYK.png" alt="NYK">
    <div class="news-update__playerhead"><a class="news-update__player-link" href="/basketball/player/mitchell-robinson-4426">Mitchell Robinson</a><a target="_blank" class="news-update__headline" href="/basketball/headlines/mitchell-robinson-injury-probable-for-game-2-530883">Probable for Game 2</a></div>
  </div>
  <div class="news-update__meta"><div><b class="news-update__pos">C</b>New York Knicks</div><div class="news-update__inj">Finger</div></div>
  <div class="news-update__main">
    <div class="news-update__timestamp">June 4, 2026</div>
    <div class="news-update__news">Robinson (finger) is <a href="https://example.com/report.pdf">probable</a> for Game 2 of the NBA Finals versus San Antonio on Friday.</div>
    <div class="news-update__analysis"><b>ANALYSIS</b><br><a href="/subscribe/">Subscribe now</a> to instantly reveal our take on this news.</div>
  </div>
</div>
<div class="news-update">
  <div class="news-update__top">
    <img class="news-update__logo" src="https://content.rotowire.com/100SAS.png" alt="SAS">
    <div class="news-update__playerhead"><a class="news-update__player-link" href="/basketball/player/victor-wembanyama-5809">Victor Wembanyama</a><a target="_blank" class="news-update__headline" href="/basketball/headlines/victor-wembanyama-news-struggles-with-shot-in-game-1-loss-530878">Struggles with shot in Game 1 loss</a></div>
  </div>
  <div class="news-update__meta"><div><b class="news-update__pos">C</b>San Antonio Spurs</div></div>
  <div class="news-update__main">
    <div class="news-update__timestamp">June 3, 2026</div>
    <div class="news-update__news">Wembanyama finished with 26 points, 12 rebounds and three blocks over 38 minutes during Wednesday's Game 1 loss.</div>
    <div class="news-update__analysis"><b>ANALYSIS</b><br><a href="/subscribe/">Subscribe now</a></div>
  </div>
</div>
</div>`;

describe('parseRotowireNewsHtml', () => {
  it('parses every news card', () => {
    expect(parseRotowireNewsHtml(SAMPLE, 'rotowire')).toHaveLength(2);
  });

  it('reconstructs the RSS-style title and the nba<id> guid', () => {
    const [first, second] = parseRotowireNewsHtml(SAMPLE, 'rotowire');
    // guid scheme MUST match the RSS parser (`nba` + trailing article id) so
    // external_id dedup treats RSS and HTML copies of the same blurb as one row.
    expect(first.guid).toBe('nba530883');
    expect(first.title).toBe('Mitchell Robinson: Probable for Game 2');
    expect(second.guid).toBe('nba530878');
    expect(second.title).toBe('Victor Wembanyama: Struggles with shot in Game 1 loss');
  });

  it('stores the absolute canonical headline link and date-only timestamp', () => {
    const [first] = parseRotowireNewsHtml(SAMPLE, 'rotowire');
    expect(first.link).toBe(
      'https://www.rotowire.com/basketball/headlines/mitchell-robinson-injury-probable-for-game-2-530883',
    );
    expect(first.pubDate).toBe('June 4, 2026');
    expect(first.source).toBe('rotowire');
  });

  it('keeps the blurb body but drops the paywalled analysis and inline markup', () => {
    const [first] = parseRotowireNewsHtml(SAMPLE, 'rotowire');
    expect(first.description).toBe(
      'Robinson (finger) is probable for Game 2 of the NBA Finals versus San Antonio on Friday.',
    );
    expect(first.description).not.toMatch(/Subscribe now/i);
    expect(first.description).not.toMatch(/<a /i);
  });

  it('skips malformed cards with no headline anchor', () => {
    const broken = `
<div class="news-update">
  <div class="news-update__top"><div class="news-update__playerhead"><a class="news-update__player-link" href="/x">Nobody</a></div></div>
</div>`;
    expect(parseRotowireNewsHtml(broken, 'rotowire')).toHaveLength(0);
  });

  it('returns nothing for a page with no news cards', () => {
    expect(parseRotowireNewsHtml('<html><body>no news here</body></html>', 'rotowire')).toEqual([]);
  });
});
