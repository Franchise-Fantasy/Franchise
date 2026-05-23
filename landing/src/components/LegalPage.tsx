"use client";

import Image from "next/image";
import Link from "next/link";
import { useTheme } from "./ThemeProvider";

type LegalPageProps = {
  title: string;
  body: string;
};

export default function LegalPage({ title, body }: LegalPageProps) {
  const { theme } = useTheme();
  const wordmark = theme === "dark" ? "/wordmark-white.png" : "/wordmark-green.png";

  return (
    <main className="min-h-screen">
      <header
        className="px-6 py-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <nav
          className="mx-auto flex max-w-3xl items-center justify-between"
          aria-label="Main navigation"
        >
          <Link href="/" aria-label="Franchise — home">
            <Image
              src={wordmark}
              alt="Franchise"
              width={120}
              height={32}
              className="h-6 w-auto"
            />
          </Link>
          <div className="flex items-center gap-5 text-[11px]">
            <Link
              href="/privacy"
              className="varsity text-t-muted transition-colors hover:text-[var(--heading)]"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="varsity text-t-muted transition-colors hover:text-[var(--heading)]"
            >
              Terms
            </Link>
          </div>
        </nav>
      </header>
      <section className="mx-auto max-w-3xl px-6 pt-16 pb-20">
        <h1 className="display mb-8 text-4xl leading-[0.98] text-[var(--heading)] sm:text-5xl">
          {title}
        </h1>
        <article
          className="whitespace-pre-wrap text-[15px] leading-relaxed text-t-secondary sm:text-base"
          aria-label={title}
        >
          {body}
        </article>
      </section>
    </main>
  );
}
