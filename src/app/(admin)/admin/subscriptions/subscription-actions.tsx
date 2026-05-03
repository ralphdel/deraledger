"use client";

import { useState } from "react";
import { MoreVertical, Mail, Search, CalendarPlus, Ban, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from "@/components/ui/dropdown-menu";
import { buttonVariants, Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface SubscriptionActionsProps {
  subscriptionId: string;
  merchantId: string;
  businessName: string;
  status: string;
}

export function SubscriptionActions({ subscriptionId, merchantId, businessName, status }: SubscriptionActionsProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeModal, setActiveModal] = useState<"extend" | "churn" | "remind" | "reactivate" | null>(null);
  
  // Extend state
  const [extendDays, setExtendDays] = useState("30");
  const [extendReason, setExtendReason] = useState("");
  
  // Churn state
  const [churnReason, setChurnReason] = useState("");

  const handleRemind = async () => {
    setIsProcessing(true);
    try {
      const res = await fetch("/api/admin/subscriptions/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId, merchantId }),
      });
      if (!res.ok) throw new Error("Failed to send reminder");
      setActiveModal(null);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExtend = async () => {
    if (!extendDays || !extendReason) return;
    setIsProcessing(true);
    try {
      const res = await fetch("/api/admin/subscriptions/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          subscriptionId, 
          merchantId, 
          days: parseInt(extendDays), 
          reason: extendReason 
        }),
      });
      if (!res.ok) throw new Error("Failed to extend subscription");
      setActiveModal(null);
      window.location.reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChurn = async () => {
    setIsProcessing(true);
    try {
      const res = await fetch("/api/admin/subscriptions/churn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          subscriptionId, 
          merchantId, 
          reason: churnReason || "Manual deactivation by administrator" 
        }),
      });
      if (!res.ok) throw new Error("Failed to mark as churned");
      setActiveModal(null);
      window.location.reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReactivate = async () => {
    setIsProcessing(true);
    try {
      const res = await fetch("/api/admin/subscriptions/reactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId, merchantId }),
      });
      if (!res.ok) throw new Error("Failed to reactivate");
      setActiveModal(null);
      window.location.reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger 
          render={
            <button 
              className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "h-8 w-8")}
              disabled={isProcessing}
            />
          }
        >
          <MoreVertical className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link href={`/admin/merchants/${merchantId}`} className="cursor-pointer" />}>
                <Search className="h-4 w-4 mr-2" />
                View Merchant Detail
            </DropdownMenuItem>
            
            {status !== "cancelled" ? (
              <>
                <DropdownMenuItem className="cursor-pointer" onClick={() => setActiveModal("remind")}>
                  <Mail className="h-4 w-4 mr-2 text-amber-600" />
                  <span className="text-amber-700">Send Manual Reminder</span>
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={() => setActiveModal("extend")}>
                  <CalendarPlus className="h-4 w-4 mr-2 text-emerald-600" />
                  <span className="text-emerald-700">Extend Subscription</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer" onClick={() => setActiveModal("churn")}>
                  <Ban className="h-4 w-4 mr-2 text-red-600" />
                  <span className="text-red-700">Mark as Churned</span>
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem className="cursor-pointer" onClick={() => setActiveModal("reactivate")}>
                <RefreshCw className="h-4 w-4 mr-2 text-emerald-600" />
                <span className="text-emerald-700">Reactivate Merchant</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Manual Reminder Dialog */}
      <Dialog open={activeModal === "remind"} onOpenChange={(open) => !open && setActiveModal(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Subscription Reminder</DialogTitle>
            <DialogDescription>
              This will send a manual email reminder to <strong>{businessName}</strong> regarding their upcoming renewal.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setActiveModal(null)} disabled={isProcessing}>
              Cancel
            </Button>
            <Button onClick={handleRemind} disabled={isProcessing} className="bg-amber-600 hover:bg-amber-700 text-white">
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Send Reminder Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extension Dialog */}
      <Dialog open={activeModal === "extend"} onOpenChange={(open) => !open && setActiveModal(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extend Subscription</DialogTitle>
            <DialogDescription>
              Add extra days to the current period for <strong>{businessName}</strong>. This action is audit-logged.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="days">Days to Extend</Label>
              <Input
                id="days"
                type="number"
                value={extendDays}
                onChange={(e) => setExtendDays(e.target.value)}
                placeholder="e.g. 30"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reason">Reason for Override</Label>
              <Textarea
                id="reason"
                value={extendReason}
                onChange={(e) => setExtendReason(e.target.value)}
                placeholder="e.g. Compensation for downtime / Manual bank payment"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveModal(null)} disabled={isProcessing}>
              Cancel
            </Button>
            <Button onClick={handleExtend} disabled={isProcessing || !extendReason} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Extension
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Churn Dialog */}
      <Dialog open={activeModal === "churn"} onOpenChange={(open) => !open && setActiveModal(null)}>
        <DialogContent className="sm:max-w-md border-red-200">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Mark as Churned
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to mark <strong>{businessName}</strong> as churned? This will cancel their active subscription and block features immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="churn-reason">Cancellation Reason (Sent to Merchant)</Label>
            <Textarea
              id="churn-reason"
              value={churnReason}
              onChange={(e) => setChurnReason(e.target.value)}
              placeholder="e.g. Terms of Service violation / Account dormant"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActiveModal(null)} disabled={isProcessing}>
              Keep Active
            </Button>
            <Button onClick={handleChurn} disabled={isProcessing} variant="destructive">
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Churn & Send Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reactivate Dialog */}
      <Dialog open={activeModal === "reactivate"} onOpenChange={(open) => !open && setActiveModal(null)}>
        <DialogContent className="sm:max-w-md border-emerald-200">
          <DialogHeader>
            <DialogTitle className="text-emerald-600 flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Reactivate Merchant
            </DialogTitle>
            <DialogDescription>
              Restore <strong>{businessName}</strong> from churned status. Their subscription will be set to 'expired', allowing them to renew or be extended.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setActiveModal(null)} disabled={isProcessing}>
              Cancel
            </Button>
            <Button onClick={handleReactivate} disabled={isProcessing} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Reactivation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
