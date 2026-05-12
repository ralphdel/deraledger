import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 w-full flex">
      {/* Left Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-purp-900 p-12 flex-col justify-between">
        <div>
          <Link href="/" className="flex items-center gap-2">
            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
              <span className="text-purp-900 font-bold text-lg">D</span>
            </div>
            <span className="text-2xl font-bold text-white">Deraledger</span>
          </Link>
        </div>
        <div>
          <h2 className="text-3xl font-bold text-white leading-tight">
            The Smart Ledger for Modern Collections
          </h2>
          <p className="mt-4 text-purp-200 text-lg leading-relaxed">
            Track every naira. Accept partial payments. Auto-allocate tax proportionally.
            Deraledger gives you the intelligence of a CFO in your pocket.
          </p>
          <div className="mt-8 space-y-4">
            {[
              "Accept partial payments on any invoice",
              "Proportional tax & discount allocation",
              "AI-powered financial insights with DeraBot",
              "QR codes + payment links for instant sharing",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <div className="w-5 h-5 bg-purp-700 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span className="text-purp-200 text-sm">{item}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-purp-200 text-sm">© 2025 Deraledger. All rights reserved.</p>
      </div>

      {/* Right Panel - Form */}
      <div className="flex-1 flex items-center justify-center bg-white p-8">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
