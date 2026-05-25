"use client";

import { motion } from "framer-motion";
import AnimatedSection from "./AnimatedSection";
import { features } from "@/config/features";

const gridVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.05,
    },
  },
};

const tileVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export default function FeatureGrid() {
  return (
    <section
      id="features"
      className="relative px-6 py-20 sm:py-28"
      aria-labelledby="features-heading"
      style={{ background: "var(--bg-raised)" }}
    >
      <div className="mx-auto max-w-6xl">
        <AnimatedSection className="mb-12 max-w-3xl">
          <h2
            id="features-heading"
            className="display text-5xl text-[var(--heading)] sm:text-6xl lg:text-7xl"
          >
            Built for the
            <br />
            long game.
          </h2>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-t-secondary">
            We centralize what dynasty players piece together across
            spreadsheets, group chats, and side tools, in one cohesive system.
          </p>
        </AnimatedSection>

        <motion.div
          className="grid gap-px overflow-hidden border border-b-strong sm:grid-cols-2 lg:grid-cols-4"
          style={{ background: "var(--border-strong)" }}
          variants={gridVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-60px" }}
        >
          {features.map((feature, i) => (
            <motion.div
              key={feature.title}
              variants={tileVariants}
              className="group flex h-full flex-col p-6 transition-colors"
              style={{ background: "var(--bg)" }}
            >
              <div className="mb-4 flex items-center gap-2">
                <span className="mono-stat text-[10px] text-t-faint">
                  {feature.isFinale
                    ? "++"
                    : String(i + 1).padStart(2, "0")}
                </span>
                <span
                  className="h-[1px] flex-1"
                  style={{ background: "var(--rule-gold)", opacity: 0.5 }}
                  aria-hidden="true"
                />
              </div>
              <h3 className="varsity mb-2 text-[13px] text-[var(--heading)]">
                {feature.title}
              </h3>
              <p className="text-[14px] leading-relaxed text-t-secondary">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
