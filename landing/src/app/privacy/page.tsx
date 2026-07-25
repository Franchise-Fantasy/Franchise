import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import LegalPage from "@/components/LegalPage";
import { PRIVACY_POLICY } from "@/lib/legal";
import { breadcrumbSchema } from "@/lib/structuredData";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Franchise Fantasy collects, uses, and protects your personal information.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyRoute() {
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Privacy Policy", path: "/privacy" },
        ])}
      />
      <LegalPage title="Privacy Policy" body={PRIVACY_POLICY} />
    </>
  );
}
