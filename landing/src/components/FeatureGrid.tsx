import { features } from "@/config/features";
import AnimatedSection from "./AnimatedSection";

export default function FeatureGrid() {
  return (
    <section
      id="features"
      className="px-6 py-16 sm:py-20"
      aria-labelledby="features-heading"
    >
      <div className="mx-auto max-w-5xl">
        <AnimatedSection className="mb-10">
          <h2
            id="features-heading"
            className="text-2xl font-bold tracking-tight text-t-primary sm:text-3xl"
          >
            The stuff other apps don&apos;t do.
          </h2>
        </AnimatedSection>

        <div className="grid gap-px overflow-hidden rounded-xl border border-b bg-b sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, i) => (
            <AnimatedSection key={feature.title} delay={i * 0.04}>
              <div className="flex h-full flex-col bg-bg p-5">
                <h3 className="mb-1.5 text-sm font-semibold text-vintage-gold">
                  {feature.title}
                </h3>
                <p className="text-[13px] leading-relaxed text-t-secondary">
                  {feature.description}
                </p>
              </div>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </section>
  );
}
