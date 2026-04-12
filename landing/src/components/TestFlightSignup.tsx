"use client";

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
      className="px-6 py-16 sm:py-20"
      style={{ background: "var(--signup-gradient)" }}
      aria-labelledby="signup-heading"
    >
      <div className="mx-auto max-w-md text-center">
        <h2
          id="signup-heading"
          className="mb-3 text-2xl font-bold tracking-tight text-white sm:text-3xl"
        >
          Get in early.
        </h2>
        <p className="mb-8 text-sm text-ecru/60">
          Join the TestFlight waitlist. We&apos;ll send you a link when
          it&apos;s your turn.
        </p>

        {status === "success" ? (
          <div
            className="rounded-lg border border-turf-green/30 bg-turf-green/10 p-6"
            role="status"
            aria-live="polite"
          >
            <p className="text-sm font-semibold text-ecru">You&apos;re in.</p>
            <p className="mt-1 text-xs text-cream/50">
              We&apos;ll email you when it&apos;s time.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-2.5 sm:flex-row"
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
              className="flex-1 rounded-lg border border-ecru/15 bg-black/40 px-4 py-3 text-sm text-ecru placeholder-cream/25 outline-none transition-colors focus:border-vintage-gold/50"
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
              className="rounded-lg bg-vintage-gold px-6 py-3 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
            >
              {status === "loading" ? "..." : "Join"}
            </button>
          </form>
        )}

        {status === "duplicate" && (
          <p
            id="signup-error"
            className="mt-3 text-xs text-vintage-gold"
            role="alert"
          >
            Already on the list. We&apos;ll be in touch.
          </p>
        )}
        {status === "error" && (
          <p id="signup-error" className="mt-3 text-xs text-umber" role="alert">
            Something went wrong. Try again.
          </p>
        )}

        <p className="mt-5 text-[11px] text-cream/20">
          No spam. Only Franchise Fantasy updates.
        </p>
      </div>
    </section>
  );
}
