"use client";

import Link from "next/link";
import { Mail, Sparkles } from "lucide-react";
import { DeraLedgerLogo } from "@/components/ui/deraledger-logo";

function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="DeraLedger home">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-[0_0_10px_rgba(255,255,255,0.1)]">
        <DeraLedgerLogo className="h-5 w-5" />
      </div>
      <span className="text-base font-bold text-white tracking-tight">DeraLedger</span>
    </Link>
  );
}

export function Footer() {
  return (
    <footer className="bg-[#0B0615] pt-20 pb-10 border-t border-white/[0.06] relative">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4 lg:gap-8 mb-16 max-w-6xl mx-auto">
          
          {/* Brand Column */}
          <div className="lg:pr-8">
            <BrandMark />
            <p className="mt-5 text-xs leading-relaxed text-white/50">
              Modern collections infrastructure for African businesses.
            </p>
          </div>

          {/* Product Column */}
          <div>
            <h3 className="text-[10px] font-bold text-white tracking-widest uppercase mb-5">Product</h3>
            <ul className="space-y-3.5">
              <li><a href="#features" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Features</a></li>
              <li><a href="#pricing" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Pricing</a></li>
              <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Security</a></li>
              <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">API Status</a></li>
              <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Documentation</a></li>
            </ul>
          </div>

          {/* Company Column */}
          <div>
            <h3 className="text-[10px] font-bold text-white tracking-widest uppercase mb-5">Company</h3>
            <ul className="space-y-3.5">
              <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">About</a></li>
              <li>
                <a href="mailto:support@deraledger.com" className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-[#A78BFA] transition-colors">
                  <Mail className="h-3.5 w-3.5" /> Contact
                </a>
              </li>
              <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Careers</a></li>
              <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Terms</a></li>
            </ul>
          </div>

          {/* Resources Column */}
          <div>
            <h3 className="text-[10px] font-bold text-white tracking-widest uppercase mb-5">Resources</h3>
            <ul className="space-y-3.5">
              <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Help Center</a></li>
              <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Guides</a></li>
              <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Changelog</a></li>
              <li><a href="#" className="text-xs text-white/50 hover:text-[#A78BFA] transition-colors">Status Page</a></li>
            </ul>
          </div>

        </div>

        {/* Bottom Line */}
        <div className="flex flex-col md:flex-row items-center justify-between border-t border-white/[0.06] pt-8 text-[11px] text-white/40 max-w-6xl mx-auto">
          <p>© {new Date().getFullYear()} DeraLedger by Deral Technologies Limited. All rights reserved.</p>
          <div className="flex gap-6 mt-4 md:mt-0">
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
            <a href="#" className="hover:text-white transition-colors">Terms</a>
          </div>
        </div>

      </div>
    </footer>
  );
}
