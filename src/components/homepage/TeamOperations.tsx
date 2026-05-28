"use client";

import { Shield, Users, FileLock2, Clock, Sparkles } from "lucide-react";

export function TeamOperations() {
  const roles = [
    {
      role: "Finance Manager",
      permission: "Full Financial Access",
      details: "Approve large collections, verify business records, manage treasury settlements, and view detailed balance analytics.",
      color: "border-[#6D28FF] bg-[#6D28FF]/5 text-[#A78BFA]",
    },
    {
      role: "Collections Officer",
      permission: "Restricted Billing Only",
      details: "Generate collection links, issue client invoices, and log offline records. strictly restricted from changing bank settings.",
      color: "border-[#C4B5FD]/30 bg-white/[0.02] text-[#C4B5FD]",
    },
    {
      role: "Auditor / Accountant",
      permission: "Read-Only Operations",
      details: "Monitor cash flows, export custom CSV ledgers, track pending partial balances. Cannot modify invoices or add team members.",
      color: "border-white/[0.08] bg-white/[0.01] text-white/70",
    },
  ];

  const logs = [
    {
      time: "10:42 AM",
      action: "Invoice Created",
      details: "INV-9281 by Collections Officer (Adewale K.)",
      badge: "Pending",
      badgeColor: "text-amber-400 bg-amber-500/10 border border-amber-500/20",
    },
    {
      time: "11:15 AM",
      action: "Offline Payment Logged",
      details: "₦500,000 cash confirmed by Finance Manager",
      badge: "Verified",
      badgeColor: "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20",
    },
    {
      time: "02:30 PM",
      action: "Treasury Settled",
      details: "Batch SET-4091 released to verified bank account",
      badge: "Settled",
      badgeColor: "text-[#A78BFA] bg-[#6D28FF]/10 border border-[#6D28FF]/20",
    },
  ];

  return (
    <section className="bg-[#12061F] py-20 md:py-28 border-t border-white/[0.06] relative overflow-hidden">
      {/* Glow Layer */}
      <div className="absolute right-0 bottom-0 h-[450px] w-[500px] rounded-full bg-[#6D28FF]/5 blur-[120px] pointer-events-none" />
      <div className="absolute left-1/4 top-1/4 -translate-y-1/2 h-[350px] w-[350px] rounded-full bg-[#C4B5FD]/5 blur-[100px] pointer-events-none" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
        
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 mb-4">
            <Shield className="h-3 w-3 text-[#A78BFA]" />
            <span className="text-[10px] font-bold text-white/70 tracking-widest uppercase">Team Operations</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight leading-tight mb-4">
            Controlled access built for operational finance.
          </h2>
          <p className="text-sm md:text-base text-white/60 leading-relaxed">
            Finance operations require collaboration. DeraLedger gives your team controlled workspaces with custom Role-Based Access Control (RBAC) to secure your collections workflow.
          </p>
        </div>

        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-start max-w-6xl mx-auto">
          
          {/* RBAC Role Cards */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-[#A78BFA] uppercase tracking-wider mb-2 flex items-center gap-2">
              <Users className="h-4 w-4" /> Role-Based Access Matrix
            </h4>
            
            {roles.map((role) => (
              <div 
                key={role.role} 
                className={`rounded-xl border p-5 backdrop-blur-sm transition-all duration-300 hover:border-[#6D28FF]/30 ${role.color}`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                  <span className="font-bold text-white tracking-tight text-sm md:text-base">{role.role}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-white/5 px-2 py-0.5 rounded border border-white/10 w-fit">
                    {role.permission}
                  </span>
                </div>
                <p className="text-xs text-white/60 leading-relaxed mt-2">{role.details}</p>
              </div>
            ))}
          </div>

          {/* Activity Logs Stream */}
          <div className="rounded-2xl border border-white/[0.08] bg-[#0B0615]/80 p-6 shadow-xl backdrop-blur-sm relative">
            <div className="absolute inset-0 bg-gradient-to-br from-[#6D28FF]/5 to-transparent rounded-2xl pointer-events-none" />
            
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.06] mb-5">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-[#A78BFA] animate-pulse" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">Live Activity Log</span>
              </div>
              <span className="text-[9px] font-bold text-[#A78BFA] bg-[#6D28FF]/10 px-2 py-0.5 rounded border border-[#6D28FF]/20">Audit Trail</span>
            </div>

            <div className="space-y-4 relative">
              {/* Timeline Connector Line */}
              <div className="absolute left-[34px] top-2 bottom-2 w-px bg-white/[0.06]" />

              {logs.map((log) => (
                <div key={log.details} className="flex gap-4 items-start relative z-10">
                  <div className="text-[10px] font-bold text-white/40 font-mono w-[50px] pt-1 text-right flex-shrink-0">
                    {log.time}
                  </div>
                  
                  <div className="h-4 w-4 rounded-full bg-[#12061F] border border-white/[0.12] flex items-center justify-center flex-shrink-0 mt-1">
                    <div className="h-1.5 w-1.5 rounded-full bg-[#6D28FF]" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h5 className="text-xs font-bold text-white tracking-tight">{log.action}</h5>
                      <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full font-mono ${log.badgeColor}`}>
                        {log.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-white/50 mt-1 break-words leading-relaxed">{log.details}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-4 border-t border-white/[0.06] flex items-center gap-2">
              <FileLock2 className="h-4 w-4 text-[#A78BFA]" />
              <span className="text-[10px] text-white/40">Secure collections history automatically logged & immutable.</span>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
