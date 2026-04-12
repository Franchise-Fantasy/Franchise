"use client";

import { motion } from "framer-motion";

export default function Hero() {
  return (
    <section
      className="relative flex min-h-[85vh] flex-col items-center justify-center overflow-hidden px-6 pt-20 text-center"
      style={{ background: "var(--hero-gradient)" }}
      aria-labelledby="hero-heading"
    >
      {/* Subtle gold accent line */}
      <div
        className="pointer-events-none absolute top-0 left-1/2 h-[1px] w-1/3 -translate-x-1/2"
        style={{
          background: `linear-gradient(90deg, transparent, var(--gold-accent-line) 50%, transparent)`,
        }}
        aria-hidden="true"
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
        className="relative z-10 max-w-2xl"
      >
        <h1
          id="hero-heading"
          className="mb-5 text-4xl font-bold leading-[1.1] tracking-tight text-white sm:text-5xl lg:text-6xl"
        >
          Build a franchise.
          <br />
          <span className="text-vintage-gold">Not just a roster.</span>
        </h1>

        <p className="mx-auto mb-4 max-w-lg text-base leading-relaxed text-ecru/70 sm:text-lg">
          Dynasty fantasy basketball with pick swap rights, multi-team trade
          fairness, prospect scouting, and analytics that go deeper than box
          scores.
        </p>

        <p className="mb-8 text-sm text-cream/40">
          Keeper and redraft leagues too.
        </p>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <a
            href="#signup"
            className="rounded-lg bg-vintage-gold px-7 py-3 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
          >
            Get Early Access
          </a>
          <a
            href="#features"
            className="rounded-lg border border-ecru/15 px-7 py-3 text-sm font-semibold text-ecru/70 transition-all hover:border-ecru/30 hover:text-ecru"
          >
            See What&apos;s Different
          </a>
        </div>
      </motion.div>

      {/* Bottom fade */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-32"
        style={{
          background: `linear-gradient(to bottom, transparent, var(--bg))`,
        }}
        aria-hidden="true"
      />
    </section>
  );
}
