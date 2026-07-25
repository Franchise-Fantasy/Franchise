import type { Metadata } from "next";
import ContentPage from "@/components/ContentPage";
import JsonLd from "@/components/JsonLd";
import { articleSchema } from "@/lib/structuredData";

const TITLE = "Dynasty vs. redraft fantasy basketball: what's the difference?";
const DESCRIPTION =
  "Dynasty and redraft are the two main fantasy basketball formats. Here's how they differ, the trade-offs of each, and how to choose the right one for your league.";

export const metadata: Metadata = {
  title: "Dynasty vs. Redraft",
  description: DESCRIPTION,
  alternates: { canonical: "/dynasty-vs-redraft" },
};

export default function DynastyVsRedraftRoute() {
  return (
    <ContentPage
      title={TITLE}
      intro="Dynasty and redraft are the two dominant ways to play fantasy basketball. They demand different skills and reward different kinds of managers. Here's how to tell them apart — and figure out which one fits your league."
      breadcrumb={[
        { name: "Home", path: "/" },
        { name: "Dynasty vs. Redraft", path: "/dynasty-vs-redraft" },
      ]}
    >
      <JsonLd
        data={articleSchema({
          headline: TITLE,
          description: DESCRIPTION,
          path: "/dynasty-vs-redraft",
          datePublished: "2026-07-25",
        })}
      />

      <article className="space-y-10 text-[15px] leading-relaxed text-t-secondary sm:text-base">
        <section>
          <h2 className="varsity mb-3 text-[15px] text-[var(--heading)]">
            What is a redraft league?
          </h2>
          <p>
            In a redraft league, every roster is wiped clean at the end of the
            season and everyone drafts from scratch the following year. Nothing
            carries over. The entire game is about winning the current season:
            you draft the best available players, work the waiver wire, and make
            in-season trades with a single championship in mind. It&apos;s
            simple to pick up, low-commitment, and forgiving — a bad season is
            forgotten the moment the next draft begins.
          </p>
        </section>

        <section>
          <h2 className="varsity mb-3 text-[15px] text-[var(--heading)]">
            What is a dynasty league?
          </h2>
          <p>
            In a{" "}
            <a
              href="/glossary"
              className="text-[var(--heading)] underline underline-offset-2"
            >
              dynasty league
            </a>
            , you keep your entire roster from year to year and build a franchise
            across many seasons. You draft rookies, develop young players, trade
            veterans and future picks, and manage your team the way a real
            General Manager would. Decisions compound: the rookie you stash today
            might anchor your roster in three years, and the pick you trade away
            now might come back to haunt you. Dynasty rewards patience, planning,
            and long-term vision.
          </p>
        </section>

        <section>
          <h2 className="varsity mb-3 text-[15px] text-[var(--heading)]">
            The key differences
          </h2>
          <ul className="space-y-2">
            <li>
              <strong className="text-t-primary">Roster continuity:</strong>{" "}
              redraft resets every year; dynasty carries your roster forward
              indefinitely.
            </li>
            <li>
              <strong className="text-t-primary">Time horizon:</strong> redraft
              is a one-season sprint; dynasty is a multi-season project where
              rebuilding is a legitimate strategy.
            </li>
            <li>
              <strong className="text-t-primary">Trades:</strong> dynasty trades
              involve future draft picks, pick swaps, and protections, so deals
              are richer and carry longer-term consequences.
            </li>
            <li>
              <strong className="text-t-primary">Rookies:</strong> in dynasty,
              incoming draft classes matter enormously, so scouting prospects and
              holding draft capital is part of the game.
            </li>
            <li>
              <strong className="text-t-primary">Commitment:</strong> redraft is
              low-commitment and beginner-friendly; dynasty asks more of you but
              gives more back.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="varsity mb-3 text-[15px] text-[var(--heading)]">
            Where do keeper leagues fit?
          </h2>
          <p>
            Keeper leagues sit between the two. You retain a limited number of
            players — your keepers — from one season to the next, but re-draft
            the rest of your roster each year. It&apos;s a gentle on-ramp to
            long-term roster management without the full commitment of dynasty.
          </p>
        </section>

        <section>
          <h2 className="varsity mb-3 text-[15px] text-[var(--heading)]">
            Which format is right for you?
          </h2>
          <p>
            Choose redraft if you want something casual, quick to learn, and
            self-contained — a fresh start every year with no long-term baggage.
            Choose dynasty if you love the strategy of building something over
            time: developing rookies, wheeling and dealing picks, and competing
            with people who stick around season after season. If you&apos;re
            unsure, a keeper league is a low-risk way to test the waters.
          </p>
        </section>

        <section>
          <h2 className="varsity mb-3 text-[15px] text-[var(--heading)]">
            How Franchise supports every format
          </h2>
          <p>
            Franchise is built dynasty-first — with real pick swaps and
            protections, multi-team trades, prospect boards, and full league
            history — but it also runs keeper and redraft leagues, so you can
            play the format your league prefers on a platform designed for the
            long game. See the{" "}
            <a
              href="/faq"
              className="text-[var(--heading)] underline underline-offset-2"
            >
              FAQ
            </a>{" "}
            for more on how it works.
          </p>
        </section>
      </article>
    </ContentPage>
  );
}
