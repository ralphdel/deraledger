"use client";

import { useEffect, useState, useTransition } from "react";
import { CheckCircle, Sparkles, ArrowRight, Shield, Zap, Users, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { getMerchant } from "@/lib/data";
import { acknowledgeUpdateAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/client";

const UPDATE_HIGHLIGHTS = [
  {
    icon: Shield,
    title: "Enhanced Security",
    description: "Centralized access control with plan-based enforcement on all operations.",
    color: "text-emerald-600",
    bg: "bg-emerald-50 border-emerald-200",
  },
  {
    icon: Zap,
    title: "KYC Rate Protection",
    description: "KYC submissions are now rate-limited and locked on excessive attempts.",
    color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
  },
  {
    icon: Users,
    title: "Team Seat Enforcement",
    description: "Team invite limits now strictly enforced per subscription plan.",
    color: "text-blue-600",
    bg: "bg-blue-50 border-blue-200",
  },
  {
    icon: FileText,
    title: "Invoice Lifecycle",
    description: "New archive policy: paid invoices cannot be deleted; unpaid invoices can be archived.",
    color: "text-purple-600",
    bg: "bg-purple-50 border-purple-200",
  },
];

export function PlatformUpdateModal() {
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  useEffect(() => {
    async function checkVersion() {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      
      const m = await getMerchant();
      if (m) {
        setMerchantId(m.id);
        const { data: platformSetting } = await sb
          .from("platform_settings")
          .select("value")
          .eq("key", "current_platform_version")
          .single();
        
        const currentVersion = parseInt(platformSetting?.value || "1", 10);
        const merchantVersion = m.last_acknowledged_version ?? 0;

        if (merchantVersion < currentVersion) {
          setOpen(true);
        }
      }
    }
    
    checkVersion();
  }, []);

  const handleAcknowledge = () => {
    if (!merchantId) return;
    startTransition(async () => {
      const result = await acknowledgeUpdateAction(merchantId);
      if (result.success) {
        setDone(true);
        setTimeout(() => setOpen(false), 1200);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}> 
      {/* Intentionally passing empty function to prevent clicking outside to close */}
      <DialogContent className="sm:max-w-md p-0 border-0 overflow-hidden bg-transparent shadow-none" showCloseButton={false}>
        <DialogTitle className="sr-only">Platform Update</DialogTitle>
        <DialogDescription className="sr-only">Acknowledge platform changes before continuing.</DialogDescription>
        <div className="bg-gradient-to-br from-purp-50 via-white to-blue-50 rounded-2xl p-6 shadow-2xl border-2 border-purp-100">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-purp-100 border-2 border-purp-200 mb-4 shadow-sm">
              <Sparkles className="h-7 w-7 text-purp-700" />
            </div>
            <h2 className="text-xl font-bold text-purp-900">Platform Update</h2>
            <p className="text-neutral-500 text-xs mt-1.5 px-4">
              We&apos;ve made important changes to how DeraLedger works.
              Please review what&apos;s new before continuing.
            </p>
          </div>

          {/* Update Highlights */}
          <div className="space-y-2.5 mb-6 max-h-[40vh] overflow-y-auto pr-2 custom-scrollbar">
            {UPDATE_HIGHLIGHTS.map((item, idx) => (
              <Card key={idx} className={`border shadow-none ${item.bg}`}>
                <CardContent className="p-3">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 shrink-0 ${item.color}`}>
                      <item.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-semibold text-xs text-neutral-900">{item.title}</p>
                      <p className="text-[10px] text-neutral-600 mt-0.5 leading-snug">{item.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Policy notice */}
          <div className="p-3 bg-neutral-50 border border-neutral-200 rounded-xl text-[10px] text-neutral-600 mb-5 leading-snug">
            By continuing, you acknowledge these platform changes and confirm your business usage
            remains compliant with <span className="font-semibold text-purp-900">DeraLedger&apos;s Terms of Service</span>.
          </div>

          {/* CTA */}
          {done ? (
            <div className="flex items-center justify-center gap-2 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 font-semibold text-xs">
              <CheckCircle className="h-4 w-4" />
              Acknowledged — continuing to dashboard...
            </div>
          ) : (
            <Button
              onClick={handleAcknowledge}
              disabled={isPending || !merchantId}
              className="w-full h-11 bg-purp-900 hover:bg-purp-700 text-white font-semibold text-sm shadow-md"
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  I Understand — Continue
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
