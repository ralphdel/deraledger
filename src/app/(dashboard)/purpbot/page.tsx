"use client";

import { useState, useEffect, useRef } from "react";
import { Bot, Send, ShieldAlert, Sparkles, User, TrendingUp, FileText, Users, DollarSign, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInvoices, getClients, getAllTransactions, getMerchant, getActiveSubscription } from "@/lib/data";
import { formatNaira } from "@/lib/calculations";
import type { InvoiceWithClient, Client, Transaction, Merchant } from "@/lib/types";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: string[];
}

const ROLE_KNOWLEDGE: Record<string, { description: string; permissions: string[] }> = {
  owner: {
    description: "Full unrestricted access to all platform features including settlement account management, billing, team management, and all financial operations.",
    permissions: ["View & create invoices", "Edit & void invoices", "Record payments", "Manage clients (add/edit/delete)", "View analytics & transactions", "Manage KYC & business settings", "Manage billing & subscription", "Manage team members & roles", "Use PurpBot", "View settlements", "Manage settlement account", "Manage advanced settings", "Manage item catalog", "Manage discount templates", "View item catalog", "View discount templates"]
  },
  admin: {
    description: "Broad operational access. Can manage most business functions but CANNOT manage billing, delete clients, void invoices, or change the settlement account.",
    permissions: ["View & create invoices", "Edit invoices", "Record payments", "Manual close invoices", "Manage clients (add/edit, NOT delete)", "View analytics & transactions", "Change fee settings", "Manage business settings", "Manage team members", "Use PurpBot", "View settlements", "Manage advanced settings", "Manage item catalog", "Manage discount templates", "View item catalog", "View discount templates"]
  },
  accountant: {
    description: "Financial operations access. Can create invoices, record payments, view financial data and analytics, but cannot manage team, delete clients, or change settings.",
    permissions: ["View & create invoices", "Edit invoices", "Record payments", "Manual close invoices", "View clients", "View analytics & transactions", "Use PurpBot", "View settlements", "View item catalog", "View discount templates"]
  },
  support: {
    description: "Limited client-facing access. Can view invoices and clients, edit client info, but cannot create invoices, view analytics, or access financial settings.",
    permissions: ["View invoices", "View & edit clients (NOT delete)", "View item catalog"]
  }
};

const quickActions = [
  { label: "Top outstanding balance", query: "Which client has the highest outstanding balance?", icon: TrendingUp },
  { label: "Total collected", query: "How much have I collected in total?", icon: DollarSign },
  { label: "Overdue invoices", query: "Which invoices are overdue?", icon: FileText },
  { label: "Role permissions", query: "What can each role do on PurpLedger?", icon: ShieldAlert },
  { label: "Client summary", query: "Give me a summary of all my clients", icon: Users },
  { label: "My Verification Status", query: "What is my current tier and KYC verification status?", icon: Crown },
];

