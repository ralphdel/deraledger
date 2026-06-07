"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Mail, RefreshCcw, Save, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  payment_purpose: "plan_subscription" | "plan_upgrade" | "plan_renewal" | "invoice_payment" | "payment_link" | "crypto_payment";
  payment_method: "card" | "bank_transfer" | "ussd" | "crypto";
  primary_provider: "paystack" | "monnify" | "breet";
  fallback_provider: "paystack" | "monnify" | "breet" | null;
  environment: "sandbox" | "live";
  is_enabled: boolean;
};

type PaymentMethodRow = {
  payment_purpose: "plan_subscription" | "plan_upgrade" | "plan_renewal" | "invoice_payment" | "payment_link" | "crypto_payment";
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
  paymentRecords: PaymentRecordRow[];
  transactions: PaymentTransactionRow[];
  pagination?: {
    events: PaginationMeta;
    paymentRecords: PaginationMeta;
    transactions: PaginationMeta;
  };
  diagnostics?: {
    eventsError: string | null;
    eventsWarning?: string | null;
    paymentRecordsError?: string | null;
    paymentRecordsWarning?: string | null;
    transactionsError: string | null;
  };
};

type PaginationMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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
  reconciliation_status?: string | null;
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

type PaymentRecordRow = {
  id: string;
  created_at: string | null;
  updated_at?: string | null;
  provider_name: "paystack" | "monnify" | "breet" | null;
  payment_method: string | null;
  payment_purpose: string | null;
  internal_reference: string | null;
  provider_reference: string | null;
  expected_amount: number | null;
  amount_paid: number | null;
  currency: string | null;
  payment_status: string | null;
  processing_status: string | null;
  account_setup_status: string | null;
  password_setup_required: boolean | null;
  customer_email: string | null;
  merchant_id: string | null;
  user_id: string | null;
  business_id: string | null;
  plan_id: string | null;
  plan_name: string | null;
  setup_recovery_email_sent_at: string | null;
  setup_recovery_email_count: number | null;
  setup_completed_at: string | null;
  reconciliation_status: string | null;
  failure_reason: string | null;
  raw_provider_payload: Record<string, unknown> | null;
};

const PROVIDERS = ["paystack", "monnify", "breet"] as const;
const PURPOSES = ["plan_subscription", "plan_upgrade", "plan_renewal", "invoice_payment", "payment_link"] as const;
const DEFAULT_PAGINATION: PaginationMeta = { page: 1, pageSize: 10, total: 0, totalPages: 1 };
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

