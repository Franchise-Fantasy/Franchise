import type { Metadata } from "next";
import localFont from "next/font/local";
import JsonLd from "@/components/JsonLd";
import ThemeProvider from "@/components/ThemeProvider";
import {
  PUBLISHER,
  SITE_DESCRIPTION,
  SITE_NAME,
  TWITTER_HANDLE,
} from "@/config/site";
import { organizationSchema, websiteSchema } from "@/lib/structuredData";
import "./globals.css";

// Brand faces, self-hosted from the app's own font set so the web matches the
// product. Each face is declared at its file's real weight, so `font-weight`
// never triggers faux-bold synthesis. Roles: Desporm = display/headlines,
// StonerSport = varsity labels, JUST Sans = body, SpaceMono = stat numerals.
const desporm = localFont({
  variable: "--font-desporm",
  src: "../fonts/Desporm-Regular.ttf",
  weight: "400",
  display: "swap",
  fallback: ["Georgia", "serif"],
});

const stonerSport = localFont({
  variable: "--font-stoner",
  src: "../fonts/StonerSport-Regular.ttf",
  weight: "700",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

const justSans = localFont({
  variable: "--font-just-sans",
  src: [
    { path: "../fonts/JUSTSans-Regular.ttf", weight: "400", style: "normal" },
    { path: "../fonts/JUSTSans-Medium.ttf", weight: "500", style: "normal" },
    { path: "../fonts/JUSTSans-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../fonts/JUSTSans-Bold.ttf", weight: "700", style: "normal" },
  ],
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

const spaceMono = localFont({
  variable: "--font-space-mono",
  src: "../fonts/SpaceMono-Regular.ttf",
  weight: "400",
  display: "swap",
  fallback: ["ui-monospace", "monospace"],
});

export const metadata: Metadata = {
  title: {
    default: "Franchise | Dynasty Fantasy Basketball",
    template: "%s | Franchise",
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL("https://franchisefantasy.co"),
  applicationName: SITE_NAME,
  keywords: [
    "dynasty fantasy basketball",
    "fantasy basketball app",
    "dynasty league",
    "keeper league",
    "fantasy basketball trades",
    "NBA fantasy",
    "WNBA fantasy",
    "fantasy GM",
    "year-round fantasy",
    "league import",
  ],
  authors: [{ name: PUBLISHER }],
  creator: PUBLISHER,
  publisher: PUBLISHER,
  category: "sports",
  formatDetection: { telephone: false, email: false, address: false },
  alternates: { canonical: "/" },
  openGraph: {
    title: "Franchise | Dynasty Fantasy Basketball",
    description: "Own the dynasty. Year-round fantasy basketball, built for the long game.",
    type: "website",
    url: "https://franchisefantasy.co",
    siteName: SITE_NAME,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Franchise",
    description: "Own the dynasty.",
    site: TWITTER_HANDLE,
    creator: TWITTER_HANDLE,
  },
  // TODO(launch): add `verification: { google: '<token>' }` once a Google Search
  // Console property exists, and `itunes` / `appLinks` once there are store IDs.
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
      className={`${desporm.variable} ${stonerSport.variable} ${justSans.variable} ${spaceMono.variable} antialiased`}
      suppressHydrationWarning
    >
      <body>
        <JsonLd data={organizationSchema()} />
        <JsonLd data={websiteSchema()} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
