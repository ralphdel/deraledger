"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Users, Search, Plus, Mail, Phone, Building2,
  Bell, BellOff, MessageCircle, AlertTriangle, Info, MapPin, Edit2, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { getClients, getInvoices, getMerchant } from "@/lib/data";
import { deleteClientAction } from "@/lib/actions";
import { formatNaira } from "@/lib/calculations";
import type { Client, InvoiceWithClient, Merchant } from "@/lib/types";
import { CreateClientModal } from "@/components/CreateClientModal";
import { PermissionGuard } from "@/components/PermissionGuard";

// ── Helper: channel label ─────────────────────────────────────────────────────
function channelLabel(channels: ("email" | "whatsapp")[]) {
  if (channels.includes("email") && channels.includes("whatsapp")) return "Email + WhatsApp";
  if (channels.includes("email")) return "Email only";
  if (channels.includes("whatsapp")) return "WhatsApp only";
  return "";
}

// ── Helper: normalise WhatsApp number for display ─────────────────────────────
function displayWhatsApp(raw: string | null): string {
  if (!raw) return "";
  if (raw.startsWith("234") && raw.length >= 13) return "0" + raw.slice(3);
  return raw;
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ClientsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<InvoiceWithClient[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clientToEdit, setClientToEdit] = useState<Client | null>(null);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Merchant context
  const [merchant, setMerchant] = useState<(Merchant & { permissions?: Record<string, boolean>; currentUserRole?: string }) | null>(null);
  const [merchantId, setMerchantId] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState("viewer");

  const fetchData = () => {
    setLoading(true);
    Promise.all([getClients(), getInvoices(), getMerchant()]).then(([c, i, m]) => {
      setClients(c);
      setInvoices(i);
      if (m) {
        setMerchant(m as any);
        setMerchantId(m.id);
        setCurrentUserRole(m.currentUserRole || "viewer");
      }
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, []);

  const filteredClients = clients.filter(
    (c) =>
      c.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.company_name && c.company_name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getClientStats = (clientId: string) => {
    const clientInvoices = invoices.filter((i) => i.client_id === clientId);
    const totalInvoiced = clientInvoices.reduce((s, i) => s + Number(i.amount_paid || 0) + Number(i.outstanding_balance || 0), 0);
    const totalCollected = clientInvoices.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
    const outstanding = clientInvoices.reduce((s, i) => s + Number(i.outstanding_balance || 0), 0);
    return { totalInvoiced, totalCollected, outstanding, count: clientInvoices.length };
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-bold text-purp-900 dark:text-white">Clients</h1></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-2 border-purp-200 dark:border-white/10 shadow-none animate-pulse dark:bg-[#1A0B2E]">
              <CardContent className="p-5"><div className="h-28 bg-purp-50 dark:bg-white/5 rounded" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PermissionGuard permission="view_clients" merchant={merchant} featureLabel="Clients">
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-purp-900 dark:text-white">Clients</h1>
          <p className="text-neutral-500 dark:text-white/60 text-sm mt-1">
            Manage your client list and view their invoice history
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/clients/bulk">
            <Button variant="outline" className="border-2 border-purp-200 dark:border-white/10 text-purp-700 dark:text-[#B58CFF] font-semibold bg-white dark:bg-transparent hover:bg-purp-50 dark:hover:bg-white/5">
              Bulk Upload
            </Button>
          </Link>
          <Button onClick={() => { setClientToEdit(null); setDialogOpen(true); }} className="bg-purp-900 hover:bg-purp-700 dark:bg-[#7B2FF7] dark:hover:bg-[#7B2FF7]/80 text-white font-semibold">
            <Plus className="mr-2 h-4 w-4" />
            Add Client
          </Button>
        </div>

        {/* Edit Client Modal */}
        <CreateClientModal
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setClientToEdit(null);
          }}
          onSuccess={() => {
            setDialogOpen(false);
            setClientToEdit(null);
            fetchData();
          }}
          merchantId={merchantId}
          clientToEdit={clientToEdit}
        />

        {/* Delete Client Modal */}
        <Dialog open={!!clientToDelete} onOpenChange={(open) => !open && setClientToDelete(null)}>
          <DialogContent className="border-2 border-red-200 dark:border-red-500/20 dark:bg-[#1A0B2E]">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
                <DialogTitle className="text-red-600 dark:text-red-400">Delete Client?</DialogTitle>
              </div>
              
              {clientToDelete && (() => {
                const clientInvoices = invoices.filter(i => i.client_id === clientToDelete.id);
                const openInvoices = clientInvoices.filter(i => i.status === "open" || i.status === "partially_paid");
                const hasOpen = openInvoices.length > 0;
                
                return (
                  <div className="pt-3 space-y-3">
                    {hasOpen ? (
                      <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-3 rounded-lg text-sm text-red-800 dark:text-red-200">
                        <strong>Warning:</strong> {clientToDelete.full_name} has <strong>{openInvoices.length} outstanding invoice(s)</strong>.
                        Deleting this client will permanently delete all associated invoices, transactions, and payment history.
                      </div>
                    ) : (
                      <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 p-3 rounded-lg text-sm text-amber-800 dark:text-amber-200">
                        <strong>Note:</strong> All records associated with {clientToDelete.full_name} (including past invoices) will be permanently deleted.
                      </div>
                    )}
                    <p className="text-sm text-neutral-600 dark:text-white/60">
                      Are you absolutely sure you want to delete <strong>{clientToDelete.full_name}</strong>? This action cannot be undone.
                    </p>
                  </div>
                );
              })()}
            </DialogHeader>
            <DialogFooter className="mt-4">
              <Button
                variant="outline"
                onClick={() => setClientToDelete(null)}
                disabled={isDeleting}
                className="border-2 border-neutral-200 dark:border-white/10 dark:text-white dark:hover:bg-white/5 hover:bg-neutral-50"
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!clientToDelete) return;
                  setIsDeleting(true);
                  const res = await deleteClientAction(clientToDelete.id);
                  setIsDeleting(false);
                  if (res.success) {
                    setClientToDelete(null);
                    fetchData();
                  } else {
                    alert(res.error);
                  }
                }}
                disabled={isDeleting}
                className="bg-red-600 hover:bg-red-700 text-white font-semibold border-2 border-red-600"
              >
                {isDeleting ? "Deleting..." : "Yes, Delete Client"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500 dark:text-white/50" />
        <Input
          placeholder="Search clients…"
          className="pl-10 border-2 border-purp-200 dark:border-white/10 bg-white dark:bg-[#1A0B2E] dark:text-white focus:border-purp-700 dark:focus:border-white/20"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Client Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredClients.map((client) => {
          const stats = getClientStats(client.id);
          return (
            <Card
              key={client.id}
              className="border-2 border-purp-200 dark:border-white/10 shadow-none hover:border-purp-700 dark:hover:border-white/30 dark:bg-[#1A0B2E] transition-colors"
            >
              <CardContent className="p-5">
                {/* Name + Company */}
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 bg-purp-100 dark:bg-white/5 border-2 border-purp-200 dark:border-white/10 rounded-full flex items-center justify-center flex-shrink-0">
                    <Users className="h-5 w-5 text-purp-700 dark:text-[#B58CFF]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-purp-900 dark:text-white truncate">{client.full_name}</h3>
                      <button
                        onClick={() => setClientToEdit(client)}
                        className="text-neutral-400 hover:text-purp-700 dark:hover:text-white transition-colors"
                        title="Edit client"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {currentUserRole === "owner" && (
                        <button
                          onClick={() => setClientToDelete(client)}
                          className="text-neutral-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                          title="Delete client"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {/* Reminder badge */}
                      {client.reminder_enabled && client.reminder_channels?.length > 0 && (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-purp-200 dark:border-white/10 text-purp-700 dark:text-[#B58CFF] bg-purp-50 dark:bg-white/5 px-1.5 py-0.5 shrink-0"
                        >
                          <Bell className="w-2.5 h-2.5 mr-0.5" />
                          {channelLabel(client.reminder_channels)}
                        </Badge>
                      )}
                      {client.reminder_enabled === false && (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-neutral-200 dark:border-white/10 text-neutral-400 dark:text-white/40 px-1.5 py-0.5 shrink-0"
                        >
                          <BellOff className="w-2.5 h-2.5 mr-0.5" />
                          No reminders
                        </Badge>
                      )}
                    </div>
                    {client.company_name && (
                      <p className="text-xs text-neutral-500 dark:text-white/50 flex items-center gap-1 mt-0.5">
                        <Building2 className="h-3 w-3 shrink-0" />
                        {client.company_name}
                      </p>
                    )}
                  </div>
                </div>

                {/* Contact info */}
                <div className="space-y-1.5 text-sm mb-4">
                  {client.email && (
                    <div className="flex items-center gap-2 text-neutral-500 dark:text-white/60">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{client.email}</span>
                    </div>
                  )}
                  {client.phone && (
                    <div className="flex items-center gap-2 text-neutral-500 dark:text-white/60">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span>{client.phone}</span>
                    </div>
                  )}
                  {client.whatsapp_number && (
                    <div className="flex items-center gap-2 text-neutral-500 dark:text-white/60">
                      <MessageCircle className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>{displayWhatsApp(client.whatsapp_number)}</span>
                    </div>
                  )}
                  {client.address && (
                    <div className="flex items-start gap-2 text-neutral-500 dark:text-white/60">
                      <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span className="line-clamp-2 text-xs">{client.address}</span>
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 pt-3 border-t-2 border-purp-200 dark:border-white/10">
                  <div>
                    <p className="text-xs text-neutral-500 dark:text-white/50">Invoiced</p>
                    <p className="text-sm font-bold text-purp-900 dark:text-white">{formatNaira(stats.totalInvoiced)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-500 dark:text-white/50">Collected</p>
                    <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatNaira(stats.totalCollected)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-500 dark:text-white/50">Outstanding</p>
                    <p className="text-sm font-bold text-amber-600 dark:text-amber-400">{formatNaira(stats.outstanding)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredClients.length === 0 && (
        <div className="text-center py-16 text-neutral-400 dark:text-white/40">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-neutral-500 dark:text-white/60">No clients found</p>
          <p className="text-sm mt-1">
            {searchQuery ? "Try a different search term." : "Add your first client to get started."}
          </p>
        </div>
      )}
    </div>
    </PermissionGuard>
  );
}
