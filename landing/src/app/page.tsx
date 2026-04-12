import type { Metadata } from "next";
import Image from "next/image";

export const metadata: Metadata = {
  title: "Franchise Fantasy",
  description: "Dynasty fantasy basketball. Coming soon.",
  robots: { index: false, follow: false },
};

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-black ring-1 ring-vintage-gold/40 sm:h-24 sm:w-24">
        <Image
          src="/logo.png"
          alt="Franchise Fantasy logo"
          width={96}
          height={96}
          priority
          className="h-full w-full object-contain"
        />
      </div>
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
