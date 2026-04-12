import AnimatedSection from "./AnimatedSection";

export default function ImportSection() {
  return (
    <section className="px-6 py-16 sm:py-20" aria-labelledby="import-heading">
      <AnimatedSection>
        <div
          className="mx-auto max-w-3xl rounded-xl border border-b p-8 text-center sm:p-12"
          style={{ background: "var(--import-gradient)" }}
        >
          <h2
            id="import-heading"
            className="mb-3 text-2xl font-bold tracking-tight text-t-primary sm:text-3xl"
          >
            You don&apos;t have to start over.
          </h2>
          <p className="mx-auto mb-6 max-w-xl text-sm leading-relaxed text-t-secondary">
            The biggest reason people don&apos;t switch is because rebuilding a
            league from scratch feels like a second job. So we made it easy —
            import your rosters, settings, draft history, and records. Your
            league picks up right where it left off.
          </p>
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-[13px] text-t-muted">
            <span>Rosters &amp; contracts</span>
            <span className="text-t-faint">|</span>
            <span>Scoring settings</span>
            <span className="text-t-faint">|</span>
            <span>Draft history</span>
            <span className="text-t-faint">|</span>
            <span>League records</span>
          </div>
          <p className="mt-6 text-xs text-t-faint">
            Up and running in minutes, not hours.
          </p>
        </div>
      </AnimatedSection>
    </section>
  );
}
