import type { Metadata } from "next";
import LegalPage from "@/components/LegalPage";
import { TERMS_OF_SERVICE } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service | Franchise Fantasy",
  description: "The terms that govern your use of the Franchise Fantasy app.",
};

export default function TermsRoute() {
  return <LegalPage title="Terms of Service" body={TERMS_OF_SERVICE} />;
}
