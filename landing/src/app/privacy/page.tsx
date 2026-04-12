import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";
import { PRIVACY_POLICY } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy | Franchise Fantasy",
  description:
    "How Franchise Fantasy collects, uses, and protects your personal information.",
};

export default function PrivacyRoute() {
  return <LegalPage title="Privacy Policy" body={PRIVACY_POLICY} />;
}
