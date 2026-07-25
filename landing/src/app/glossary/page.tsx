import type { Metadata } from "next";
import ContentPage from "@/components/ContentPage";
import JsonLd from "@/components/JsonLd";
import { definedTermSetSchema } from "@/lib/structuredData";

export const metadata: Metadata = {
  title: "Dynasty Fantasy Glossary",
  description:
    "Plain-English definitions of dynasty fantasy basketball terms: dynasty, keeper, redraft, pick swaps, pick protection, trade blocks, consistency scouting, aging curves, prospect boards, draft capital, and more.",
  alternates: { canonical: "/glossary" },
};

const TERMS: { term: string; definition: string }[] = [
  {
    term: "Dynasty league",
    definition:
      "A format where you keep your entire roster from year to year and build a franchise across many seasons, rather than starting fresh each season. You draft rookies, trade veterans and picks, and manage long-term like a real GM.",
  },
  {
    term: "Keeper league",
    definition:
      "A middle ground between dynasty and redraft: you retain a limited number of players (your 'keepers') from one season to the next, but re-draft the rest of your roster each year.",
  },
  {
    term: "Redraft league",
    definition:
      "A single-season format where every roster is wiped and everyone drafts from scratch each year. There is no long-term roster building — the goal is to win this season.",
  },
  {
    term: "Pick swap",
    definition:
      "The right to exchange draft-pick positions with another team, traded separately from the pick itself. For example, acquiring the right to take the better (or worse) of two teams' picks in a given round.",
  },
  {
    term: "Pick protection",
    definition:
      "A condition attached to a traded draft pick that shields it if it lands in a certain range — commonly a top-N protection, where the pick only conveys if it falls outside the top N selections.",
  },
  {
    term: "Trade block",
    definition:
      "A place to publicly signal which players you're willing to move. Interested managers can express interest privately, and deals start from there instead of spamming the league chat.",
  },
  {
    term: "Consistency scouting",
    definition:
      "Evaluating whether a player produces steadily or swings wildly game to game, rather than judging by season averages alone. In Franchise it includes per-category breakdowns useful for head-to-head leagues.",
  },
  {
    term: "Aging curve",
    definition:
      "A projection of how a player's production is likely to rise or decline with age. Franchise builds aging curves around your league's specific scoring settings so they reflect what actually matters to your team.",
  },
  {
    term: "Prospect board",
    definition:
      "Your personal ranking of upcoming draft-eligible players. You can build it years in advance, compare it against staff consensus, and use it to prepare for rookie drafts.",
  },
  {
    term: "Draft capital",
    definition:
      "The collective value of the future draft picks a team owns. Tracking draft capital by year and by team helps you gauge rebuild potential and structure trades.",
  },
  {
    term: "Taxi squad",
    definition:
      "A reserve area for stashing young or developing players who don't count against your active roster limits, so you can hold prospects while they develop.",
  },
  {
    term: "Head-to-head (H2H)",
    definition:
      "A scoring format where your team faces one opponent each week and the winner is decided by that matchup, either by total points or by winning the majority of statistical categories.",
  },
  {
    term: "Landing spot odds",
    definition:
      "The probability that an incoming prospect ends up with a given team, used to anticipate where rookie talent will land and how it affects dynasty value.",
  },
];

export default function GlossaryRoute() {
  return (
    <ContentPage
      title="Dynasty fantasy glossary"
      intro="The vocabulary of dynasty fantasy basketball, defined in plain English — from pick swaps and protections to aging curves and taxi squads."
      breadcrumb={[
        { name: "Home", path: "/" },
        { name: "Glossary", path: "/glossary" },
      ]}
    >
      <JsonLd
        data={definedTermSetSchema(
          "Dynasty Fantasy Glossary",
          "/glossary",
          TERMS,
        )}
      />
      <dl className="border-t border-b-strong">
        {TERMS.map((t) => (
          <div key={t.term} className="border-b border-b-strong py-7">
            <dt className="varsity mb-3 text-[15px] text-[var(--heading)]">
              {t.term}
            </dt>
            <dd className="text-[15px] leading-relaxed text-t-secondary">
              {t.definition}
            </dd>
          </div>
        ))}
      </dl>
    </ContentPage>
  );
}
