"use client";

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

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "shadow-sm backdrop-blur-md" : "bg-transparent"
      }`}
      style={scrolled ? { backgroundColor: "var(--header-bg)" } : undefined}
    >
      <nav
        className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3.5"
        aria-label="Main navigation"
      >
        <a href="#" className="text-base font-bold tracking-tight text-t-primary">
          Franchise<span className="text-vintage-gold">Fantasy</span>
        </a>

        <div className="flex items-center gap-3">
          <button
            onClick={toggle}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-b text-t-muted transition-colors hover:text-t-primary hover:border-b-hover"
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
            className="rounded-md bg-vintage-gold px-4 py-2 text-xs font-semibold text-white transition-all hover:brightness-110 active:scale-[0.97]"
            aria-label="Get early access to the app"
          >
            Get Early Access
          </a>
        </div>
      </nav>
    </header>
  );
}
