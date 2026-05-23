import AnimatedSection from "./AnimatedSection";

export default function ImportSection() {
  return (
    <section
      className="px-6 py-20 sm:py-28"
      aria-labelledby="import-heading"
      style={{ background: "var(--bg-raised)" }}
    >
      <AnimatedSection>
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div>
            <h2
              id="import-heading"
              className="display text-4xl leading-[0.98] text-[var(--heading)] sm:text-5xl lg:text-6xl"
            >
              You don&apos;t have to start over.
            </h2>
          </div>

          <div>
            <p className="mb-8 text-[15px] leading-relaxed text-t-secondary sm:text-base">
              The biggest reason people don&apos;t switch is because rebuilding
              a league from scratch feels like a second job. So we made it
              easy — import your rosters, settings, draft history, and records.
              Your league picks up right where it left off.
            </p>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                "Rosters",
                "Scoring settings",
                "Draft history",
                "League records",
              ].map((label, i) => (
                <div
                  key={label}
                  className="border-t border-b-strong pt-3"
                >
                  <span className="mono-stat block text-[10px] text-t-faint">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="varsity mt-1.5 block text-[11px] text-[var(--heading)]">
                    {label}
                  </span>
                </div>
              ))}
            </div>

            <p className="mono-stat mt-8 text-[12px] text-t-muted">
              Up and running in minutes, not hours.
            </p>
          </div>
        </div>
      </AnimatedSection>
    </section>
  );
}
