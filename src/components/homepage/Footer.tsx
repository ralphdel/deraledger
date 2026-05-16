"use client";

import Link from "next/link";
import { Mail } from "lucide-react";

function BrandMark() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="DeraLedger home">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#7B2FF7] text-sm font-bold text-white">
        D
      </div>
      <span className="text-lg font-bold text-white">DeraLedger</span>
    </Link>
  );
}

export function Footer() {
  return (
    <footer className="bg-[#12061F] pt-20 pb-10 border-t border-white/5 relative">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4 lg:gap-8 mb-16">
          
          {/* Brand Column */}
          <div className="lg:pr-8">
            <BrandMark />
            <p className="mt-6 text-sm leading-relaxed text-white/50">
              Modern collections infrastructure for African businesses.
            </p>
          </div>

          {/* Product Column */}
          <div>
            <h3 className="text-sm font-bold text-white tracking-wider mb-5">PRODUCT</h3>
            <ul className="space-y-4">
              <li><a href="#" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">Features</a></li>
              <li><a href="#pricing" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">Pricing</a></li>
              <li><a href="#" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">Security</a></li>
              <li><a href="#" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">API Status</a></li>
              <li><a href="#" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">Documentation</a></li>
            </ul>
          </div>

          {/* Company Column */}
          <div>
            <h3 className="text-sm font-bold text-white tracking-wider mb-5">COMPANY</h3>
            <ul className="space-y-4">
              <li><a href="#" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">About</a></li>
              <li>
                <a href="mailto:support@deraledger.com" className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-[#B58CFF] transition-colors">
                  <Mail className="h-4 w-4" /> Contact
                </a>
              </li>
              <li><a href="#" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">Careers</a></li>
              <li><a href="#" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">Terms of Service</a></li>
            </ul>
          </div>

          {/* Resources Column */}
          <div>
            <h3 className="text-sm font-bold text-white tracking-wider mb-5">RESOURCES</h3>
            <ul className="space-y-4">
              <li><a href="#" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">Help Center</a></li>
              <li><a href="#" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">Guides</a></li>
              <li><a href="#" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">Changelog</a></li>
              <li><a href="#" className="text-sm text-white/50 hover:text-[#B58CFF] transition-colors">Status Page</a></li>
            </ul>
          </div>

        </div>

        {/* Bottom Line */}
        <div className="flex flex-col md:flex-row items-center justify-between border-t border-white/10 pt-8 text-xs text-white/40">
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
