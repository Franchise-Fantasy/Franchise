import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Franchise Fantasy",
  description: "Dynasty fantasy basketball. Coming soon.",
  robots: { index: false, follow: false },
};

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="text-3xl font-bold tracking-tight text-t-primary sm:text-5xl">
        Franchise<span className="text-vintage-gold">Fantasy</span>
      </h1>
      <p className="mt-4 max-w-md text-sm text-t-muted sm:text-base">
        Dynasty fantasy basketball, built different. Coming soon.
      </p>
      <nav className="mt-10 flex gap-6 text-xs text-t-muted" aria-label="Legal">
        <a href="/privacy" className="transition-colors hover:text-t-primary">
          Privacy Policy
        </a>
        <a href="/terms" className="transition-colors hover:text-t-primary">
          Terms of Service
        </a>
      </nav>
    </main>
  );
}
