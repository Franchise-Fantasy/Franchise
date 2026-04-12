export interface Feature {
  title: string;
  description: string;
}

export const features: Feature[] = [
  {
    title: "Real pick swaps & protections",
    description:
      "Trade swap rights separately from the pick itself. Set top-N protections with a slider. The way the NBA does it.",
  },
  {
    title: "Multi-team trades",
    description:
      "Not just two-team swaps. Build deals across multiple teams and see how the math shakes out for everyone involved.",
  },
  {
    title: "A trade block that works",
    description:
      "Post who's available, see who's interested, start a deal from there. No more fishing in group chat.",
  },
  {
    title: "Consistency scouting",
    description:
      "Know if a guy is steady or a rollercoaster before you trade for him. Per-category breakdowns for H2H leagues.",
  },
  {
    title: "Roster age that means something",
    description:
      "Your team's age weighted by who's actually producing — not just birthdays on a spreadsheet.",
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
      "Commissioner veto or league vote — your league decides",
      "Full trade history so nothing gets lost",
    ],
    imagePlaceholder: "Trade Center",
  },
  {
    title: "Numbers you'll actually look at.",
    lead: "Not just season averages. How does he play on back-to-backs? Does he bounce back after bad games? Is his usage trending up or are his minutes slipping? The stuff that changes your decision, not just confirms it.",
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
