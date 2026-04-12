import { showcases } from "@/config/features";
import AnimatedSection from "./AnimatedSection";

export default function FeatureShowcase() {
  return (
    <section className="px-6 py-16 sm:py-20" aria-label="Feature deep dives">
      <div className="mx-auto max-w-5xl space-y-12">
        {showcases.map((showcase, i) => {
          const reversed = i % 2 !== 0;
          return (
            <AnimatedSection key={showcase.title}>
              <div
                className="overflow-hidden rounded-xl border border-b"
                style={{
                  background: `linear-gradient(135deg, var(--showcase-accent-${i + 1}) 0%, var(--bg-raised) 40%, var(--bg-raised) 100%)`,
                }}
              >
                <div
                  className={`flex flex-col gap-0 lg:items-stretch ${
                    reversed ? "lg:flex-row-reverse" : "lg:flex-row"
                  }`}
                >
                  {/* Screenshot placeholder */}
                  <div className="flex w-full items-center justify-center border-b border-b p-8 lg:w-5/12 lg:border-b-0 lg:border-r">
                    <div className="flex aspect-[4/3] w-full items-center justify-center rounded-lg border border-dashed border-b">
                      <span className="text-xs text-t-faint">
                        {showcase.imagePlaceholder}
                      </span>
                    </div>
                  </div>

                  {/* Text */}
                  <div className="w-full p-6 sm:p-8 lg:w-7/12">
                    <h3 className="mb-3 text-xl font-bold tracking-tight text-t-primary sm:text-2xl">
                      {showcase.title}
                    </h3>
                    <p className="mb-5 text-sm leading-relaxed text-t-secondary">
                      {showcase.lead}
                    </p>
                    <ul className="space-y-2" role="list">
                      {showcase.bullets.map((bullet) => (
                        <li
                          key={bullet}
                          className="flex items-start gap-2.5 text-[13px] text-t-muted"
                        >
                          <span
                            className="mt-1 h-1 w-1 shrink-0 rounded-full bg-vintage-gold/60"
                            aria-hidden="true"
                          />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </AnimatedSection>
          );
        })}
      </div>
    </section>
  );
}
