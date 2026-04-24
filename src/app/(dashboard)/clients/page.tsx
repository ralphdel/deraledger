"use client";

import { useState, useEffect } from "react";
import { Users, Search, Plus, Mail, Phone, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { getClients, getInvoices, getMerchant } from "@/lib/data";
import { formatNaira } from "@/lib/calculations";
import { createClientAction } from "@/lib/actions";
import type { Client, InvoiceWithClient } from "@/lib/types";

export default function ClientsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<InvoiceWithClient[]>([]);
  const [loading, setLoading] = useState(true);
  
  // New client form state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [savingClient, setSavingClient] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [merchantId, setMerchantId] = useState("");

  const fetchData = () => {
    setLoading(true);
    Promise.all([getClients(), getInvoices(), getMerchant()]).then(([c, i, m]) => {
      setClients(c);
      setInvoices(i);
      if (m) setMerchantId(m.id);
      setLoading(false);
    });
  };

  useEffect(() => {
    fetchData();
  }, []);

  const filteredClients = clients.filter(
    (c) =>
      c.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.company_name && c.company_name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getClientStats = (clientId: string) => {
    const clientInvoices = invoices.filter((i) => i.client_id === clientId);
    const totalInvoiced = clientInvoices.reduce((s, i) => s + Number(i.grand_total), 0);
    const totalCollected = clientInvoices.reduce((s, i) => s + Number(i.amount_paid), 0);
    const outstanding = clientInvoices.reduce((s, i) => s + Number(i.outstanding_balance), 0);
    return { totalInvoiced, totalCollected, outstanding, count: clientInvoices.length };
  };

  const handleSaveClient = async () => {
    if (!fullName.trim() || !merchantId) {
      alert("Full Name is required.");
      return;
    }
    
    setSavingClient(true);
    const { success, error } = await createClientAction({
      full_name: fullName,
      email: email || undefined,
      phone: phone || undefined,
      company_name: companyName || undefined,
      merchant_id: merchantId,
    });
    
    if (success) {
      setDialogOpen(false);
      setFullName("");
      setEmail("");
      setPhone("");
      setCompanyName("");
      fetchData(); // Refresh the list
    } else {
      alert("Failed to save client: " + error);
    }
    setSavingClient(false);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div><h1 className="text-2xl font-bold text-purp-900">Clients</h1></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-2 border-purp-200 shadow-none animate-pulse">
              <CardContent className="p-5"><div className="h-24 bg-purp-50 rounded" /></CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Clients</h1>
          <p className="text-neutral-500 text-sm mt-1">
            Manage your client list and view their invoice history
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={<Button className="bg-purp-900 hover:bg-purp-700 text-white font-semibold" />}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Client
          </DialogTrigger>
          <DialogContent className="border-2 border-purp-200">
            <DialogHeader>
              <DialogTitle className="text-purp-900">Add New Client</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>Full Name *</Label>
                <Input 
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="border-2 border-purp-200 bg-purp-50 h-11" 
                  placeholder="Client full name" 
                />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-2 border-purp-200 bg-purp-50 h-11" 
                  placeholder="client@company.ng" 
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input 
                  type="tel" 
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="border-2 border-purp-200 bg-purp-50 h-11" 
                  placeholder="+234..." 
                />
              </div>
              <div className="space-y-2">
                <Label>Company Name</Label>
                <Input 
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="border-2 border-purp-200 bg-purp-50 h-11" 
                  placeholder="Optional" 
                />
              </div>
            </div>
            <DialogFooter>
              <Button 
                onClick={handleSaveClient}
                disabled={!fullName.trim() || savingClient}
                className="bg-purp-900 hover:bg-purp-700 text-white font-semibold"
              >
                {savingClient ? "Saving..." : "Save Client"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
        <Input
          placeholder="Search clients..."
          className="pl-10 border-2 border-purp-200 bg-white focus:border-purp-700"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Client Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredClients.map((client) => {
          const stats = getClientStats(client.id);
          return (
            <Card key={client.id} className="border-2 border-purp-200 shadow-none hover:border-purp-700 transition-colors">
              <CardContent className="p-5">
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-10 h-10 bg-purp-100 border-2 border-purp-200 rounded-full flex items-center justify-center flex-shrink-0">
                    <Users className="h-5 w-5 text-purp-700" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-purp-900 truncate">{client.full_name}</h3>
                    {client.company_name && (
                      <p className="text-xs text-neutral-500 flex items-center gap-1 mt-0.5">
                        <Building2 className="h-3 w-3" />
                        {client.company_name}
                      </p>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5 text-sm mb-4">
                  {client.email && (
                    <div className="flex items-center gap-2 text-neutral-500">
                      <Mail className="h-3.5 w-3.5" />
                      <span className="truncate">{client.email}</span>
                    </div>
                  )}
                  {client.phone && (
                    <div className="flex items-center gap-2 text-neutral-500">
                      <Phone className="h-3.5 w-3.5" />
                      <span>{client.phone}</span>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 pt-3 border-t-2 border-purp-200">
                  <div>
                    <p className="text-xs text-neutral-500">Invoiced</p>
                    <p className="text-sm font-bold text-purp-900">{formatNaira(stats.totalInvoiced)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-500">Collected</p>
                    <p className="text-sm font-bold text-emerald-600">{formatNaira(stats.totalCollected)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-neutral-500">Outstanding</p>
                    <p className="text-sm font-bold text-amber-600">{formatNaira(stats.outstanding)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filteredClients.length === 0 && (
        <div className="text-center py-12 text-neutral-500">
          No clients found matching your search.
        </div>
      )}
    </div>
  );
}
