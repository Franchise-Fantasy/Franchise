import type { Metadata } from "next";
import { Alfa_Slab_One, Oswald, Inter, JetBrains_Mono } from "next/font/google";
import ThemeProvider from "@/components/ThemeProvider";
import "./globals.css";

const alfaSlab = Alfa_Slab_One({
  variable: "--font-alfa-slab-one",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const oswald = Oswald({
  variable: "--font-oswald",
  weight: ["500", "700"],
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetBrains = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Franchise | Dynasty Fantasy Basketball",
  description:
    "Dynasty-first fantasy basketball. Build, manage, and evolve a franchise over time — with every decision carrying weight across seasons.",
  metadataBase: new URL("https://franchisefantasy.co"),
  openGraph: {
    title: "Franchise | Dynasty Fantasy Basketball",
    description: "Own the dynasty. Year-round fantasy basketball, built for the long game.",
    type: "website",
    url: "https://franchisefantasy.co",
  },
  twitter: {
    card: "summary_large_image",
    title: "Franchise",
    description: "Own the dynasty.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${alfaSlab.variable} ${oswald.variable} ${inter.variable} ${jetBrains.variable} antialiased`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
