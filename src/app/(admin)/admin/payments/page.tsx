"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCcw, Save, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ProviderStatus =
  | "active"
  | "inactive"
  | "degraded"
  | "down"
  | "pending_live_approval"
  | "sandbox_only";

type PaymentProviderRow = {
  provider_name: "paystack" | "monnify" | "breet";
  environment: "sandbox" | "live";
  status: ProviderStatus;
  allow_degraded_routing: boolean;
  supports_card: boolean;
  supports_bank_transfer: boolean;
  supports_ussd: boolean;
  supports_crypto: boolean;
  public_key_hint: string | null;
  merchant_id_hint: string | null;
  webhook_secret_hint: string | null;
  last_health_check_at: string | null;
  last_successful_webhook_at: string | null;
  last_failed_webhook_at: string | null;
};

type PaymentRouteRow = {
  payment_purpose: "plan_subscription" | "plan_upgrade" | "invoice_payment" | "payment_link" | "crypto_payment";
  payment_method: "card" | "bank_transfer" | "ussd" | "crypto";
  primary_provider: "paystack" | "monnify" | "breet";
  fallback_provider: "paystack" | "monnify" | "breet" | null;
  environment: "sandbox" | "live";
  is_enabled: boolean;
};

type PaymentMethodRow = {
  payment_purpose: "plan_subscription" | "plan_upgrade" | "invoice_payment" | "payment_link" | "crypto_payment";
  payment_method: "card" | "bank_transfer" | "ussd" | "crypto";
  environment: "sandbox" | "live";
  is_enabled: boolean;
  display_label: string;
  display_description: string | null;
};

type PaymentAdminPayload = {
  environment: "sandbox" | "live";
  summary: {
    activeProviders: number;
    activeRoutes: number;
    activeMethods: number;
  };
  providers: PaymentProviderRow[];
  routes: PaymentRouteRow[];
  methods: PaymentMethodRow[];
  events: PaymentEventRow[];
  transactions: PaymentTransactionRow[];
  diagnostics?: {
    eventsError: string | null;
    eventsWarning?: string | null;
    transactionsError: string | null;
  };
};

type PaymentEventRow = {
  id: string;
  created_at: string | null;
  event_type: string;
  processor: string | null;
  processor_ref: string | null;
  amount_kobo: number | null;
  merchant_id: string | null;
  invoice_id: string | null;
  raw_payload: Record<string, unknown> | null;
  payment_method?: string | null;
  payment_purpose?: string | null;
  payment_reference?: string | null;
  provider_reference?: string | null;
  expected_amount?: number | null;
  paid_amount?: number | null;
  currency?: string | null;
  fee?: number | null;
  plan_id?: string | null;
  customer_email?: string | null;
  processing_status?: string | null;
  failure_reason?: string | null;
};

type PaymentTransactionRow = {
  id: string;
  created_at: string;
  invoice_id: string | null;
  merchant_id: string | null;
  amount_paid: number | null;
  payment_method: string | null;
  status: string | null;
  paystack_reference: string | null;
  processor_reference?: string | null;
};

const PROVIDERS = ["paystack", "monnify", "breet"] as const;
const PURPOSES = ["plan_subscription", "plan_upgrade", "invoice_payment", "payment_link"] as const;

