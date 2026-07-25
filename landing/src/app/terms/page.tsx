import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import LegalPage from "@/components/LegalPage";
import { TERMS_OF_SERVICE } from "@/lib/legal";
import { breadcrumbSchema } from "@/lib/structuredData";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of the Franchise Fantasy app.",
  alternates: { canonical: "/terms" },
};

export default function TermsRoute() {
  return (
    <>
      <JsonLd
        data={breadcrumbSchema([
          { name: "Home", path: "/" },
          { name: "Terms of Service", path: "/terms" },
        ])}
      />
      <LegalPage title="Terms of Service" body={TERMS_OF_SERVICE} />
    </>
  );
}
