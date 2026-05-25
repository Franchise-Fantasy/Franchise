"use client";

import Image from "next/image";
import { useState } from "react";
import { getSupabase } from "@/lib/supabase";

type Status = "idle" | "loading" | "success" | "error" | "duplicate";

export default function TestFlightSignup() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");

    const { error } = await getSupabase()
      .from("waitlist_signups")
      .insert({ email: email.trim().toLowerCase(), source: "landing" });

    if (error) {
      if (error.code === "23505") {
        setStatus("duplicate");
      } else {
        setStatus("error");
      }
      return;
    }

    setStatus("success");
    setEmail("");
  }

  return (
    <section
      id="signup"
      className="relative overflow-hidden px-6 py-24 sm:py-32"
      style={{ background: "var(--merlot)", color: "var(--ecru)" }}
      aria-labelledby="signup-heading"
    >
      {/* Winged F watermark */}
      <div
        className="pointer-events-none absolute -left-24 top-1/2 -translate-y-1/2 opacity-[0.08]"
        aria-hidden="true"
      >
        <Image
          src="/winged-light.png"
          alt=""
          width={640}
          height={640}
          className="h-[440px] w-[440px] object-contain invert brightness-0"
        />
      </div>

      <div className="relative z-10 mx-auto max-w-2xl text-center">
        <h2
          id="signup-heading"
          className="display mb-5 text-4xl leading-[0.98] sm:text-5xl lg:text-6xl"
        >
          Get in early.
        </h2>

        <p className="mx-auto mb-10 max-w-md text-[15px] leading-relaxed" style={{ color: "rgba(233, 226, 203, 0.72)" }}>
          Join the waitlist. We&apos;ll send you a link when
          it&apos;s your turn.
        </p>

        {status === "success" ? (
          <div
            className="mx-auto max-w-md border border-[var(--vintage-gold)]/40 bg-[rgba(181,123,48,0.10)] p-6"
            role="status"
            aria-live="polite"
          >
            <p className="varsity text-xs text-[var(--vintage-gold)]">
              You&apos;re in.
            </p>
            <p className="mt-2 text-[13px]" style={{ color: "rgba(233, 226, 203, 0.65)" }}>
              We&apos;ll email you when it&apos;s time.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="mx-auto flex max-w-md flex-col gap-2.5 sm:flex-row"
          >
            <label htmlFor="email-input" className="sr-only">
              Email address
            </label>
            <input
              id="email-input"
              type="email"
              required
              placeholder="you@email.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (status !== "idle" && status !== "loading")
                  setStatus("idle");
              }}
              className="flex-1 rounded-md border border-[rgba(233,226,203,0.22)] bg-[rgba(14,16,13,0.35)] px-4 py-3 text-sm text-ecru placeholder-[rgba(233,226,203,0.35)] outline-none transition-colors focus:border-[var(--vintage-gold)]"
              disabled={status === "loading"}
              aria-describedby={
                status === "error" || status === "duplicate"
                  ? "signup-error"
                  : undefined
              }
            />
            <button
              type="submit"
              disabled={status === "loading"}
              className="varsity rounded-md bg-[var(--vintage-gold)] px-6 py-3 text-xs text-[var(--ink)] transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
            >
              {status === "loading" ? "..." : "Join"}
            </button>
          </form>
        )}

        {status === "duplicate" && (
          <p
            id="signup-error"
            className="mt-4 text-xs text-[var(--vintage-gold)]"
            role="alert"
          >
            Already on the list. We&apos;ll be in touch.
          </p>
        )}
        {status === "error" && (
          <p
            id="signup-error"
            className="mt-4 text-xs text-[var(--cream)]"
            role="alert"
          >
            Something went wrong. Try again.
          </p>
        )}

        <p className="mono-stat mt-6 text-[11px]" style={{ color: "rgba(233, 226, 203, 0.40)" }}>
          No spam. Only Franchise updates.
        </p>
      </div>
    </section>
  );
}
