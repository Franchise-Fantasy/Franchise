"use client";

import Image from "next/image";
import { motion } from "framer-motion";

export default function Hero() {
  return (
    <section
      className="relative flex min-h-[92vh] items-center overflow-hidden px-6 pt-28 pb-20 sm:pt-32"
      aria-labelledby="hero-heading"
    >
      {/* Embroidered F patch — large, full-color, corner anchor */}
      <div
        className="pointer-events-none absolute -right-10 -bottom-10 hidden sm:block sm:-right-16 sm:-bottom-16 lg:-right-8 lg:-bottom-16"
        aria-hidden="true"
      >
        <Image
          src="/patch-f.png"
          alt=""
          width={820}
          height={820}
          priority
          className="h-[420px] w-[420px] object-contain opacity-90 lg:h-[560px] lg:w-[560px]"
        />
      </div>

      {/* Gold top rule, centered, narrow — brand style */}
      <div
        className="pointer-events-none absolute top-[76px] left-1/2 h-[2px] w-20 -translate-x-1/2"
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
            Franchise is a dynasty-first fantasy platform built to replicate a General Manager experience. You don&apos;t just draft a team, you'll{" "}
            build, manage, and evolve{" "}
            a franchise over time, with every decision carrying weight across
            seasons.
          </p>

          <p className="mb-9 max-w-xl text-[15px] leading-[1.55] text-t-muted">
            Where traditional fantasy is seasonal, Franchise is year-round. No more external tracking.
           
            (Keeper and redraft leagues, too.)
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