export default function AdminPaymentsPage() {
  const [data, setData] = useState<PaymentAdminPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [providers, setProviders] = useState<PaymentProviderRow[]>([]);
  const [routes, setRoutes] = useState<PaymentRouteRow[]>([]);
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [resendingRecordId, setResendingRecordId] = useState<string | null>(null);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const [recordsPage, setRecordsPage] = useState(1);
  const [eventsPage, setEventsPage] = useState(1);
  const [transactionsPageSize, setTransactionsPageSize] = useState(10);
  const [recordsPageSize, setRecordsPageSize] = useState(10);
  const [eventsPageSize, setEventsPageSize] = useState(10);

  const load = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    const params = new URLSearchParams({
      transactionsPage: String(transactionsPage),
      recordsPage: String(recordsPage),
      eventsPage: String(eventsPage),
      transactionsPageSize: String(transactionsPageSize),
      recordsPageSize: String(recordsPageSize),
      eventsPageSize: String(eventsPageSize),
    });
    const response = await fetch(`/api/admin/payments?${params.toString()}`);
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
  }, [transactionsPage, recordsPage, eventsPage, transactionsPageSize, recordsPageSize, eventsPageSize]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [load]);

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
  const recentPaymentRecords = data?.paymentRecords || [];
  const recentTransactions = data?.transactions || [];
  const transactionsPagination = data?.pagination?.transactions || DEFAULT_PAGINATION;
  const recordsPagination = data?.pagination?.paymentRecords || DEFAULT_PAGINATION;
  const eventsPagination = data?.pagination?.events || DEFAULT_PAGINATION;

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

  async function resendSetupLink(record: PaymentRecordRow) {
    setResendingRecordId(record.id);
    setFeedback(null);
    const response = await fetch("/api/admin/payments/resend-setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paymentRecordId: record.id }),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) {
      setFeedback(payload.error || "Failed to resend setup link.");
      setResendingRecordId(null);
      return;
    }
    setFeedback(`Setup link resent to ${record.customer_email || "merchant"}.`);
    await load();
    setResendingRecordId(null);
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-neutral-900">Payment Operations</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Control provider status, checkout method visibility, and routing without changing checkout code.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Badge variant="outline" className="border-2 bg-neutral-50 uppercase">
            Environment: {environment}
          </Badge>
          <Button variant="outline" className="w-full gap-2 border-2 sm:w-auto" onClick={() => void load()}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
          <Button className="w-full gap-2 bg-purp-900 hover:bg-purp-800 sm:w-auto" onClick={() => void saveAll()} disabled={saving}>
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
          <Table className="min-w-[900px]">
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

      <Tabs defaultValue="recovery" className="min-w-0 max-w-full space-y-4 overflow-hidden">
        <div className="overflow-x-auto pb-1">
          <TabsList className="inline-flex min-w-max border bg-white">
            <TabsTrigger value="recovery">Subscription Records</TabsTrigger>
            <TabsTrigger value="events">Provider Events</TabsTrigger>
            <TabsTrigger value="transactions">Transactions</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="transactions" className="mt-0">
        <Card className="border shadow-none">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base">Recent Payment Transactions</CardTitle>
              <Badge variant="outline" className="border-2 bg-neutral-50">
                {transactionsPagination.total} total
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            {data?.diagnostics?.transactionsError ? (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                Transaction log query warning: {data.diagnostics.transactionsError}
              </div>
            ) : null}
            <Table className="min-w-[720px]">
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
            <PaginationControls
              label="transactions"
              pagination={transactionsPagination}
              onPageChange={setTransactionsPage}
              onPageSizeChange={(size) => {
                setTransactionsPage(1);
                setTransactionsPageSize(size);
              }}
            />
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="recovery" className="mt-0 w-full min-w-0 max-w-full overflow-hidden">
        <Card className="w-full min-w-0 max-w-full overflow-hidden border shadow-none">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base">Subscription Recovery Records</CardTitle>
              <Badge variant="outline" className="border-2 bg-neutral-50">
                {recordsPagination.total} records
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="w-full min-w-0 max-w-full overflow-hidden p-0">
            {data?.diagnostics?.paymentRecordsError ? (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                Recovery record query warning: {data.diagnostics.paymentRecordsError}
              </div>
            ) : null}
            {!data?.diagnostics?.paymentRecordsError && data?.diagnostics?.paymentRecordsWarning ? (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                Recovery record schema warning: {data.diagnostics.paymentRecordsWarning}
              </div>
            ) : null}
            <div className="block w-full max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-[1480px] min-w-[1480px] caption-bottom text-sm">
              <TableHeader>
                <TableRow className="bg-neutral-50">
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Setup</TableHead>
                  <TableHead>Expected</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Recovery Email</TableHead>
                  <TableHead>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentPaymentRecords.length === 0 ? (
                  <TableRow><TableCell colSpan={13} className="py-8 text-center text-sm text-neutral-500">No subscription recovery records yet.</TableCell></TableRow>
                ) : recentPaymentRecords.map((record) => {
                  const isExpanded = expandedRecordId === record.id;
                  const canResend = canResendSetupLink(record);
                  return (
                    <Fragment key={record.id}>
                      <TableRow className="align-top">
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setExpandedRecordId(isExpanded ? null : record.id)}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-neutral-500">{formatDate(record.created_at)}</TableCell>
                        <TableCell><Badge variant="outline" className="border-2 capitalize">{record.provider_name || "-"}</Badge></TableCell>
                        <TableCell className="capitalize">{record.payment_method || "-"}</TableCell>
                        <TableCell className="w-[150px] whitespace-normal text-xs">{record.payment_purpose || "-"}</TableCell>
                        <TableCell><EventStatusBadge status={record.processing_status || record.payment_status || "unknown"} /></TableCell>
                        <TableCell><EventStatusBadge status={record.account_setup_status || "unknown"} /></TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{formatNaira(Number(record.expected_amount || 0))}</TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{formatNaira(Number(record.amount_paid || 0))}</TableCell>
                        <TableCell className="w-[230px] whitespace-normal">
                          <p className="break-all font-mono text-xs text-neutral-900">{record.internal_reference || "-"}</p>
                          {record.provider_reference ? (
                            <p className="mt-1 break-all font-mono text-[11px] text-neutral-500">{record.provider_reference}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="w-[210px] whitespace-normal break-all text-xs">{record.customer_email || "-"}</TableCell>
                        <TableCell className="w-[160px] whitespace-normal text-xs text-neutral-600">
                          <p>{record.setup_recovery_email_count || 0} sent</p>
                          <p>{formatDate(record.setup_recovery_email_sent_at)}</p>
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-2 border-2"
                            disabled={!canResend || resendingRecordId === record.id}
                            onClick={() => void resendSetupLink(record)}
                          >
                            {resendingRecordId === record.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                            Resend
                          </Button>
                        </TableCell>
                      </TableRow>
                      {isExpanded ? (
                        <TableRow>
                          <TableCell colSpan={13} className="bg-neutral-50 p-0">
                            <div className="grid w-full min-w-0 max-w-full gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)]">
                              <div className="min-w-0 max-w-full rounded-lg border border-neutral-200 bg-white p-4">
                                <p className="text-xs font-semibold uppercase text-neutral-500">Recovery Summary</p>
                                <dl className="mt-3 space-y-2 text-sm">
                                  <EventDetail label="Payment status" value={record.payment_status} />
                                  <EventDetail label="Processing" value={record.processing_status} />
                                  <EventDetail label="Account setup" value={record.account_setup_status} />
                                  <EventDetail label="Reconciliation" value={record.reconciliation_status} />
                                  <EventDetail label="Password required" value={record.password_setup_required ? "yes" : "no"} />
                                  <EventDetail label="Setup completed" value={formatDate(record.setup_completed_at)} />
                                  <EventDetail label="Merchant" value={record.merchant_id} />
                                  <EventDetail label="User" value={record.user_id} />
                                  <EventDetail label="Business" value={record.business_id} />
                                  <EventDetail label="Plan" value={record.plan_name || record.plan_id} />
                                  <EventDetail label="Failure reason" value={record.failure_reason} />
                                </dl>
                              </div>
                              <div className="min-w-0 max-w-full rounded-lg border border-neutral-200 bg-white p-4">
                                <p className="text-xs font-semibold uppercase text-neutral-500">Raw Provider Payload</p>
                                <pre className="mt-3 max-h-[360px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-neutral-950 p-4 text-xs leading-relaxed text-neutral-100">
                                  {JSON.stringify(record.raw_provider_payload || {}, null, 2)}
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
            </table>
            </div>
            <PaginationControls
              label="recovery records"
              pagination={recordsPagination}
              onPageChange={setRecordsPage}
              onPageSizeChange={(size) => {
                setRecordsPage(1);
                setRecordsPageSize(size);
              }}
            />
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="events" className="mt-0">
        <Card className="border shadow-none">
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <CardTitle className="text-base">Recent Provider Events</CardTitle>
              <Badge variant="outline" className="border-2 bg-neutral-50">
                {eventsPagination.total} events
              </Badge>
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
            <Table className="min-w-[1000px]">
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
                                  <EventDetail label="Fee payer" value={details.feePayer || null} />
                                  <EventDetail
                                    label="Invoice credit"
                                    value={
                                      event.invoice_id && details.paidAmount !== null && details.paidAmount !== undefined
                                        ? formatNaira(details.paidAmount)
                                        : null
                                    }
                                  />
                                  <EventDetail label="Provider fee" value={details.providerFeeUsd ? `$${details.providerFeeUsd}` : null} />
                                  <EventDetail label="Merchant" value={event.merchant_id || details.merchantId} />
                                  <EventDetail label="Invoice" value={event.invoice_id || details.invoiceId} />
                                  <EventDetail label="Plan" value={details.planId} />
                                  <EventDetail label="Customer email" value={details.customerEmail} />
                                  <EventDetail label="Processing result" value={details.processingStatus} />
                                  <EventDetail
                                    label="Invoice credited"
                                    value={
                                      event.processor === "breet" &&
                                      (details.processingStatus === "awaiting_provider_completion" || event.event_type === "trade.pending")
                                        ? "No"
                                        : event.processor === "breet" && details.processingStatus === "completed"
                                          ? "Yes"
                                          : null
                                    }
                                  />
                                  <EventDetail
                                    label="Reason"
                                    value={
                                      event.processor === "breet" &&
                                      (details.processingStatus === "awaiting_provider_completion" || event.event_type === "trade.pending")
                                        ? "Awaiting terminal Breet event"
                                        : null
                                    }
                                  />
                                  <EventDetail label="Reconciliation" value={details.reconciliationStatus} />
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
            <PaginationControls
              label="provider events"
              pagination={eventsPagination}
              onPageChange={setEventsPage}
              onPageSizeChange={(size) => {
                setEventsPage(1);
                setEventsPageSize(size);
              }}
            />
          </CardContent>
        </Card>
        </TabsContent>
      </Tabs>

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
          <Table className="min-w-[860px]">
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

function PaginationControls({
  label,
  pagination,
  onPageChange,
  onPageSizeChange,
}: {
  label: string;
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const currentPage = Math.min(Math.max(pagination.page || 1, 1), Math.max(pagination.totalPages || 1, 1));
  const totalPages = Math.max(pagination.totalPages || 1, 1);
  const total = pagination.total || 0;
  const start = total === 0 ? 0 : (currentPage - 1) * pagination.pageSize + 1;
  const end = total === 0 ? 0 : Math.min(currentPage * pagination.pageSize, total);

  return (
    <div className="flex flex-col gap-3 border-t border-neutral-200 px-4 py-3 text-xs text-neutral-500 lg:flex-row lg:items-center lg:justify-between">
      <span>
        Showing {start}-{end} of {total} {label}
      </span>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span>Rows</span>
          <Select value={String(pagination.pageSize)} onValueChange={(value) => onPageSizeChange(Number(value) || 10)}>
            <SelectTrigger className="h-8 w-[84px] border-2 bg-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>{size}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-2"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          Previous
        </Button>
        <span className="min-w-[88px] text-center font-medium text-neutral-700">
          Page {currentPage} of {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 border-2"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function EventStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const className = normalized.includes("fail")
    ? "border-red-200 bg-red-50 text-red-700"
    : normalized.includes("pending") ||
        normalized.includes("received") ||
        normalized.includes("signature") ||
        normalized.includes("review") ||
        normalized.includes("mismatch") ||
        normalized.includes("under") ||
        normalized.includes("over")
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <Badge variant="outline" className={`border-2 capitalize ${className}`}>
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

function canResendSetupLink(record: PaymentRecordRow) {
  return (
    record.payment_status === "successful" &&
    record.processing_status === "processed" &&
    record.password_setup_required === true &&
    Boolean(record.customer_email) &&
    (record.account_setup_status === "active_pending_password" ||
      record.account_setup_status === "paid_pending_setup" ||
      record.account_setup_status === "active")
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
    reconciliationStatus: event.reconciliation_status,
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
    feePayer: null,
    providerFeeUsd: null,
  };
}

function getBreetProviderEventDetails(event: PaymentEventRow, payload: Record<string, unknown>) {
  const eventName = stringValue(payload.event) || event.event_type;
  const rawStatus = stringValue(payload.status);
  const accounting = asRecord(payload.deraledger_accounting);
  const amountUsd = numericValue(payload.amountInUSD);
  const conversionRate = numericValue(payload.rate);
  const estimatedNgn =
    numericValue(accounting.gross_provider_value_ngn) ||
    (amountUsd && conversionRate ? amountUsd * conversionRate : null);
  const amountSettledNgn =
    numericValue(accounting.amount_settled_ngn) ||
    numericValue(payload.amountSettled);
  const invoiceCreditAmount =
    numericValue(accounting.invoice_credit_amount) ||
    event.paid_amount ||
    null;
  const providerFeeAmount =
    numericValue(accounting.provider_fee_amount) ||
    event.fee ||
    null;
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
    purpose: event.payment_purpose || (event.invoice_id ? "invoice_payment" : null),
    method: "crypto",
    currency: "NGN",
    invoiceId: event.invoice_id,
    merchantId: event.merchant_id,
    planId: event.plan_id || null,
    customerEmail: event.customer_email || null,
    processingStatus: event.processing_status || status,
    reconciliationStatus: event.reconciliation_status,
    failureReason: event.failure_reason || null,
    expectedAmount: event.expected_amount ?? null,
    paidAmount: invoiceCreditAmount,
    fee: providerFeeAmount,
    walletAddress:
      stringValue(accounting.destination_address) ||
      stringValue(payload.address) ||
      stringValue(payload.destinationAddress),
    txHash: stringValue(payload.txHash) || stringValue(payload.tx_hash),
    cryptoAsset: stringValue(payload.asset),
    cryptoAmount: numericValue(payload.cryptoAmount),
    amountUsd,
    conversionRate,
    estimatedNgn,
    amountSettledNgn,
    feePayer: stringValue(accounting.fee_payer),
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
