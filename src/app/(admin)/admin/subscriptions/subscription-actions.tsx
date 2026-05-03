"use client";

import { useState } from "react";
import { MoreVertical, Mail, Search, CalendarPlus, Ban } from "lucide-react";
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
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SubscriptionActionsProps {
  subscriptionId: string;
  merchantId: string;
}

export function SubscriptionActions({ subscriptionId, merchantId }: SubscriptionActionsProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleRemind = async () => {
    setIsProcessing(true);
    try {
      const res = await fetch("/api/admin/subscriptions/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId, merchantId }),
      });
      if (!res.ok) throw new Error("Failed to send reminder");
      alert("Reminder sent successfully");
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExtend = async () => {
    const days = prompt("How many days to extend the subscription?");
    if (!days) return;
    const reason = prompt("Reason for extension?");
    if (!reason) return;

    setIsProcessing(true);
    try {
      const res = await fetch("/api/admin/subscriptions/extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId, merchantId, days: parseInt(days), reason }),
      });
      if (!res.ok) throw new Error("Failed to extend subscription");
      alert("Subscription extended");
      window.location.reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChurn = async () => {
    if (!confirm("Are you sure you want to mark this merchant as churned? This will cancel their active subscription.")) return;

    setIsProcessing(true);
    try {
      const res = await fetch("/api/admin/subscriptions/churn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId, merchantId }),
      });
      if (!res.ok) throw new Error("Failed to mark as churned");
      alert("Merchant marked as churned");
      window.location.reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
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
          <DropdownMenuItem className="cursor-pointer" onClick={handleRemind}>
            <Mail className="h-4 w-4 mr-2 text-amber-600" />
            <span className="text-amber-700">Send Manual Reminder</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="cursor-pointer" onClick={handleExtend}>
            <CalendarPlus className="h-4 w-4 mr-2 text-emerald-600" />
            <span className="text-emerald-700">Extend Subscription</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="cursor-pointer" onClick={handleChurn}>
            <Ban className="h-4 w-4 mr-2 text-red-600" />
            <span className="text-red-700">Mark as Churned</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