export default function PurpBotPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Cached data for answering questions
  const [invoices, setInvoices] = useState<InvoiceWithClient[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [isSubscriptionExpired, setIsSubscriptionExpired] = useState(false);

  useEffect(() => {
    Promise.all([getInvoices(), getClients(), getAllTransactions(), getMerchant()]).then(
      ([inv, cli, txn, merch]) => {
        setInvoices(inv);
        setClients(cli);
        setTransactions(txn);
        setMerchant(merch);
        
        if (merch) {
          getActiveSubscription(merch.id).then((sub) => {
            if (sub && sub.status === "expired") {
              setIsSubscriptionExpired(true);
            }
          });
        }
        
        setDataReady(true);

        // Welcome message with real data
        const todayMs = new Date().setHours(0,0,0,0);
        const openCount = inv.filter((i) => i.status === "open" || i.status === "partially_paid").length;
        const overdueCount = inv.filter((i) => {
          if (i.status === "expired" || i.status === "overdue") return true;
          if ((i.status === "open" || i.status === "partially_paid") && i.pay_by_date) return new Date(i.pay_by_date).getTime() < todayMs;
          return false;
        }).length;
        const totalOutstanding = inv.reduce((s, i) => s + Number(i.outstanding_balance), 0);
        setMessages([
          {
            id: "welcome",
            role: "assistant",
            content: `Hi${merch ? ` ${merch.business_name.split(" ")[0]}` : ""}! I'm PurpBot, your read-only financial analyst. I've loaded your ledger — you have **${inv.length} invoices** (${openCount} active${overdueCount > 0 ? `, **${overdueCount} overdue ⚠**` : ""}) with **${formatNaira(totalOutstanding)}** outstanding. Ask me anything about your collections, clients, roles, or payment trends.`,
          },
        ]);
      }
    );
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Local AI: analyze data and generate responses
  const generateResponse = (query: string): { content: string; citations: string[] } => {
    const res = internalGenerateResponse(query);
    if (merchant?.verification_status !== "verified") {
      const q = query.toLowerCase();
      const paymentKeywords = ["payment link", "collect", "cash flow", "inflow", "share invoice", "pay", "revenue", "earned", "how much"];
      if (paymentKeywords.some(keyword => q.includes(keyword))) {
        const openInvoices = invoices.filter((i) => i.status === "open" || i.status === "partially_paid");
        res.content += `\n\nI can see you have **${openInvoices.length} outstanding invoice(s)**. To convert these into actual cash inflows, please complete your Identity Verification in Settings > Verification. It takes under 2 minutes for individuals.`;
      }
    }
    return res;
  };

  const internalGenerateResponse = (query: string): { content: string; citations: string[] } => {
    const q = query.toLowerCase();
    const citations: string[] = [];

    // KYC / Verification queries
    if (q.includes("verify") || q.includes("verification") || q.includes("kyc") || q.includes("onboarding") || q.includes("tier")) {
      let statusDetails = "";
      if (merchant?.verification_status === "verified") {
        statusDetails = `Your account is fully **Verified** and currently on **Tier: ${merchant.merchant_tier.toUpperCase()}**. You have full access to PurpLedger's features and your payment limits correspond to your tier.`;
      } else {
        const cacStatus = merchant?.cac_status || "Unverified";
        const bvnStatus = merchant?.bvn_status || "Unverified";
        const utilStatus = merchant?.utility_status || "Unverified";
        
        statusDetails = `Your account is currently on **Tier: ${merchant?.merchant_tier?.toUpperCase() || 'STARTER'}** and your overall verification status is **${merchant?.verification_status?.toUpperCase() || 'UNVERIFIED'}**.\n\nHere is your specific document status:\n• CAC: **${cacStatus}**\n• BVN: **${bvnStatus}**\n• Utility Bill: **${utilStatus}**\n\nTo upgrade to Tier 1 (₦500k limit) or Tier 2 (Unlimited), please go to **Settings > Account Verification** and submit any unverified documents. Admin review typically takes 24 hours.`;
      }
      
      return {
        content: statusDetails,
        citations: ["Account Settings", "Verification Status"],
      };
    }

    // Outstanding balance queries
    if (q.includes("outstanding") || q.includes("owe") || q.includes("balance") || q.includes("unpaid")) {
      const openInvoices = invoices.filter((i) => i.status === "open" || i.status === "partially_paid");
      const totalOutstanding = openInvoices.reduce((s, i) => s + Number(i.outstanding_balance), 0);

      if (q.includes("highest") || q.includes("most") || q.includes("top") || q.includes("which client")) {
        // Find client with highest outstanding
        const clientBalances: Record<string, { name: string; total: number; invoices: string[] }> = {};
        openInvoices.forEach((inv) => {
          const cid = inv.client_id;
          const name = inv.clients?.full_name || "Unknown";
          if (!clientBalances[cid]) clientBalances[cid] = { name, total: 0, invoices: [] };
          clientBalances[cid].total += Number(inv.outstanding_balance);
          clientBalances[cid].invoices.push(inv.invoice_number);
        });
        const sorted = Object.values(clientBalances).sort((a, b) => b.total - a.total);
        if (sorted.length > 0) {
          const top = sorted[0];
          citations.push(...top.invoices);
          citations.push(`Client: ${top.name}`);
          return {
            content: `**${top.name}** has the highest outstanding balance of **${formatNaira(top.total)}** across ${top.invoices.length} invoice(s): ${top.invoices.join(", ")}.${sorted.length > 1 ? `\n\nRunner-up: **${sorted[1].name}** with ${formatNaira(sorted[1].total)}.` : ""}`,
            citations,
          };
        }
      }

      // General outstanding summary
      return {
        content: `You have **${openInvoices.length} active invoice(s)** with a total outstanding balance of **${formatNaira(totalOutstanding)}**.${openInvoices.length > 0 ? `\n\nBreakdown:\n${openInvoices.map((i) => `• ${i.invoice_number} (${i.clients?.full_name || "Unknown"}): **${formatNaira(Number(i.outstanding_balance))}**`).join("\n")}` : ""}`,
        citations: openInvoices.map((i) => i.invoice_number),
      };
    }

    // Collection / revenue queries
    if (q.includes("collect") || q.includes("revenue") || q.includes("total") || q.includes("earned") || q.includes("how much")) {
      const totalCollected = invoices.reduce((s, i) => s + Number(i.amount_paid), 0);
      const totalInvoiced = invoices.reduce((s, i) => s + Number(i.grand_total), 0);
      const collectionRate = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0;

      return {
        content: `Here's your collection summary:\n\n• **Total Invoiced:** ${formatNaira(totalInvoiced)}\n• **Total Collected:** ${formatNaira(totalCollected)}\n• **Collection Rate:** ${collectionRate}%\n• **Outstanding:** ${formatNaira(totalInvoiced - totalCollected)}\n\nYou've processed **${transactions.filter((t) => t.status === "success").length} successful payments** via Paystack.`,
        citations: ["Revenue Summary"],
      };
    }

    // Overdue / expired queries
    if (q.includes("overdue") || q.includes("expired") || q.includes("late") || q.includes("past due")) {
      const todayMs = new Date().setHours(0,0,0,0);
      const overdue = invoices.filter((i) => {
        if (i.status === "expired" || i.status === "overdue") return true;
        if ((i.status === "open" || i.status === "partially_paid") && i.pay_by_date) return new Date(i.pay_by_date).getTime() < todayMs;
        return false;
      });
      if (overdue.length === 0) {
        return { content: "Great news — you have **no overdue invoices** at the moment. All pay-by dates are current.", citations: [] };
      }
      return {
        content: `You have **${overdue.length} overdue invoice(s)**:\n\n${overdue.map((i) => `• **${i.invoice_number}** — ${i.clients?.full_name || "Unknown"}: **${formatNaira(Number(i.outstanding_balance))}** outstanding (due ${i.pay_by_date ? new Date(i.pay_by_date).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "N/A"})`).join("\n")}\n\nTotal overdue balance: **${formatNaira(overdue.reduce((s, i) => s + Number(i.outstanding_balance), 0))}**`,
        citations: overdue.map((i) => i.invoice_number),
      };
    }

    // Client queries
    if (q.includes("client") || q.includes("customer")) {
      if (q.includes("summary") || q.includes("all") || q.includes("list")) {
        const clientData = clients.map((c) => {
          const cInvoices = invoices.filter((i) => i.client_id === c.id);
          const invoiced = cInvoices.reduce((s, i) => s + Number(i.grand_total), 0);
          const collected = cInvoices.reduce((s, i) => s + Number(i.amount_paid), 0);
          return { name: c.full_name, company: c.company_name, invoiceCount: cInvoices.length, invoiced, collected };
        });
        return {
          content: `You have **${clients.length} clients**:\n\n${clientData.map((c) => `• **${c.name}**${c.company ? ` (${c.company})` : ""} — ${c.invoiceCount} invoice(s), ${formatNaira(c.invoiced)} invoiced, ${formatNaira(c.collected)} collected`).join("\n")}`,
          citations: clients.map((c) => c.full_name),
        };
      }

      // Search for specific client
      const searchName = q.replace(/client|customer|about|tell me|info|details|summary/gi, "").trim();
      if (searchName.length > 2) {
        const found = clients.find(
          (c) =>
            c.full_name.toLowerCase().includes(searchName) ||
            (c.company_name && c.company_name.toLowerCase().includes(searchName))
        );
        if (found) {
          const cInvoices = invoices.filter((i) => i.client_id === found.id);
          const invoiced = cInvoices.reduce((s, i) => s + Number(i.grand_total), 0);
          const collected = cInvoices.reduce((s, i) => s + Number(i.amount_paid), 0);
          return {
            content: `**${found.full_name}**${found.company_name ? ` — ${found.company_name}` : ""}\n\n• Email: ${found.email || "—"}\n• Phone: ${found.phone || "—"}\n• Invoices: ${cInvoices.length}\n• Total Invoiced: ${formatNaira(invoiced)}\n• Total Collected: ${formatNaira(collected)}\n• Outstanding: ${formatNaira(invoiced - collected)}`,
            citations: cInvoices.map((i) => i.invoice_number),
          };
        }
      }
    }

    // Role / permission queries
    if (q.includes("role") || q.includes("permission") || q.includes("access") || q.includes("what can") || q.includes("who can") || q.includes("team member") || q.includes("invite")) {
      const roleNames = Object.keys(ROLE_KNOWLEDGE);
      const matchedRole = roleNames.find(r => q.includes(r));
      if (matchedRole) {
        const info = ROLE_KNOWLEDGE[matchedRole];
        return {
          content: `**${matchedRole.charAt(0).toUpperCase() + matchedRole.slice(1)} Role**\n\n${info.description}\n\n**Permissions:**\n${info.permissions.map(p => `• ${p}`).join("\n")}`,
          citations: ["Team & RBAC"],
        };
      }
      // General role overview
      return {
        content: `PurpLedger has **4 built-in roles**:\n\n**👑 Owner** — Full access to everything, including settlement account management and billing. Only one per workspace.\n\n**🛡️ Admin** — Broad operational access. Can manage invoices, clients, and team. Cannot void invoices, delete clients, or change the settlement account.\n\n**🧮 Accountant** — Financial operations only. Can create & edit invoices, record payments, view analytics. Cannot manage team or settings.\n\n**🎧 Support** — View-only access to invoices and clients. Can edit client info but cannot create invoices or view financial data.\n\nYou can also create **Custom Roles** with hand-picked permissions from Settings > Team.\n\nAsk me about a specific role, e.g. *"What can an accountant do?"*`,
        citations: ["Team & RBAC"],
      };
    }

    // Settlement queries
    if (q.includes("settlement") || q.includes("payout") || q.includes("bank account") || q.includes("disburse")) {
      return {
        content: `**Settlement Account** — this is the bank account where Paystack disburses funds from your Collection Invoices.\n\n• Only the **Owner** role can add or change the settlement account.\n• Configure it at **Settings > Settlement Account**.\n• Account must be verified (Paystack subaccount creation) before payouts begin.\n• A **1.5% + ₦100 Paystack fee** (capped at ₦2,000) is deducted per transaction in live mode.\n• In test mode, fees show as ₦0 — this is expected.`,
        citations: ["Settlement Settings"],
      };
    }

    // Catalog / discount queries
    if (q.includes("catalog") || q.includes("catalogue") || q.includes("item") || q.includes("discount template") || q.includes("discount")) {
      return {
        content: `**Item Catalog & Discount Templates:**\n\n**Item Catalog** (Settings > Item Catalog):\n• Save products/services with default rates for faster invoicing.\n• Use the *"Use Saved"* button on invoice line items to auto-fill name & rate.\n• Access: Owner & Admin can manage; Accountant & Support can view.\n\n**Discount Templates** (Settings > Discount Templates):\n• Save reusable discount percentages (e.g. Loyalty 10%, Early Payment 5%).\n• Apply them instantly when creating invoices via *"Use Template"*.\n• Access: Owner & Admin can manage; Accountant can view.`,
        citations: ["Item Catalog", "Discount Templates"],
      };
    }

    // Invoice queries
    if (q.includes("invoice") && (q.includes("how many") || q.includes("count") || q.includes("total") || q.includes("summary"))) {
      const todayMs = new Date().setHours(0,0,0,0);
      const statusCounts = {
        open: invoices.filter((i) => i.status === "open" && !(i.pay_by_date && new Date(i.pay_by_date).getTime() < todayMs)).length,
        partially_paid: invoices.filter((i) => i.status === "partially_paid" && !(i.pay_by_date && new Date(i.pay_by_date).getTime() < todayMs)).length,
        overdue: invoices.filter((i) => { if (i.status === "expired" || i.status === "overdue") return true; if ((i.status === "open" || i.status === "partially_paid") && i.pay_by_date) return new Date(i.pay_by_date).getTime() < todayMs; return false; }).length,
        closed: invoices.filter((i) => i.status === "closed").length,
        manually_closed: invoices.filter((i) => i.status === "manually_closed").length,
        void: invoices.filter((i) => i.status === "void").length,
      };
      return {
        content: `You have **${invoices.length} total invoices**:\n\n• Open: **${statusCounts.open}**\n• Partially Paid: **${statusCounts.partially_paid}**\n• Overdue: **${statusCounts.overdue}** ⚠\n• Closed: **${statusCounts.closed}**\n• Manually Closed: **${statusCounts.manually_closed}**\n• Void: **${statusCounts.void}**`,
        citations: ["Invoice Summary"],
      };
    }

    // Specific invoice lookup
    const invoiceMatch = q.match(/inv-?\d+-?\d+/i);
    if (invoiceMatch) {
      const invNum = invoiceMatch[0].toUpperCase().replace(/INV(\d+)(\d+)/, "INV-$1-$2");
      const found = invoices.find((i) => i.invoice_number.toLowerCase().includes(invNum.toLowerCase()));
      if (found) {
        return {
          content: `**${found.invoice_number}** — ${found.clients?.full_name || "Unknown"}\n\n• Status: ${found.status.replace("_", " ")}\n• Grand Total: ${formatNaira(Number(found.grand_total))}\n• Amount Paid: ${formatNaira(Number(found.amount_paid))}\n• Outstanding: ${formatNaira(Number(found.outstanding_balance))}\n• Fee Absorption: ${found.fee_absorption}\n• Pay-By: ${found.pay_by_date ? new Date(found.pay_by_date).toLocaleDateString("en-NG") : "—"}`,
          citations: [found.invoice_number, found.clients?.full_name || ""].filter(Boolean),
        };
      }
    }

    // Payment method queries
    if (q.includes("payment method") || q.includes("how did") || q.includes("card") || q.includes("bank")) {
      const successTxns = transactions.filter((t) => t.status === "success");
      const methods = { card: 0, bank_transfer: 0, ussd: 0 };
      successTxns.forEach((t) => { methods[t.payment_method] = (methods[t.payment_method] || 0) + 1; });
      return {
        content: `Payment method breakdown (${successTxns.length} successful transactions):\n\n• Card: **${methods.card}** payments\n• Bank Transfer: **${methods.bank_transfer}** payments\n• USSD: **${methods.ussd}** payments`,
        citations: ["Payment Analytics"],
      };
    }

    // Fee queries
    if (q.includes("fee") || q.includes("paystack") || q.includes("charge")) {
      const totalFees = transactions.filter((t) => t.status === "success").reduce((s, t) => s + Number(t.paystack_fee), 0);
      return {
        content: `Total Paystack fees across all successful transactions: **${formatNaira(totalFees)}**.\n\nYour default fee absorption setting is **"${merchant?.fee_absorption_default || "business"}"** (${merchant?.fee_absorption_default === "business" ? "you absorb fees" : "customer absorbs fees"}).`,
        citations: ["Fee Summary"],
      };
    }

    // Fallback — general help
    return {
      content: `I can help with questions like:\n\n**Financial:**\n• *"Which client has the highest outstanding balance?"*\n• *"How much have I collected in total?"*\n• *"Which invoices are overdue?"*\n• *"Tell me about INV-2025-001"*\n• *"What are my payment method breakdowns?"*\n\n**Team & Roles:**\n• *"What can an accountant do?"*\n• *"What are the differences between admin and support roles?"*\n• *"Who can manage the settlement account?"*\n\n**Platform:**\n• *"How does the item catalog work?"*\n• *"Tell me about settlement accounts"*\n• *"What is my current KYC status?"*\n\nTry one of these, or use the quick actions below!`,
      citations: [],
    };
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    processQuery(input);
  };

  const processQuery = (query: string) => {
    const userMsg: Message = { id: Date.now().toString(), role: "user", content: query };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    // Simulate brief thinking delay
    setTimeout(() => {
      const response = generateResponse(query);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: response.content,
        citations: response.citations.length > 0 ? response.citations : undefined,
      };
      setMessages((prev) => [...prev, aiMsg]);
      setIsLoading(false);
    }, 600 + Math.random() * 800);
  };

  const isStarter = (merchant?.subscription_plan || merchant?.merchant_tier || "starter") === "starter";

  if (isStarter) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 h-[calc(100vh-8rem)] flex flex-col items-center justify-center">
        <Card className="border-2 border-amber-200 bg-amber-50 shadow-none w-full max-w-lg">
          <CardContent className="p-10 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-4 border-2 border-amber-200">
              <Bot className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-bold text-amber-900 mb-2">PurpBot is Locked</h2>
            <p className="text-amber-700 max-w-md mx-auto mb-6 text-sm">
              Your current Starter plan does not include access to PurpBot AI. Upgrade your plan to get AI-powered financial insights, automated payment follow-ups, and natural language queries about your business data.
            </p>
            <a href="/settings/subscription">
              <Button className="bg-amber-600 hover:bg-amber-700 text-white font-bold border-2 border-amber-700">
                <Crown className="mr-2 h-4 w-4" />
                Upgrade Plan
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4 h-[calc(100vh-8rem)] flex flex-col">
      <div>
        <h1 className="text-2xl font-bold text-purp-900 flex items-center gap-2">
          <Bot className="h-6 w-6 text-purp-700" />
          PurpBot AI
        </h1>
        <p className="text-neutral-500 text-sm mt-1">
          Your read-only financial analyst. Ask questions about your ledger in plain English.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
        <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          <strong>Read-Only Guarantee:</strong> PurpBot operates with absolute read-only permissions at the database level. It cannot create, edit, or delete any invoices or client data.
        </p>
      </div>

      <Card className="flex-1 border-2 border-purp-200 shadow-none overflow-hidden flex flex-col min-h-0 bg-white">
        <div className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
          <div className="space-y-6">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-4 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <Avatar className={`h-8 w-8 border-2 flex-shrink-0 ${msg.role === "user" ? "border-purp-200" : "border-purp-700 bg-purp-100"}`}>
                  <AvatarFallback className={msg.role === "assistant" ? "text-purp-700 bg-transparent" : "bg-purp-100 text-purp-900 font-bold text-xs"}>
                    {msg.role === "user" ? "AP" : <Bot className="h-4 w-4" />}
                  </AvatarFallback>
                </Avatar>

                <div className={`flex flex-col gap-2 max-w-[80%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-line ${
                      msg.role === "user"
                        ? "bg-purp-900 text-white rounded-tr-sm"
                        : "bg-purp-50 border border-purp-200 text-neutral-900 rounded-tl-sm"
                    }`}
                    dangerouslySetInnerHTML={{
                      __html: msg.content
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                        .replace(/\*(.*?)\*/g, '<em>$1</em>')
                        .replace(/\n/g, '<br/>')
                    }}
                  />
                  {msg.citations && (
                    <div className="flex gap-2 flex-wrap">
                      {msg.citations.map((cite, i) => (
                        <div key={i} className="flex items-center gap-1 px-2 py-1 bg-white border border-purp-200 rounded-md text-xs text-purp-700">
                          <Sparkles className="h-3 w-3" />
                          {cite}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-4">
                <Avatar className="h-8 w-8 border-2 border-purp-700 bg-purp-100 flex-shrink-0">
                  <AvatarFallback className="text-purp-700 bg-transparent">
                    <Bot className="h-4 w-4" />
                  </AvatarFallback>
                </Avatar>
                <div className="px-4 py-3 bg-purp-50 border border-purp-200 rounded-2xl rounded-tl-sm flex items-center gap-1">
                  <div className="w-1.5 h-1.5 bg-purp-700 rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-1.5 h-1.5 bg-purp-700 rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-1.5 h-1.5 bg-purp-700 rounded-full animate-bounce" />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        {messages.length <= 1 && dataReady && (
          <div className="px-4 pb-2">
            <div className="flex flex-wrap gap-2">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => processQuery(action.query)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purp-700 bg-purp-50 border border-purp-200 rounded-full hover:bg-purp-100 transition-colors"
                >
                  <action.icon className="h-3 w-3" />
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <CardContent className="p-4 border-t-2 border-purp-200 bg-purp-50">
          <form onSubmit={handleSend} className="flex gap-3">
              {isSubscriptionExpired ? (
                <div className="flex-1 bg-red-50 border border-red-200 rounded-lg flex items-center justify-center p-4">
                  <div className="flex items-center gap-2 text-red-600 font-medium text-sm">
                    <ShieldAlert className="w-5 h-5" />
                    <span>PurpBot is deactivated. Please renew your subscription to ask questions.</span>
                  </div>
                </div>
              ) : (
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask a question about your ledger..."
                  className="flex-1 border-purp-200 bg-white"
                  disabled={isLoading || !dataReady}
                />
              )}
              <Button 
                type="submit" 
                className="h-12 px-6 bg-purp-900 hover:bg-purp-800 text-white flex-shrink-0"
                disabled={isLoading || !input.trim() || !dataReady || isSubscriptionExpired}
              >
                <Send className="h-4 w-4 mr-2" />
                Ask
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
