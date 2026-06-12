"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { ChevronRight, FileText, CheckCircle2, DollarSign, Users, LineChart, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

// Layered Glassmorphic Dashboard matching active showcase slide focus
function FloatingWorkspace({ activeSlide }: { activeSlide: number }) {
  return (
    <div className="relative mx-auto w-full max-w-[480px] aspect-[4/3.5] sm:aspect-square flex items-center justify-center overflow-hidden">
      {/* Dynamic Centered Scaling Wrapper for absolute responsiveness on tiny screens without stretching container */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-[0.55] min-[360px]:scale-[0.65] min-[400px]:scale-[0.75] min-[480px]:scale-[0.85] sm:scale-95 md:scale-100 origin-center transition-all duration-300 w-[480px] h-[480px] flex-shrink-0">
        
        {/* Dynamic Ambient Background Glows */}
        <div 
          className={`absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 h-[300px] w-[300px] rounded-full blur-[80px] pointer-events-none transition-all duration-1000 ${
            activeSlide === 0 ? "bg-[#6D28FF]/15" : activeSlide === 1 ? "bg-emerald-500/10" : "bg-[#C4B5FD]/10"
          }`} 
        />
        <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 h-[250px] w-[250px] rounded-full bg-[#6D28FF]/5 blur-[80px] pointer-events-none" />

        {/* Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:30px_30px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none" />

        {/* CARD 1 — Invoice (Highlighted in Slide 1 - Invoicing) */}
        <div 
          className={`absolute top-4 left-4 w-[240px] rounded-xl border p-4 shadow-xl backdrop-blur-md transition-all duration-700 ${
            activeSlide === 0 
              ? "border-[#6D28FF] bg-[#12061F]/90 scale-105 opacity-100 z-20 shadow-[0_4px_25px_rgba(109,40,255,0.25)]" 
              : "border-white/[0.04] bg-[#12061F]/30 scale-95 opacity-30 z-10"
          } animate-[float_6s_ease-in-out_infinite]`}
        >
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-[#6D28FF]/20 flex items-center justify-center border border-[#6D28FF]/30">
              <FileText className="h-4 w-4 text-[#A78BFA]" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider">Invoice Generated</p>
              <p className="text-xs font-bold text-white mt-0.5">INV-2041</p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
            <span className="font-mono text-sm font-bold text-white">₦450,000</span>
            <span className="rounded-full bg-[#6D28FF]/15 px-2 py-0.5 text-[9px] font-bold text-[#A78BFA] border border-[#6D28FF]/35">
              Sent
            </span>
          </div>
        </div>

        {/* CARD 2 — Payment Collection (Highlighted in Slide 2 - Collections) */}
        <div 
          className={`absolute top-16 right-4 w-[260px] rounded-xl border p-4 shadow-xl backdrop-blur-md transition-all duration-700 ${
            activeSlide === 1 
              ? "border-emerald-500 bg-[#12061F]/90 scale-105 opacity-100 z-20 shadow-[0_4px_25px_rgba(16,185,129,0.2)]" 
              : "border-white/[0.04] bg-[#12061F]/30 scale-95 opacity-30 z-10"
          } animate-[float_7s_ease-in-out_1s_infinite]`}
        >
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="flex-1">
              <p className="text-xs font-bold text-white">₦150,000 Deposit Received</p>
              <p className="text-[10px] text-white/50 mt-0.5 font-semibold">Transaction reference reconciled</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between bg-white/[0.03] rounded-lg px-2.5 py-1.5 border border-white/[0.04]">
            <span className="text-[10px] text-white/40">Outstanding</span>
            <span className="font-mono text-xs font-bold text-emerald-400">₦300,000</span>
          </div>
        </div>

        {/* CARD 3 — Offline Record (Highlighted in Slide 2 - Collections) */}
        <div 
          className={`absolute bottom-32 left-4 w-[250px] rounded-xl border p-4 shadow-xl backdrop-blur-md transition-all duration-700 ${
            activeSlide === 1 
              ? "border-amber-500 bg-[#12061F]/95 scale-105 opacity-100 z-20 shadow-[0_4px_25px_rgba(245,158,11,0.2)]" 
              : "border-white/[0.04] bg-[#12061F]/30 scale-95 opacity-30 z-10"
          } animate-[float_5s_ease-in-out_2s_infinite]`}
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="h-7 w-7 rounded-lg bg-amber-500/20 flex items-center justify-center border border-amber-500/30">
              <DollarSign className="h-4 w-4 text-amber-400" />
            </div>
            <span className="text-[10px] font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">Offline Log</span>
          </div>
          <p className="text-xs font-bold text-white">Offline Cash Payment Logged</p>
          <p className="text-[10px] text-white/50 mt-1">Recorded by Operations Team</p>
        </div>

        {/* CARD 4 — Team Activity (Highlighted in Slide 3 - Team Operations) */}
        <div 
          className={`absolute bottom-12 right-12 w-[220px] rounded-xl border p-4 shadow-xl backdrop-blur-md transition-all duration-700 ${
            activeSlide === 2 
              ? "border-[#6D28FF] bg-[#12061F]/95 scale-105 opacity-100 z-20 shadow-[0_4px_25px_rgba(109,40,255,0.25)]" 
              : "border-white/[0.04] bg-[#12061F]/30 scale-95 opacity-30 z-10"
          } animate-[float_8s_ease-in-out_0.5s_infinite]`}
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] pb-2 mb-2">
            <div className="flex items-center gap-2">
              <Users className="h-3.5 w-3.5 text-[#A78BFA]" />
              <span className="text-[10px] font-bold text-white/80">Active Workspaces</span>
            </div>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <p className="text-xs font-bold text-white">2 Team Members Active</p>
          <div className="mt-2 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-white/50">
              <span>Finance Manager</span>
              <span className="text-emerald-400 font-semibold">Online</span>
            </div>
            <div className="flex items-center justify-between text-[10px] text-white/50">
              <span>Collections Officer</span>
              <span className="text-emerald-400 font-semibold">Online</span>
            </div>
          </div>
        </div>

        {/* CARD 5 — Analytics Snapshot (Highlighted in Slide 1 and Slide 3) */}
        <div 
          className={`absolute top-[40%] left-[30%] -translate-x-1/2 w-[230px] rounded-xl border p-4 shadow-2xl backdrop-blur-md transition-all duration-700 ${
            activeSlide === 0 || activeSlide === 2 
              ? "border-[#C4B5FD] bg-[#0B0615]/95 scale-105 opacity-100 z-20 shadow-[0_10px_35px_rgba(196,181,253,0.15)]" 
              : "border-white/[0.04] bg-[#0B0615]/30 scale-95 opacity-30 z-10"
          } animate-[float_9s_ease-in-out_1.5s_infinite]`}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <LineChart className="h-3.5 w-3.5 text-[#C4B5FD]" />
              <span className="text-[10px] font-semibold text-white/60">Analytics Snapshot</span>
            </div>
          </div>
          <p className="text-lg font-black text-white font-mono">₦12,450,000</p>
          <p className="text-[9px] text-white/40 mt-0.5">Total collected across all channels</p>
          <div className="mt-3 flex items-center justify-between text-[10px] text-white/60 pt-2 border-t border-white/[0.06]">
            <span>142 invoices</span>
            <span className="text-amber-400 font-semibold">18 pending</span>
          </div>
        </div>

        {/* Embedded CSS for custom floating keyframes */}
        <style jsx global>{`
          @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
        `}</style>
      </div>
    </div>
  );
}

export function Hero() {
  const [activeSlide, setActiveSlide] = useState(0);

  const slides = [
    {
      eyebrow: "Smart Invoicing Workspace",
      headline: "Generate Professional Invoices In Seconds.",
      description: "Create clean, digital invoice links, dispatch automated payment reminders, and let clients pay easily online or via bank transfer — all securely reconciled.",
    },
    {
      eyebrow: "Modern Collections Infrastructure",
      headline: "Track Deposits And Partial Payments Clearly.",
      description: "Never lose track of milestone billing. Apply paid deposits directly to final balances, log offline payments, and enforce partial payment thresholds dynamically.",
    },
    {
      eyebrow: "Finance Access Control",
      headline: "Control Payment Operations Across Your Team.",
      description: "Delegate collections and reconciliation safely. Custom Role-Based Access Control (RBAC) allows staff to generate links and log records without bank setup access.",
    },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % slides.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [slides.length]);

  return (
    <section className="relative overflow-hidden bg-[#140C24] pt-24 pb-20 md:pt-32 md:pb-28 dark:bg-[#10081D]">
      {/* Background Gradients */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[900px] rounded-full bg-[#6D28FF]/10 blur-[130px] pointer-events-none" />
      <div className="absolute right-0 bottom-0 translate-x-1/4 translate-y-1/4 h-[500px] w-[500px] rounded-full bg-[#C4B5FD]/5 blur-[120px] pointer-events-none" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-8 items-center">
          
          {/* Left Side Copy */}
          <div className="max-w-3xl text-center lg:text-left flex flex-col justify-center">
            
            {/* Dynamic Slider-bound Copy Block with natural heights for bulletproof responsiveness */}
            <div className="relative w-full">
              {slides.map((slide, idx) => (
                <div
                  key={slide.headline}
                  className={`w-full flex flex-col items-center lg:items-start transition-all duration-700 ease-in-out ${
                    idx === activeSlide
                      ? "relative opacity-100 translate-y-0 pointer-events-auto"
                      : "absolute inset-0 opacity-0 translate-y-6 pointer-events-none"
                  }`}
                >
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3.5 py-1.5 mb-6 backdrop-blur-md">
                    <Sparkles className="h-3.5 w-3.5 text-[#A78BFA]" />
                    <span className="text-[10px] font-bold text-white/80 tracking-wide uppercase">{slide.eyebrow}</span>
                  </div>
                  
                  <h1 className="text-3xl font-black leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-[46px] xl:text-[54px]">
                    {slide.headline}
                  </h1>
                  
                  <p className="mt-4 text-sm md:text-base leading-relaxed text-white/60 max-w-2xl mx-auto lg:mx-0">
                    {slide.description}
                  </p>
                </div>
              ))}
            </div>
            
            {/* Action Buttons */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-4">
              <Link href="/onboarding" className="w-full sm:w-auto">
                <Button className="h-12 w-full sm:w-auto bg-[#6D28FF] hover:bg-[#6D28FF]/95 px-8 text-base font-bold text-white transition-all shadow-[0_4px_20px_rgba(109,40,255,0.4)] border-0">
                  Start Free
                </Button>
              </Link>
              <a href="#workflow" className="w-full sm:w-auto">
                <Button variant="outline" className="h-12 w-full sm:w-auto border-white/[0.12] bg-white/[0.02] px-8 text-base font-bold text-white hover:bg-white/[0.06] hover:text-white backdrop-blur-sm transition-all">
                  See Live Demo
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </a>
            </div>

            {/* Slider Showcase Navigation dots */}
            <div className="mt-10 border-t border-white/[0.08] pt-4 max-w-lg mx-auto lg:mx-0">
              <div className="flex items-center justify-center lg:justify-start gap-6">
                {slides.map((slide, idx) => (
                  <button
                    key={slide.eyebrow}
                    onClick={() => setActiveSlide(idx)}
                    className="group flex flex-col items-center lg:items-start text-left cursor-pointer"
                  >
                    <span 
                      className={`text-[9px] font-bold uppercase tracking-widest transition-colors duration-300 ${
                        idx === activeSlide ? "text-[#A78BFA]" : "text-white/30 group-hover:text-white/60"
                      }`}
                    >
                      {idx === 0 ? "Invoicing" : idx === 1 ? "Collections" : "Team Control"}
                    </span>
                    <div 
                      className={`h-[3px] rounded-full mt-1.5 transition-all duration-500 ${
                        idx === activeSlide ? "w-12 bg-[#6D28FF]" : "w-3 bg-white/10 group-hover:w-6"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* Right Side Visual interacting dynamically with activeSlide state */}
          <div className="relative w-full">
            <FloatingWorkspace activeSlide={activeSlide} />
          </div>

        </div>
      </div>
    </section>
  );
}
