import type { Metadata } from "next";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import FeatureGrid from "@/components/FeatureGrid";
import FeatureShowcase from "@/components/FeatureShowcase";
import ImportSection from "@/components/ImportSection";
import TestFlightSignup from "@/components/TestFlightSignup";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Franchise | Own the Dynasty",
  description:
    "Dynasty-first fantasy basketball. Build, manage, and evolve a franchise over time. Year-round engagement, lower barrier to entry.",
};

export default function Home() {
  return (
    <>
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
