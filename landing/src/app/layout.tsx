import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ThemeProvider from "@/components/ThemeProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Franchise Fantasy | Dynasty Fantasy Basketball",
  description:
    "The ultimate fantasy basketball app. Dynasty, keeper, and redraft leagues with live drafts, deep trades, analytics, and more.",
  metadataBase: new URL("https://franchisefantasy.co"),
  openGraph: {
    title: "Franchise Fantasy | Dynasty Fantasy Basketball",
    description: "Fantasy basketball, built different.",
    type: "website",
    url: "https://franchisefantasy.co",
  },
  twitter: {
    card: "summary_large_image",
    title: "Franchise Fantasy",
    description: "Fantasy basketball, built different.",
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
      data-theme="dark"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
