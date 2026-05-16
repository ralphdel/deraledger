import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 w-full flex min-h-screen bg-[#12061F] text-white selection:bg-[#7B2FF7]/30">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#1A0B2E] to-[#0B0314] p-12 flex-col justify-between border-r border-white/5 relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-[#7B2FF7]/20 via-transparent to-transparent pointer-events-none"></div>

        <div className="relative z-10">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 bg-[#7B2FF7] rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(123,47,247,0.4)]">
              <span className="text-white font-bold text-lg">D</span>
            </div>
            <span className="text-2xl font-bold text-white tracking-tight">DeraLedger</span>
          </Link>
        </div>
        <div className="relative z-10">
          <h2 className="text-3xl font-bold text-white leading-tight">
            The Smart Ledger for Modern Collections
          </h2>
          <p className="mt-4 text-white/60 text-lg leading-relaxed">
            Track every naira. Accept partial payments. Auto-allocate tax proportionally.
            DeraLedger gives you the intelligence of a CFO in your pocket.
          </p>
          <div className="mt-8 space-y-4">
            {[
              "Accept partial payments on any invoice",
              "Proportional tax & discount allocation",
              "AI-powered financial insights with PurpBot",
              "QR codes + payment links for instant sharing",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <div className="w-6 h-6 bg-[#7B2FF7]/20 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-[#B58CFF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-white/80 text-sm font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-white/40 text-sm relative z-10">© 2026 DeraLedger. All rights reserved.</p>
      </div>

      {/* Right Panel - Form */}
      <div className="flex-1 flex items-center justify-center p-8 relative overflow-hidden">
        {/* Subtle decorative background */}
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-[#7B2FF7]/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="w-full max-w-md relative z-10">{children}</div>
      </div>
    </div>
  );
}
