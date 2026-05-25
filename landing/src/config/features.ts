export interface Feature {
  title: string;
  description: string;
  isFinale?: boolean;
}

export const features: Feature[] = [
  {
    title: "Real pick swaps & protections",
    description:
      "Trade swap rights separately from the pick itself. Set top-N protections. ",
  },
  {
    title: "Multi-team trades",
    description:
      "Build deals across multiple teams, replicating trade deadline and blockbuster deals.",
  },
  {
    title: "A trade block that works",
    description:
      "Post who's available, see who's interested, start a deal from there. No more spamming the group chat.",
  },
  {
    title: "Consistency scouting",
    description:
      "Know if a player is steady or a rollercoaster before you trade for them. Per-category breakdowns for H2H leagues.",
  },
  {
    title: "Your own prospect board",
    description:
      "Rank rookies your way, then see where you agree and disagree with staff consensus. Prep for your draft years out.",
  },
  {
    title: "Payments built in",
    description:
      "Track who's paid, nudge who hasn't. Venmo and Cash App links ready to go. Commissioners, you're welcome.",
  },
  {
    title: "Commissioner tools that save time",
    description:
      "Force moves, league announcements, division assignments, and trade reversals — without digging through menus.",
  },
  {
    title: "…and plenty more to discover",
    description:
      "Weighted roster age, category heatmaps, aging curves, draft capital views, lottery reveals, league records, and much more.",
    isFinale: true,
  },
];

export interface Showcase {
  title: string;
  lead: string;
  bullets: string[];
  imagePlaceholder: string;
}

export const showcases: Showcase[] = [
  {
    title: "Trading the way you've always wanted to.",
    lead: "Counter-offers that go back and forth. Pick protections you can actually adjust. Multi-team deals that don't require a group text and a spreadsheet. And if you want to stir the pot — leak a rumor into chat before the deal goes through.",
    bullets: [
      "Live fairness score so nobody gets fleeced quietly",
      "Trade block with private interest tracking",
      "Full trade history so nothing gets lost",
    ],
    imagePlaceholder: "Trade Center",
  },
  {
    title: "Numbers you'll actually look at.",
    lead: "Not just season averages. How does they play on back-to-backs? Does they bounce back after bad games? Is their usage trending up or are their minutes slipping? The stuff that changes your decision, not just confirms it.",
    bullets: [
      "Home/away and back-to-back splits with real context",
      "Category strengths ranked against the whole league",
      "Aging curves built around your scoring settings",
      "Adjustable game window — compare last 10 to season-long",
    ],
    imagePlaceholder: "Analytics",
  },
  {
    title: "Built for leagues that come back every year.",
    lead: "Keeper declarations with real-time progress so your commissioner isn't chasing people down. A draft lottery with an actual animated reveal. Prospect boards you can build years before a class is draft-eligible. This isn't a one-season app.",
    bullets: [
      "Full league history with trophy case and records",
      "Head-to-head matrix across every season",
      "Draft capital view by year and by team",
      "Landing spot odds for incoming prospects",
    ],
    imagePlaceholder: "Dynasty",
  },
];
