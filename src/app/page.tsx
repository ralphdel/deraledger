import { Hero } from "@/components/homepage/Hero";
import { TrustBar } from "@/components/homepage/TrustBar";
import { ProblemSection } from "@/components/homepage/ProblemSection";
import { FeatureGrid } from "@/components/homepage/FeatureGrid";
import { CollectionsWorkspace } from "@/components/homepage/CollectionsWorkspace";
import { TeamOperations } from "@/components/homepage/TeamOperations";
import { WhoItIsFor } from "@/components/homepage/WhoItIsFor";
import { TrustSection } from "@/components/homepage/TrustSection";
import { PricingSection } from "@/components/homepage/PricingSection";
import { FinalCTA } from "@/components/homepage/FinalCTA";
import { Footer } from "@/components/homepage/Footer";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DeraLedgerLogo } from "@/components/ui/deraledger-logo";
import { ThemeToggle } from "@/components/theme-toggle";

function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/70 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5" aria-label="DeraLedger home">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-[0_0_10px_rgba(255,255,255,0.1)]">
            <DeraLedgerLogo className="h-5 w-5" />
          </div>
          <span className="text-base font-bold text-foreground tracking-tight">DeraLedger</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8">
          <a href="#workflow" className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">How it works</a>
          <a href="#features" className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">Features</a>
          <a href="#pricing" className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">Pricing</a>
          <Link href="/dispute-resolution" className="text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors">Disputes</Link>
        </nav>

        {/* Auth Actions */}
        <div className="flex items-center gap-3">
          <ThemeToggle className="text-muted-foreground hover:text-foreground hover:bg-accent" />
          <Link href="/login" className="hidden sm:block">
            <Button variant="ghost" className="h-9 px-4 text-xs font-bold uppercase tracking-wider text-foreground hover:bg-accent">
              Log in
            </Button>
          </Link>
          <Link href="/onboarding">
            <Button className="h-9 px-4 text-xs font-bold uppercase tracking-wider shadow-[0_8px_24px_rgba(105,65,198,0.18)] border-0">
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
    <div className="min-h-screen w-full overflow-x-hidden bg-background text-foreground selection:bg-primary/20 antialiased font-sans">
      <Header />
      
      <main className="pt-16 overflow-x-hidden w-full">
        {/* Section 1 — Hero */}
        <Hero />

        {/* Section 2 — Trust Bar */}
        <TrustBar />

        {/* Section 3 — Operations Overview */}
        <ProblemSection />

        {/* Section 4 — Product Capabilities (Light theme) */}
        <FeatureGrid />

        {/* Section 5 — Workspace Showcase */}
        <CollectionsWorkspace />

        {/* Section 6 — Team Operations */}
        <TeamOperations />

        {/* Section 7 — Business Types */}
        <WhoItIsFor />

        {/* Section 8 — Trust & Security */}
        <TrustSection />

        {/* Section 9 — Pricing */}
        <PricingSection />

        {/* Section 10 — Final CTA */}
        <FinalCTA />
      </main>

      {/* Section 11 — Footer */}
      <Footer />
    </div>
  );
}
