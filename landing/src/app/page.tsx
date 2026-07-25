import type { Metadata } from "next";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import FeatureGrid from "@/components/FeatureGrid";
import FeatureShowcase from "@/components/FeatureShowcase";
import ImportSection from "@/components/ImportSection";
import TestFlightSignup from "@/components/TestFlightSignup";
import Footer from "@/components/Footer";
import JsonLd from "@/components/JsonLd";
import { mobileApplicationSchema } from "@/lib/structuredData";

export const metadata: Metadata = {
  // The root layout's title.template does NOT apply to the page in its own
  // segment, so set the brand explicitly here to keep it in the homepage title.
  title: { absolute: "Franchise | Own the Dynasty" },
  description:
    "Dynasty-first fantasy basketball. Build, manage, and evolve a franchise over time. Year-round engagement, lower barrier to entry.",
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <>
      <JsonLd data={mobileApplicationSchema()} />
      <Header />
      <main>
        <Hero />
        <FeatureGrid />
        <FeatureShowcase />
        <ImportSection />
        <TestFlightSignup />
      </main>
      <Footer />
    </>
  );
}
