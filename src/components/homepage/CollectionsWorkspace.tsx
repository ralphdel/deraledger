"use client";

import { FolderTree, ArrowDownToLine, Receipt, Layers, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";

export function CollectionsWorkspace() {
  return (
    <section className="bg-[#0B0615] py-20 md:py-28 border-t border-white/[0.06] relative overflow-hidden">
      
      {/* Decorative Background Glows */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 h-[500px] w-[350px] bg-[#6D28FF]/5 blur-[120px] pointer-events-none" />
      <div className="absolute left-0 bottom-0 h-[400px] w-[300px] bg-[#C4B5FD]/5 blur-[100px] pointer-events-none" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="grid lg:grid-cols-[0.85fr_1.15fr] gap-12 lg:gap-20 items-center">
          
          {/* Left: Copy */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-3.5 py-1.5 mb-6">
              <Layers className="h-4 w-4 text-[#A78BFA]" />
              <span className="text-[10px] font-bold text-white/80 tracking-wide uppercase">Operational receivables</span>
            </div>
            
            <h2 className="text-3xl md:text-5xl font-black text-white tracking-tight leading-[1.1] mb-6">
              Grouped Receivables. <br/>
              <span className="text-[#A78BFA]">Organized Collections.</span>
            </h2>
            
            <p className="text-base md:text-lg text-white/60 mb-8 leading-relaxed">
              Stop treating every invoice like an isolated event. DeraLedger groups all payments tied to a specific project, client, or event into a single collection reference.
            </p>

            <ul className="space-y-6">
              <li className="flex items-start gap-4">
                <div className="mt-1 h-6 w-6 rounded-lg bg-[#6D28FF]/20 flex items-center justify-center flex-shrink-0 border border-[#6D28FF]/30 text-[#A78BFA]">
                  <FolderTree className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white tracking-tight">Collection References</h4>
                  <p className="text-xs text-white/50 mt-1 leading-relaxed">Group deposits, milestones, and balances together so your clients see the full picture.</p>
                </div>
              </li>
              <li className="flex items-start gap-4">
                <div className="mt-1 h-6 w-6 rounded-lg bg-[#6D28FF]/20 flex items-center justify-center flex-shrink-0 border border-[#6D28FF]/30 text-[#A78BFA]">
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white tracking-tight">Deposit Allocation</h4>
                  <p className="text-xs text-white/50 mt-1 leading-relaxed">Apply previously paid deposits directly to final balances to prevent double counting and invoicing errors.</p>
                </div>
              </li>
              <li className="flex items-start gap-4">
                <div className="mt-1 h-6 w-6 rounded-lg bg-[#6D28FF]/20 flex items-center justify-center flex-shrink-0 border border-[#6D28FF]/30 text-[#A78BFA]">
                  <Receipt className="h-3.5 w-3.5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white tracking-tight">Operational timeline</h4>
                  <p className="text-xs text-white/50 mt-1 leading-relaxed">Accept partial payments against large contracts while maintaining a clean, automated timeline.</p>
                </div>
              </li>
            </ul>
          </div>

          {/* Right: Immersive Dashboard Showcase */}
          <div className="relative rounded-2xl border border-white/[0.08] bg-[#12061F]/60 shadow-2xl p-6 sm:p-8 backdrop-blur-sm">
            <div className="absolute inset-0 bg-gradient-to-br from-[#6D28FF]/5 to-transparent rounded-2xl pointer-events-none" />
            
            {/* Folder Header */}
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-[#6D28FF]/15 flex items-center justify-center border border-[#6D28FF]/30 text-[#A78BFA]">
                  <Layers className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white tracking-tight text-base">Marketing Campaign Q3</h3>
                  <p className="text-[10px] text-white/40 font-mono mt-0.5">REF-9281 • Group reference</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-white/40 uppercase tracking-widest font-bold">Total Contract Value</p>
                <p className="text-lg font-black text-white font-mono mt-0.5">₦2,500,000</p>
              </div>
            </div>

            {/* Timelines Showcase */}
            <div className="space-y-4">
              
              {/* Item 1 - Deposit */}
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.03] p-4 flex flex-col min-[480px]:flex-row min-[480px]:items-center justify-between gap-3 hover:border-emerald-500/40 transition-colors duration-300">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/30 text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white">Initial Deposit</span>
                      <span className="text-[9px] font-bold uppercase text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/25">Paid</span>
                    </div>
                    <p className="text-[10px] text-white/40 mt-0.5 font-mono">INV-8372 • Aug 14</p>
                  </div>
                </div>
                <p className="font-mono text-sm font-bold text-emerald-400 text-left min-[480px]:text-right">₦500,000</p>
              </div>

              {/* Item 2 - Milestone */}
              <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.03] p-4 flex flex-col min-[480px]:flex-row min-[480px]:items-center justify-between gap-3 hover:border-emerald-500/40 transition-colors duration-300">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 rounded-full bg-emerald-500/10 flex items-center justify-center border border-emerald-500/30 text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white">Mid-Campaign Milestone</span>
                      <span className="text-[9px] font-bold uppercase text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/25">Paid</span>
                    </div>
                    <p className="text-[10px] text-white/40 mt-0.5 font-mono">INV-8399 • Sep 02</p>
                  </div>
                </div>
                <p className="font-mono text-sm font-bold text-emerald-400 text-left min-[480px]:text-right">₦1,000,000</p>
              </div>

              {/* Item 3 - Outstanding with deposit allocation */}
              <div className="rounded-xl border border-[#6D28FF]/40 bg-[#6D28FF]/5 p-4 relative overflow-hidden hover:border-[#6D28FF]/60 transition-colors duration-300">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#6D28FF]" />
                <div className="flex flex-col min-[500px]:flex-row justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="h-5 w-5 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/30 text-amber-400 mt-0.5 flex-shrink-0">
                      <AlertCircle className="h-3 w-3" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-white">Final Balance Invoice</span>
                        <span className="text-[9px] font-bold uppercase text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/25">Pending</span>
                      </div>
                      <p className="text-[10px] text-white/40 mt-0.5 font-mono">INV-8410 • Due Oct 01</p>
                      
                      {/* Deposit applied badge */}
                      <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full w-fit">
                        <ArrowDownToLine className="h-3 w-3" />
                        <span>Paid Deposit Applied: -₦500,000</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-left min-[500px]:text-right flex-shrink-0 pl-8 min-[500px]:pl-0">
                    <p className="text-[9px] text-white/40 uppercase tracking-widest font-bold">Outstanding</p>
                    <p className="font-mono text-base font-bold text-[#A78BFA] mt-0.5">₦1,000,000</p>
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
