import { Hero } from "@/components/homepage/Hero";
import { ProblemSection } from "@/components/homepage/ProblemSection";
import { WorkflowSection } from "@/components/homepage/WorkflowSection";
import { CollectionsWorkspace } from "@/components/homepage/CollectionsWorkspace";
import { WhoItIsFor } from "@/components/homepage/WhoItIsFor";
import { FeatureGrid } from "@/components/homepage/FeatureGrid";
import { TrustSection } from "@/components/homepage/TrustSection";
import { PricingSection } from "@/components/homepage/PricingSection";
import { FinalCTA } from "@/components/homepage/FinalCTA";
import { Footer } from "@/components/homepage/Footer";
import Link from "next/link";
import { Button } from "@/components/ui/button";

function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#12061F]/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2" aria-label="DeraLedger home">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#7B2FF7] text-sm font-bold text-white shadow-[0_0_10px_rgba(123,47,247,0.4)]">
            D
          </div>
          <span className="text-lg font-bold text-white tracking-tight">DeraLedger</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8">
          <a href="#workflow" className="text-sm font-medium text-white/60 hover:text-white transition-colors">How it works</a>
          <a href="#features" className="text-sm font-medium text-white/60 hover:text-white transition-colors">Features</a>
          <a href="#pricing" className="text-sm font-medium text-white/60 hover:text-white transition-colors">Pricing</a>
        </nav>

        {/* Auth Actions */}
        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden sm:block">
            <Button variant="ghost" className="text-sm font-semibold text-white/80 hover:text-white hover:bg-white/5">
              Log in
            </Button>
          </Link>
          <Link href="/onboarding">
            <Button className="h-9 px-4 text-sm font-bold bg-white text-[#12061F] hover:bg-gray-200 shadow-[0_0_10px_rgba(255,255,255,0.2)]">
              Get Started
            </Button>
          </Link>
        </div>

      </div>
    </header>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#12061F] text-white selection:bg-[#7B2FF7]/30">
      <Header />
      
      <main className="pt-16">
        <Hero />
        <ProblemSection />
        <div id="workflow">
          <WorkflowSection />
        </div>
        <CollectionsWorkspace />
        <WhoItIsFor />
        <div id="features">
          <FeatureGrid />
        </div>
        <TrustSection />
        <div id="pricing">
          <PricingSection />
        </div>
        <FinalCTA />
      </main>

      <Footer />
    </div>
  );
}
