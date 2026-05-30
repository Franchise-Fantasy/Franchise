"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useTheme } from "./ThemeProvider";

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const wordmark = theme === "dark" ? "/patch-wordmark-mono.png" : "/patch-wordmark.png";

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "backdrop-blur-md shadow-[0_1px_0_var(--border)]" : "bg-transparent"
      }`}
      style={scrolled ? { backgroundColor: "var(--header-bg)" } : undefined}
    >
      <nav
        className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5"
        aria-label="Main navigation"
      >
        <a href="#" aria-label="Franchise — home" className="flex items-center">
          <Image
            src={wordmark}
            alt="Franchise"
            width={480}
            height={160}
            priority
            className="h-9 w-auto sm:h-11"
          />
        </a>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={toggle}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-b text-t-muted transition-colors hover:text-t-primary hover:border-b-strong"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          <a
            href="#signup"
            className="varsity rounded-md bg-[var(--turf-green)] px-4 py-2.5 text-[11px] text-ecru transition-all hover:bg-[var(--merlot)] active:scale-[0.97]"
            aria-label="Join the waitlist"
          >
            Join Waitlist
          </a>
        </div>
      </nav>
    </header>
  );
}