export default function AdminPaymentsPage() {
  const [data, setData] = useState<PaymentAdminPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [providers, setProviders] = useState<PaymentProviderRow[]>([]);
  const [routes, setRoutes] = useState<PaymentRouteRow[]>([]);
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setFeedback(null);
    const response = await fetch("/api/admin/payments");
    const payload = (await response.json()) as PaymentAdminPayload | { error?: string };
    if (!response.ok || !("providers" in payload)) {
      setFeedback((payload as { error?: string }).error || "Failed to load payment settings.");
      setLoading(false);
      return;
    }
    setData(payload);
    setProviders(payload.providers);
    setRoutes(payload.routes);
    setMethods(payload.methods);
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const environment = data?.environment || "sandbox";

  const environmentProviders = useMemo(
    () => providers.filter((row) => row.environment === environment),
    [providers, environment]
  );
  const environmentRoutes = useMemo(
    () => routes.filter((row) => row.environment === environment),
    [routes, environment]
  );
  const environmentMethods = useMemo(
    () => methods.filter((row) => row.environment === environment),
    [methods, environment]
  );
  const recentEvents = data?.events || [];
  const recentTransactions = data?.transactions || [];

  function updateProvider(
    providerName: PaymentProviderRow["provider_name"],
    field: keyof PaymentProviderRow,
    value: PaymentProviderRow[keyof PaymentProviderRow]
  ) {
    setProviders((current) =>
      current.map((row) =>
        row.provider_name === providerName && row.environment === environment
          ? { ...row, [field]: value }
          : row
      )
    );
  }

  function updateRoute(
    purpose: PaymentRouteRow["payment_purpose"],
    method: PaymentRouteRow["payment_method"],
    field: keyof PaymentRouteRow,
    value: boolean | string | null
  ) {
    setRoutes((current) =>
      current.map((row) =>
        row.payment_purpose === purpose && row.payment_method === method && row.environment === environment
          ? { ...row, [field]: value }
          : row
      )
    );
  }

  function updateMethod(
    purpose: PaymentMethodRow["payment_purpose"],
    method: PaymentMethodRow["payment_method"],
    enabled: boolean
  ) {
    setMethods((current) =>
      current.map((row) =>
        row.payment_purpose === purpose && row.payment_method === method && row.environment === environment
          ? { ...row, is_enabled: enabled }
          : row
      )
    );
  }

  async function saveAll() {
    setSaving(true);
    setFeedback(null);
    const response = await fetch("/api/admin/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providers, routes, methods }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setFeedback(payload.error || "Failed to save payment settings.");
      setSaving(false);
      return;
    }
    setFeedback("Payment routing settings saved.");
    await load();
    setSaving(false);
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-16 text-neutral-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading payment operations...
      </div>
    );
  }

  if (!data) {
    return <div className="text-sm text-red-600">{feedback || "Payment settings unavailable."}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Payment Operations</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Control provider status, checkout method visibility, and routing without changing checkout code.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-2 bg-neutral-50 uppercase">
            Environment: {environment}
          </Badge>
          <Button variant="outline" className="gap-2 border-2" onClick={() => void load()}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
          <Button className="gap-2 bg-purp-900 hover:bg-purp-800" onClick={() => void saveAll()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Settings
          </Button>
        </div>
      </div>

      {feedback ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700">{feedback}</div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border shadow-none">
          <CardContent className="p-5">
            <p className="text-xs uppercase text-neutral-500 font-medium">Active Providers</p>
            <p className="mt-2 text-2xl font-bold text-neutral-900">{data.summary.activeProviders}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-none">
          <CardContent className="p-5">
            <p className="text-xs uppercase text-neutral-500 font-medium">Enabled Routes</p>
            <p className="mt-2 text-2xl font-bold text-neutral-900">{data.summary.activeRoutes}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-none">
          <CardContent className="p-5">
            <p className="text-xs uppercase text-neutral-500 font-medium">Visible Methods</p>
            <p className="mt-2 text-2xl font-bold text-neutral-900">{data.summary.activeMethods}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Provider Status</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-50">
                <TableHead>Provider</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Degraded Routing</TableHead>
                <TableHead>Card</TableHead>
                <TableHead>Transfer</TableHead>
                <TableHead>USSD</TableHead>
                <TableHead>Crypto</TableHead>
                <TableHead>Last Success</TableHead>
                <TableHead>Last Failure</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {environmentProviders.map((provider) => (
                <TableRow key={`${provider.provider_name}-${provider.environment}`}>
                  <TableCell className="font-medium capitalize">{provider.provider_name}</TableCell>
                  <TableCell>
                    <Select
                      value={provider.status}
                      onValueChange={(value) => updateProvider(provider.provider_name, "status", value)}
                    >
                      <SelectTrigger className="w-[180px] border-2 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">active</SelectItem>
                        <SelectItem value="inactive">inactive</SelectItem>
                        <SelectItem value="degraded">degraded</SelectItem>
                        <SelectItem value="down">down</SelectItem>
                        <SelectItem value="pending_live_approval">pending_live_approval</SelectItem>
                        <SelectItem value="sandbox_only">sandbox_only</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Switch checked={provider.allow_degraded_routing} onCheckedChange={(value) => updateProvider(provider.provider_name, "allow_degraded_routing", value)} /></TableCell>
                  <TableCell><Switch checked={provider.supports_card} onCheckedChange={(value) => updateProvider(provider.provider_name, "supports_card", value)} /></TableCell>
                  <TableCell><Switch checked={provider.supports_bank_transfer} onCheckedChange={(value) => updateProvider(provider.provider_name, "supports_bank_transfer", value)} /></TableCell>
                  <TableCell><Switch checked={provider.supports_ussd} onCheckedChange={(value) => updateProvider(provider.provider_name, "supports_ussd", value)} /></TableCell>
                  <TableCell><Switch checked={provider.supports_crypto} onCheckedChange={(value) => updateProvider(provider.provider_name, "supports_crypto", value)} /></TableCell>
                  <TableCell className="text-xs text-neutral-500">{formatDate(provider.last_successful_webhook_at)}</TableCell>
                  <TableCell className="text-xs text-neutral-500">{formatDate(provider.last_failed_webhook_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="border shadow-none">
          <CardHeader>
            <CardTitle className="text-base">Recent Payment Transactions</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {data?.diagnostics?.transactionsError ? (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                Transaction log query warning: {data.diagnostics.transactionsError}
              </div>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow className="bg-neutral-50">
                  <TableHead>Created</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentTransactions.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-neutral-500">No payment transactions yet.</TableCell></TableRow>
                ) : recentTransactions.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell className="text-xs text-neutral-500">{formatDate(transaction.created_at)}</TableCell>
                    <TableCell className="capitalize">{transaction.payment_method || "-"}</TableCell>
                    <TableCell><Badge variant="outline" className="border-2 capitalize">{transaction.status || "-"}</Badge></TableCell>
                    <TableCell className="font-medium">{formatNaira(Number(transaction.amount_paid || 0))}</TableCell>
                    <TableCell className="max-w-[180px] truncate font-mono text-xs">{transaction.processor_reference || transaction.paystack_reference || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border shadow-none">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base">Recent Provider Events</CardTitle>
              <Badge variant="outline" className="border-2 bg-neutral-50">{recentEvents.length} events</Badge>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {data?.diagnostics?.eventsError ? (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                Provider event query warning: {data.diagnostics.eventsError}
              </div>
            ) : null}
            {!data?.diagnostics?.eventsError && data?.diagnostics?.eventsWarning ? (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                Provider event schema warning: {data.diagnostics.eventsWarning}
              </div>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow className="bg-neutral-50">
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentEvents.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-neutral-500">No provider webhook events yet.</TableCell></TableRow>
                ) : recentEvents.map((event) => {
                  const details = getProviderEventDetails(event);
                  const isExpanded = expandedEventId === event.id;
                  return (
                    <Fragment key={event.id}>
                      <TableRow key={event.id} className="align-top">
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-neutral-500">{formatDate(event.created_at)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="border-2 capitalize">{event.processor || "-"}</Badge>
                        </TableCell>
                        <TableCell className="min-w-[220px]">
                          <p className="font-medium text-neutral-900">{formatEventName(event.event_type)}</p>
                          <p className="text-xs text-neutral-500">{details.method || "method unknown"}</p>
                        </TableCell>
                        <TableCell>
                          <EventStatusBadge status={details.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{formatNaira(Number(event.amount_kobo || 0) / 100)}</TableCell>
                        <TableCell className="min-w-[240px]">
                          <p className="font-mono text-xs text-neutral-900 break-all">{event.processor_ref || "-"}</p>
                          {details.providerReference && details.providerReference !== event.processor_ref ? (
                            <p className="mt-1 font-mono text-[11px] text-neutral-500 break-all">{details.providerReference}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="min-w-[180px] font-mono text-xs text-neutral-600 break-all">
                          {event.invoice_id || details.invoiceId || "-"}
                        </TableCell>
                      </TableRow>
                      {isExpanded ? (
                        <TableRow key={`${event.id}-details`}>
                          <TableCell colSpan={8} className="bg-neutral-50 p-0">
                            <div className="grid gap-4 p-4 lg:grid-cols-[320px_1fr]">
                              <div className="rounded-lg border border-neutral-200 bg-white p-4">
                                <p className="text-xs font-semibold uppercase text-neutral-500">Event Summary</p>
                                <dl className="mt-3 space-y-2 text-sm">
                                  <EventDetail label="Payment ref" value={details.paymentReference || event.processor_ref} />
                                  <EventDetail label="Provider ref" value={details.providerReference} />
                                  <EventDetail label="Purpose" value={details.purpose} />
                                  <EventDetail label="Method" value={details.method} />
                                  <EventDetail label="Currency" value={details.currency} />
                                  <EventDetail label="Expected amount" value={details.expectedAmount ? formatNaira(details.expectedAmount) : null} />
                                  <EventDetail label="Paid amount" value={details.paidAmount ? formatNaira(details.paidAmount) : null} />
                                  <EventDetail label="Fee" value={details.fee ? formatNaira(details.fee) : null} />
                                  <EventDetail label="Wallet address" value={details.walletAddress} />
                                  <EventDetail label="Tx hash" value={details.txHash} />
                                  <EventDetail label="Crypto asset" value={details.cryptoAsset} />
                                  <EventDetail label="Crypto amount" value={details.cryptoAmount} />
                                  <EventDetail label="USD amount" value={details.amountUsd} />
                                  <EventDetail label="Rate" value={details.conversionRate} />
                                  <EventDetail label="Estimated NGN" value={details.estimatedNgn ? formatNaira(details.estimatedNgn) : null} />
                                  <EventDetail label="Amount settled" value={details.amountSettledNgn !== null && details.amountSettledNgn !== undefined ? formatNaira(details.amountSettledNgn) : null} />
                                  <EventDetail label="Provider fee" value={details.providerFeeUsd ? `$${details.providerFeeUsd}` : null} />
                                  <EventDetail label="Merchant" value={event.merchant_id || details.merchantId} />
                                  <EventDetail label="Invoice" value={event.invoice_id || details.invoiceId} />
                                  <EventDetail label="Plan" value={details.planId} />
                                  <EventDetail label="Customer email" value={details.customerEmail} />
                                  <EventDetail label="Processing result" value={details.processingStatus} />
                                  <EventDetail label="Failure reason" value={details.failureReason} />
                                </dl>
                              </div>
                              <div className="rounded-lg border border-neutral-200 bg-white p-4">
                                <p className="text-xs font-semibold uppercase text-neutral-500">Raw Provider Payload</p>
                                <pre className="mt-3 max-h-[360px] overflow-auto rounded-md bg-neutral-950 p-4 text-xs leading-relaxed text-neutral-100">
                                  {JSON.stringify(event.raw_payload || {}, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="border shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Checkout Method Visibility</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {PURPOSES.map((purpose) => (
            <div key={purpose} className="rounded-xl border border-neutral-200 p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-neutral-900">{purpose.replaceAll("_", " ")}</p>
                  <p className="text-xs text-neutral-500">These toggles decide what checkout methods the frontend can display.</p>
                </div>
                <Badge variant="outline" className="border-2 bg-neutral-50 uppercase">{environment}</Badge>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {environmentMethods
                  .filter((row) => row.payment_purpose === purpose)
                  .map((method) => (
                    <div key={`${purpose}-${method.payment_method}`} className="rounded-lg border border-neutral-200 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-neutral-900">{method.display_label}</p>
                          <p className="text-xs text-neutral-500">{method.display_description}</p>
                        </div>
                        <Switch
                          checked={method.is_enabled}
                          onCheckedChange={(value) => updateMethod(purpose, method.payment_method, value)}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Provider Routing</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-neutral-50">
                <TableHead>Purpose</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Primary</TableHead>
                <TableHead>Fallback</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {environmentRoutes.map((route) => (
                <TableRow key={`${route.payment_purpose}-${route.payment_method}-${route.environment}`}>
                  <TableCell className="font-medium">{route.payment_purpose}</TableCell>
                  <TableCell>{route.payment_method}</TableCell>
                  <TableCell>
                    <Switch
                      checked={route.is_enabled}
                      onCheckedChange={(value) => updateRoute(route.payment_purpose, route.payment_method, "is_enabled", value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={route.primary_provider}
                      onValueChange={(value) => updateRoute(route.payment_purpose, route.payment_method, "primary_provider", value)}
                    >
                      <SelectTrigger className="w-[160px] border-2 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROVIDERS.map((provider) => (
                          <SelectItem key={provider} value={provider}>{provider}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={route.fallback_provider || "none"}
                      onValueChange={(value) =>
                        updateRoute(route.payment_purpose, route.payment_method, "fallback_provider", value === "none" ? null : value)
                      }
                    >
                      <SelectTrigger className="w-[160px] border-2 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">none</SelectItem>
                        {PROVIDERS.map((provider) => (
                          <SelectItem key={provider} value={provider}>{provider}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border shadow-none">
        <CardContent className="flex items-start gap-3 p-5 text-sm text-neutral-600">
          <ShieldCheck className="mt-0.5 h-4 w-4 text-neutral-500" />
          <p>
            Checkout pages only receive enabled methods from the backend. Even if a provider is configured in the
            database, it will stay hidden if its credentials are missing or its status does not allow routing in the
            current environment.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-NG", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EventStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const className = normalized.includes("fail")
    ? "border-red-200 bg-red-50 text-red-700"
    : normalized.includes("pending") || normalized.includes("received") || normalized.includes("signature")
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <Badge variant="outline" className={`border-2 capitalize ${className}`}>
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

function EventDetail({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-0.5 break-all font-mono text-xs text-neutral-900">{formatDetailValue(value)}</dd>
    </div>
  );
}

function getProviderEventDetails(event: PaymentEventRow) {
  const payload = asRecord(event.raw_payload);
  if (event.processor === "breet") {
    return getBreetProviderEventDetails(event, payload);
  }

  const eventData = asRecord(payload.eventData) || asRecord(payload.data) || payload;
  const product = asRecord(eventData.product);
  const metadata = asRecord(eventData.metaData) || asRecord(eventData.metadata) || payload;
  const eventStatus = String(eventData.paymentStatus || eventData.status || payload.eventType || event.event_type || "");
  const eventType = event.event_type.toLowerCase();
  const status =
    event.processing_status ||
    (eventType.includes("processing_failed") || eventType.includes("signature_failed") || eventType.includes("failed")
      ? lastSegment(event.event_type, ":") || "failed"
      : eventType.includes("received")
        ? "received"
        : eventType.includes("processed") || eventType.includes("success") || eventStatus.toLowerCase().includes("paid")
          ? "successful"
          : eventStatus || "unknown");

  return {
    status,
    paymentReference: event.payment_reference || stringValue(eventData.paymentReference) || stringValue(product.reference) || event.processor_ref,
    providerReference:
      event.provider_reference ||
      stringValue(eventData.transactionReference) ||
      stringValue(eventData.providerReference) ||
      stringValue(eventData.processorReference),
    purpose:
      event.payment_purpose ||
      stringValue(metadata.payment_purpose) ||
      stringValue(metadata.type) ||
      stringValue(eventData.paymentDescription),
    method:
      event.payment_method ||
      stringValue(eventData.paymentMethod) ||
      stringValue(metadata.payment_method_requested) ||
      stringValue(metadata.payment_method),
    currency: event.currency || stringValue(eventData.currency) || stringValue(eventData.currencyCode),
    invoiceId: stringValue(metadata.invoice_id),
    merchantId: stringValue(metadata.merchant_id),
    planId: event.plan_id || stringValue(metadata.new_plan) || stringValue(metadata.plan),
    customerEmail: event.customer_email || stringValue(metadata.email) || stringValue(eventData.customerEmail),
    processingStatus: event.processing_status,
    failureReason: event.failure_reason,
    expectedAmount: event.expected_amount ?? null,
    paidAmount: event.paid_amount ?? (event.amount_kobo ? Number(event.amount_kobo) / 100 : null),
    fee: event.fee ?? null,
    walletAddress: null,
    txHash: null,
    cryptoAsset: null,
    cryptoAmount: null,
    amountUsd: null,
    conversionRate: null,
    estimatedNgn: null,
    amountSettledNgn: null,
    providerFeeUsd: null,
  };
}

function getBreetProviderEventDetails(event: PaymentEventRow, payload: Record<string, unknown>) {
  const eventName = stringValue(payload.event) || event.event_type;
  const rawStatus = stringValue(payload.status);
  const amountUsd = numericValue(payload.amountInUSD);
  const conversionRate = numericValue(payload.rate);
  const estimatedNgn = amountUsd && conversionRate ? amountUsd * conversionRate : null;
  const amountSettledNgn = numericValue(payload.amountSettled);
  const status = (() => {
    const normalized = `${eventName} ${rawStatus || ""}`.toLowerCase();
    if (normalized.includes("address.created")) return "address created";
    if (normalized.includes("completed")) return "completed";
    if (normalized.includes("pending")) return "pending";
    if (normalized.includes("flagged")) return "manual review";
    return rawStatus || "received";
  })();

  return {
    status,
    paymentReference: event.processor_ref,
    providerReference: stringValue(payload.id) || event.processor_ref,
    purpose: event.invoice_id ? "invoice_payment" : null,
    method: "crypto",
    currency: "NGN",
    invoiceId: event.invoice_id,
    merchantId: event.merchant_id,
    planId: event.plan_id || null,
    customerEmail: event.customer_email || null,
    processingStatus: event.processing_status || status,
    failureReason: event.failure_reason || null,
    expectedAmount: event.expected_amount ?? null,
    paidAmount: event.paid_amount ?? null,
    fee: event.fee ?? null,
    walletAddress: stringValue(payload.address) || stringValue(payload.destinationAddress),
    txHash: stringValue(payload.txHash) || stringValue(payload.tx_hash),
    cryptoAsset: stringValue(payload.asset),
    cryptoAmount: numericValue(payload.cryptoAmount),
    amountUsd,
    conversionRate,
    estimatedNgn,
    amountSettledNgn,
    providerFeeUsd: numericValue(payload.feeAmountInUsd),
  };
}

function formatEventName(value: string) {
  return value.replaceAll(":", " / ").replaceAll("_", " ");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numericValue(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function lastSegment(value: string, separator: string) {
  const parts = value.split(separator);
  return parts[parts.length - 1];
}

function formatDetailValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatNaira(value: number) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(value);
}
