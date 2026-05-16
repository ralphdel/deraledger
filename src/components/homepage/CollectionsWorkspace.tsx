"use client";

import { FolderTree, ArrowDownToLine, Receipt, Layers } from "lucide-react";

export function CollectionsWorkspace() {
  return (
    <section className="bg-[#12061F] py-20 md:py-32 border-t border-white/5 relative overflow-hidden">
      
      {/* Decorative Background */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 h-[600px] w-[400px] bg-[#3D0B66]/30 blur-[150px] pointer-events-none" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-12 lg:gap-20 items-center">
          
          {/* Left: Copy */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 mb-6">
              <Layers className="h-4 w-4 text-[#B58CFF]" />
              <span className="text-xs font-semibold text-white/80">The Signature Feature</span>
            </div>
            
            <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight leading-tight mb-6">
              Grouped Receivables. <br/>
              <span className="text-[#7B2FF7]">Organized Collections.</span>
            </h2>
            
            <p className="text-lg text-white/60 mb-8 leading-relaxed">
              Stop treating every invoice like an isolated event. DeraLedger groups all payments tied to a specific project, client, or event into a single collection reference. 
            </p>

            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <div className="mt-1 h-5 w-5 rounded-full bg-[#3D0B66] flex items-center justify-center flex-shrink-0">
                  <FolderTree className="h-3 w-3 text-[#B58CFF]" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Collection References</h4>
                  <p className="text-sm text-white/50 mt-1">Group deposits, milestones, and balances together.</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-1 h-5 w-5 rounded-full bg-[#3D0B66] flex items-center justify-center flex-shrink-0">
                  <ArrowDownToLine className="h-3 w-3 text-[#B58CFF]" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Deposit Allocation</h4>
                  <p className="text-sm text-white/50 mt-1">Apply previously paid deposits directly to final balances to prevent double counting.</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <div className="mt-1 h-5 w-5 rounded-full bg-[#3D0B66] flex items-center justify-center flex-shrink-0">
                  <Receipt className="h-3 w-3 text-[#B58CFF]" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">Installment Workflows</h4>
                  <p className="text-sm text-white/50 mt-1">Accept partial payments against large invoices with minimum thresholds.</p>
                </div>
              </li>
            </ul>
          </div>

          {/* Right: Signature UI Mockup */}
          <div className="relative rounded-2xl border border-white/10 bg-[#12061F] shadow-2xl p-4 sm:p-6 lg:p-8">
            <div className="absolute inset-0 bg-gradient-to-br from-[#7B2FF7]/5 to-transparent rounded-2xl pointer-events-none" />
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-[#3D0B66] flex items-center justify-center">
                  <Layers className="h-5 w-5 text-[#B58CFF]" />
                </div>
                <div>
                  <h3 className="font-bold text-white">Marketing Campaign Q3</h3>
                  <p className="text-xs text-white/50">Reference ID: REF-9281</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-white/50 uppercase tracking-wider font-semibold">Total Value</p>
                <p className="text-lg font-bold text-white font-mono">{"\u20A6"}2,500,000</p>
              </div>
            </div>

            {/* Invoices List */}
            <div className="space-y-3">
              {/* Deposit Invoice */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold uppercase text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Paid</span>
                    <span className="text-sm font-semibold text-white">Initial Deposit</span>
                  </div>
                  <p className="text-xs text-white/50">INV-8372 • Aug 14</p>
                </div>
                <p className="font-mono text-base font-bold text-emerald-400">{"\u20A6"}500,000</p>
              </div>

              {/* Milestone Invoice */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold uppercase text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Paid</span>
                    <span className="text-sm font-semibold text-white">Mid-Campaign Milestone</span>
                  </div>
                  <p className="text-xs text-white/50">INV-8399 • Sep 02</p>
                </div>
                <p className="font-mono text-base font-bold text-emerald-400">{"\u20A6"}1,000,000</p>
              </div>

              {/* Balance Invoice with Deposit applied */}
              <div className="rounded-xl border border-[#7B2FF7]/30 bg-[#7B2FF7]/5 p-4 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#7B2FF7]" />
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold uppercase text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">Pending</span>
                      <span className="text-sm font-semibold text-white">Final Balance</span>
                    </div>
                    <p className="text-xs text-white/50">INV-8410 • Due Oct 01</p>
                    
                    <div className="mt-3 flex items-center gap-2 text-xs font-medium text-emerald-400">
                      <ArrowDownToLine className="h-3 w-3" />
                      Deposit Applied: -{"\u20A6"}500,000
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-white/50 mb-0.5">Outstanding</p>
                    <p className="font-mono text-xl font-bold text-[#B58CFF]">{"\u20A6"}1,000,000</p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
}
