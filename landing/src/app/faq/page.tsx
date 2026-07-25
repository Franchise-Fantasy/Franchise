import type { Metadata } from "next";
import ContentPage from "@/components/ContentPage";
import JsonLd from "@/components/JsonLd";
import { faqSchema } from "@/lib/structuredData";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers about Franchise: what dynasty fantasy basketball is, how it compares to ESPN, Yahoo, and Sleeper, importing your league, supported sports, and platform availability.",
  alternates: { canonical: "/faq" },
};

// Single source for both the visible Q&A and the FAQPage JSON-LD — Google
// requires marked-up questions to be visible on the page, so these must match.
const FAQS: { question: string; answer: string }[] = [
  {
    question: "What is dynasty fantasy basketball?",
    answer:
      "Dynasty fantasy basketball is a format where you keep your entire roster from season to season instead of redrafting every year. You act like a real General Manager — drafting rookies, trading players and future picks, and building a franchise over many seasons rather than chasing a single-year championship. Every decision carries weight across seasons, which is what makes it feel like running a real front office.",
  },
  {
    question: "How is Franchise different from ESPN, Yahoo, or Sleeper?",
    answer:
      "Franchise is dynasty-first and year-round rather than built around a single season. It centralizes the things dynasty players normally piece together across spreadsheets, group chats, and side tools: real pick swaps and top-N pick protections, multi-team trades, a trade block with private interest tracking, consistency scouting with per-category breakdowns, prospect boards you can build years ahead, full league history with records and a head-to-head matrix, and commissioner tools like forced moves and trade reversals.",
  },
  {
    question: "Can I import my existing league?",
    answer:
      "Yes. You can import your rosters, scoring settings, draft history, and league records so your league picks up right where it left off instead of starting over from scratch. Most leagues are up and running in minutes.",
  },
  {
    question: "What sports does Franchise support?",
    answer:
      "NBA and WNBA are live. NFL, NHL, and MLB are in progress. Franchise is built as a multi-sport platform, so support expands over time.",
  },
  {
    question: "Does Franchise support keeper and redraft leagues too?",
    answer:
      "Yes. While Franchise is designed dynasty-first, it also supports keeper and redraft leagues, so you can run the format your league prefers.",
  },
  {
    question: "What platforms is Franchise available on?",
    answer:
      "Franchise is a mobile app launching on iOS and Android at the same time. It's currently in private beta — join the waitlist to get access.",
  },
  {
    question: "How do I get access?",
    answer:
      "Franchise is in private beta right now. Join the waitlist on the homepage and you'll be notified when a spot opens up.",
  },
  {
    question: "What tools does Franchise give commissioners?",
    answer:
      "Commissioners can force roster moves, post league announcements, manage division assignments, and reverse trades without digging through menus. Payments are built in too — track who's paid, nudge who hasn't, with Venmo and Cash App links ready to go.",
  },
];

export default function FaqRoute() {
  return (
    <ContentPage
      title="Frequently asked questions"
      intro="Everything you need to know about dynasty fantasy basketball and how Franchise works."
      breadcrumb={[
        { name: "Home", path: "/" },
        { name: "FAQ", path: "/faq" },
      ]}
    >
      <JsonLd data={faqSchema(FAQS)} />
      <div className="border-t border-b-strong">
        {FAQS.map((faq) => (
          <div
            key={faq.question}
            className="border-b border-b-strong py-7"
          >
            <h2 className="varsity mb-3 text-[15px] text-[var(--heading)]">
              {faq.question}
            </h2>
            <p className="text-[15px] leading-relaxed text-t-secondary">
              {faq.answer}
            </p>
          </div>
        ))}
      </div>
    </ContentPage>
  );
}
