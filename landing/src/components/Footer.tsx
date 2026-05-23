"use client";

import Image from "next/image";
import { useTheme } from "./ThemeProvider";

export default function Footer() {
  const { theme } = useTheme();
  const patch = theme === "dark" ? "/patch-wordmark-mono.png" : "/patch-wordmark.png";

  return (
    <footer
      className="px-6 py-14"
      style={{ borderTop: "1px solid var(--border)" }}
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 sm:flex-row sm:justify-between">
        <Image
          src={patch}
          alt="Franchise"
          width={480}
          height={160}
          className="h-16 w-auto sm:h-20"
        />

        <nav
          className="flex items-center gap-6 text-[11px]"
          aria-label="Footer"
        >
          <a
            href="/privacy"
            className="varsity text-t-muted transition-colors hover:text-[var(--heading)]"
          >
            Privacy
          </a>
          <a
            href="/terms"
            className="varsity text-t-muted transition-colors hover:text-[var(--heading)]"
          >
            Terms
          </a>
        </nav>

        <p className="mono-stat text-[11px] text-t-faint">
          &copy; {new Date().getFullYear()} Franchise Fantasy
        </p>
      </div>
    </footer>
  );
}
