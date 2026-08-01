"use client";

import Image from "next/image";
import { motion } from "framer-motion";

export default function Hero() {
  return (
    <section
      className="relative flex min-h-[92svh] items-center overflow-hidden px-6 pt-28 pb-20 sm:pt-32"
      aria-labelledby="hero-heading"
    >
      {/* Embroidered F patch — large, full-color, corner anchor.
          It only goes full-strength from xl up, because that is the first width
          where the patch clears the max-w-xl copy column. Below xl it stays a
          faded watermark; at full opacity it ran straight through the headline
          and the sub-copy on tablets and small laptops. */}
      <div
        className="pointer-events-none absolute -right-20 -bottom-16 sm:-right-16 xl:-right-8"
        aria-hidden="true"
      >
        <Image
          src="/patch-f.png"
          alt=""
          width={512}
          height={480}
          priority
          className="h-[340px] w-[340px] object-contain opacity-[0.10] sm:h-[420px] sm:w-[420px] xl:h-[500px] xl:w-[500px] xl:opacity-90 2xl:h-[560px] 2xl:w-[560px]"
        />
      </div>

      {/* Gold top rule, centered, narrow — brand style. Sits below the fixed
          header (84px tall on mobile, 108px from sm up) so it doesn't read as a
          stray line running through the nav. */}
      <div
        className="pointer-events-none absolute top-[96px] left-1/2 h-[2px] w-20 -translate-x-1/2 sm:top-[124px]"
        style={{ background: "var(--rule-gold)" }}
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto w-full max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="max-w-3xl"
        >
          <h1
            id="hero-heading"
            className="display mb-6 text-[17vw] text-[var(--heading)] sm:text-[11vw] lg:text-[140px]"
          >
            Build a
            <br />
            Franchise.
          </h1>

          <p className="mb-4 max-w-xl text-[17px] leading-[1.55] text-t-primary sm:text-lg">
            Franchise is a dynasty-first fantasy platform built to replicate a General Manager experience. You don&apos;t just draft a team, you&apos;ll{" "}
            build, manage, and evolve{" "}
            a franchise over time, with every decision carrying weight across
            seasons.
          </p>

          <p className="mb-9 max-w-xl text-[15px] leading-[1.55] text-t-muted">
            Where traditional fantasy is seasonal, Franchise is year-round. No more external tracking.
           
            Keeper and redraft leagues, too.
          </p>

          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <a
              href="#signup"
              className="varsity rounded-md bg-[var(--turf-green)] px-7 py-3.5 text-xs text-ecru transition-all hover:bg-[var(--merlot)] active:scale-[0.97]"
            >
              Join the Waitlist
            </a>
            <a
              href="#features"
              className="varsity rounded-md border border-b-strong px-7 py-3.5 text-xs text-t-primary transition-all hover:border-[var(--heading)] hover:text-[var(--heading)]"
            >
              See What&apos;s Different
            </a>
          </div>


        </motion.div>
      </div>
    </section>
  );
}
