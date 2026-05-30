import Image from "next/image";
import AnimatedSection from "./AnimatedSection";
import { showcases } from "@/config/features";

type Palette = {
  bg: string;
  text: string;
  textMuted: string;
  bullet: string;
};

const palettes: Palette[] = [
  {
    // Turf Green — Trade Center
    bg: "var(--turf-green)",
    text: "var(--ecru)",
    textMuted: "rgba(233, 226, 203, 0.70)",
    bullet: "var(--hardwood)",
  },
  {
    // Merlot — Analytics
    bg: "var(--merlot)",
    text: "var(--ecru)",
    textMuted: "rgba(233, 226, 203, 0.68)",
    bullet: "var(--vintage-gold)",
  },
  {
    // Vintage Gold — Dynasty
    bg: "var(--vintage-gold)",
    text: "var(--ink)",
    textMuted: "rgba(20, 16, 16, 0.70)",
    bullet: "var(--merlot)",
  },
];

export default function FeatureShowcase() {
  return (
    <section
      className="px-6 py-20 sm:py-28"
      aria-label="Feature deep dives"
    >
      <div className="mx-auto max-w-6xl space-y-8">
        {showcases.map((showcase, i) => {
          const p = palettes[i % palettes.length];
          const reversed = i % 2 !== 0;

          return (
            <AnimatedSection key={showcase.title}>
              <div
                className="relative overflow-hidden"
                style={{ background: p.bg, color: p.text }}
              >
                {/* F-winged watermark — kept faint so the copy stays legible,
                    extra-faint on mobile where text overlaps it more. */}
                <div
                  className="pointer-events-none absolute -right-10 -bottom-16 opacity-[0.06] sm:opacity-[0.09]"
                  aria-hidden="true"
                >
                  <Image
                    src="/winged-light.png"
                    alt=""
                    width={560}
                    height={560}
                    className="h-[380px] w-[380px] object-contain invert brightness-0 lg:h-[460px] lg:w-[460px]"
                  />
                </div>

                <div
                  className={`relative z-10 flex flex-col gap-10 p-8 sm:p-12 lg:p-16 ${
                    reversed ? "lg:flex-row-reverse" : "lg:flex-row"
                  } lg:items-start lg:gap-16`}
                >
                  <div className="lg:w-7/12">
                    <h3 className="display mb-6 text-4xl leading-[0.98] sm:text-5xl lg:text-6xl">
                      {showcase.title}
                    </h3>
                    <p
                      className="mb-8 max-w-xl text-[15px] leading-relaxed sm:text-base"
                      style={{ color: p.textMuted }}
                    >
                      {showcase.lead}
                    </p>
                  </div>

                  <div className="lg:w-5/12 lg:pt-20">
                    <ul className="space-y-3" role="list">
                      {showcase.bullets.map((bullet) => (
                        <li
                          key={bullet}
                          className="flex items-start gap-3 text-[14px] leading-relaxed"
                          style={{ color: p.textMuted }}
                        >
                          <span
                            className="mt-[9px] h-[2px] w-4 shrink-0"
                            style={{ background: p.bullet }}
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
