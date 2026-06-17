"use client";

import { useState, useEffect } from "react";
import { Banknote, AlertTriangle, CheckCircle2, Lock, Loader2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMerchant } from "@/lib/data";
import type { Merchant } from "@/lib/types";
import { setupSettlementAccountAction } from "@/lib/actions";

interface Bank {
  name: string;
  code: string;
  active: boolean;
}

type PaymentMethodReadiness = {
  method: "card" | "bank_transfer" | "ussd" | "crypto";
  label: string;
  status: "ready" | "setup_in_progress" | "needs_attention" | "temporarily_unavailable" | "not_available";
  display_status?: string;
  message?: string | null;
  available?: boolean;
  affected?: boolean;
  action_label?: string | null;
};

type ReadinessBanner = {
  show: boolean;
  title: string;
  body: string;
  affected_methods: string[];
  action_label: string;
  href: string;
  action_method?: "card" | "bank_transfer" | "ussd" | "crypto" | "all" | null;
};

type SettlementAccountRecord = {
  id: string;
  bank_name?: string | null;
  account_number?: string | null;
  account_name?: string | null;
  currency?: string | null;
  is_default?: boolean | null;
};

export default function SettlementSettingsPage() {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);

  const [banks, setBanks] = useState<Bank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);
  const [settlementAccounts, setSettlementAccounts] = useState<SettlementAccountRecord[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [paymentMethodReadiness, setPaymentMethodReadiness] = useState<PaymentMethodReadiness[]>([]);
  const [readinessBanner, setReadinessBanner] = useState<ReadinessBanner | null>(null);
  const [hasPayoutAccount, setHasPayoutAccount] = useState(false);

  const [selectedBankCode, setSelectedBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [refreshingMethod, setRefreshingMethod] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const loadSettlementAccounts = async () => {
      await refreshSettlementAccounts();
    };

    // Load merchant
    getMerchant().then((m) => {
      if (m) {
        setMerchant(m);
        if (m.settlement_bank_code) {
          setSelectedBankCode(m.settlement_bank_code);
          setAccountNumber(m.settlement_account_number || "");
          setAccountName(m.settlement_account_name || "");
        }
        if (!m.settlement_bank_code || !m.settlement_account_number) {
          setIsEditing(true);
        }
      } else {
        setIsEditing(true);
      }
      setLoading(false);
    });

    void loadSettlementAccounts();

    // Load banks
    fetch("/api/payment/banks")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.data) {
          setBanks(data.data);
        }
      })
      .catch((err) => console.error("Failed to load banks:", err))
      .finally(() => setLoadingBanks(false));
  }, []);

  // Attempt to resolve account number when both bank and 10-digit account are present
  useEffect(() => {
    if (isEditing && selectedBankCode && accountNumber.length === 10) {
      const resolveAccount = async () => {
        setResolving(true);
        setResolveError(null);
        setAccountName("");

        try {
          const res = await fetch(
            `/api/payment/resolve-account?bank_code=${selectedBankCode}&account_number=${accountNumber}`
          );
          const data = await res.json();

          if (data.success && (data.data?.accountName || data.data?.account_name)) {
            setAccountName(data.data.accountName || data.data.account_name);
          } else {
            setResolveError(data.error || "Could not verify this account number.");
          }
        } catch {
          setResolveError("An error occurred during account verification.");
        } finally {
          setResolving(false);
        }
      };

      const timeoutId = setTimeout(resolveAccount, 1000); // debounce
      return () => clearTimeout(timeoutId);
    }
  }, [selectedBankCode, accountNumber, merchant, isEditing]);

  const handleSave = async () => {
    if (!merchant) return;
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);

    const bankName = banks.find((b) => b.code === selectedBankCode)?.name || "";

    const result = await setupSettlementAccountAction(merchant.id, {
      bankCode: selectedBankCode,
      bankName: bankName,
      accountNumber: accountNumber,
      accountName: accountName,
      businessName: merchant.business_name,
      email: merchant.email,
      phone: merchant.phone || "0000000000",
    });

    setSaving(false);

    if (result.success) {
      setSaveSuccess(true);
      setRefreshMessage("Payout account updated. We’re refreshing payment setup for this account.");
      setRefreshError(null);
      setLoadingAccounts(true);
      await triggerRefreshAll({ silentError: true });
      await refreshSettlementAccounts();
      // Update local merchant state
      setMerchant({
        ...merchant,
        settlement_bank_code: result.merchant?.settlement_bank_code || selectedBankCode,
        settlement_bank_name: result.merchant?.settlement_bank_name || bankName,
        settlement_account_number: result.merchant?.settlement_account_number || accountNumber,
        settlement_account_name: result.merchant?.settlement_account_name || accountName,
        subaccount_verified: result.merchant?.subaccount_verified ?? true,
        setup_mode: result.merchant?.setup_mode ?? merchant.setup_mode,
        live_features_enabled: result.merchant?.live_features_enabled ?? merchant.live_features_enabled,
        onboarding_status: result.merchant?.onboarding_status ?? merchant.onboarding_status,
        live_features_activated_at: result.merchant?.live_features_activated_at ?? merchant.live_features_activated_at,
        verification_status: result.merchant?.verification_status || merchant.verification_status,
      });
      setIsEditing(false);
    } else {
      setSaveError(result.error || "Failed to save settlement account.");
    }
  };

  const refreshSettlementAccounts = async () => {
    try {
      const response = await fetch("/api/merchant/settlement-accounts", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok) {
        setSettlementAccounts(payload.accounts || []);
        setPaymentMethodReadiness(payload.payment_method_readiness || []);
        setReadinessBanner(payload.readiness_banner || null);
        setHasPayoutAccount(Boolean(payload.has_payout_account || (payload.accounts || []).length));
      }
    } catch (error) {
      console.error("Failed to load settlement accounts:", error);
    } finally {
      setLoadingAccounts(false);
    }
  };

  const triggerRefreshAll = async (options?: { silentError?: boolean }) => {
    setRefreshingAll(true);
    if (!options?.silentError) {
      setRefreshMessage(null);
      setRefreshError(null);
    }
    try {
      const response = await fetch("/api/merchant/payout-setup/refresh-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to refresh payment setup.");
      }
      setPaymentMethodReadiness(payload.payment_method_readiness || []);
      setReadinessBanner(payload.readiness_banner || null);
      setHasPayoutAccount(Boolean(payload.has_payout_account || (payload.accounts || []).length || hasPayoutAccount));
      setRefreshMessage("Payment setup refreshed for your current payout account.");
    } catch (error) {
      if (!options?.silentError) {
        setRefreshError(error instanceof Error ? error.message : "Failed to refresh payment setup.");
      }
    } finally {
      setRefreshingAll(false);
    }
  };

  const triggerRefreshMethod = async (method: "card" | "bank_transfer" | "ussd" | "crypto") => {
    setRefreshingMethod(method);
    setRefreshMessage(null);
    setRefreshError(null);
    try {
      const response = await fetch("/api/merchant/payout-setup/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to refresh payment setup.");
      }
      setPaymentMethodReadiness(payload.payment_method_readiness || []);
      setReadinessBanner(payload.readiness_banner || null);
      setHasPayoutAccount(Boolean(payload.has_payout_account || hasPayoutAccount));
      setRefreshMessage(payload.message || "Payment setup refreshed.");
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Failed to refresh payment setup.");
    } finally {
      setRefreshingMethod(null);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-neutral-500">Loading settings...</div>;
  }

  // Restrict access for Starter tier if they can't collect online
  if (merchant?.subscription_plan === "starter") {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Payout Account</h1>
          <p className="text-neutral-500 text-sm mt-1">Configure the bank account where customer payments will settle.</p>
        </div>
        <Card className="border-2 border-amber-200 bg-amber-50">
          <CardContent className="p-6 text-center">
            <Lock className="w-12 h-12 mx-auto text-amber-500 mb-3 opacity-80" />
            <h3 className="font-bold text-amber-900 text-lg">Online Payments Locked</h3>
            <p className="text-amber-700 text-sm mt-2 max-w-md mx-auto">
              Your current Starter plan does not support online payment collection via the payment portal.
              Upgrade your plan to enable this feature and configure your settlement account.
            </p>
            <Button className="mt-4 bg-amber-600 hover:bg-amber-700 text-white">
              Upgrade to Individual
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isVerified = hasPayoutAccount || merchant?.subaccount_verified === true;
  const primaryAccount = settlementAccounts.find((account) => account.is_default) || settlementAccounts[0] || null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link href="/settings" className="inline-flex items-center text-sm font-medium text-neutral-500 hover:text-purp-700 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Settings
      </Link>
      
      <div>
        <h1 className="text-2xl font-bold text-purp-900">Payout Account</h1>
        <p className="text-neutral-500 text-sm mt-1">
          This is the bank account where you receive funds from customer payments.
        </p>
      </div>

      {readinessBanner?.show ? (
        <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-4">
          {(() => {
            const actionMethod = readinessBanner.action_method || null;
            const isMethodAction =
              actionMethod === "all" ||
              actionMethod === "card" ||
              actionMethod === "bank_transfer" ||
              actionMethod === "ussd" ||
              actionMethod === "crypto";

            return (
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <h2 className="font-semibold text-amber-900">{readinessBanner.title}</h2>
                <p className="mt-1 text-sm text-amber-800">{readinessBanner.body}</p>
                {readinessBanner.affected_methods?.length ? (
                  <p className="mt-2 text-xs font-medium text-amber-900">
                    Affected: {readinessBanner.affected_methods.join(", ")}
                  </p>
                ) : null}
              </div>
            </div>
            {isMethodAction ? (
              <Button
                variant="outline"
                className="border-amber-300 text-amber-900 hover:bg-amber-100"
                disabled={refreshingAll || Boolean(refreshingMethod)}
                onClick={() => {
                  if (actionMethod === "all") {
                    void triggerRefreshAll();
                    return;
                  }
                  if (actionMethod) {
                    void triggerRefreshMethod(actionMethod);
                  }
                }}
              >
                {(refreshingAll && actionMethod === "all") || refreshingMethod === actionMethod
                  ? "Refreshing..."
                  : readinessBanner.action_label}
              </Button>
            ) : (
              <Link href={readinessBanner.href}>
                <Button variant="outline" className="border-amber-300 text-amber-900 hover:bg-amber-100">
                  {readinessBanner.action_label}
                </Button>
              </Link>
            )}
          </div>
            );
          })()}
        </div>
      ) : null}

      {isVerified && !isEditing && (
        <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-bold text-emerald-900 text-lg">Your payout account is active</h3>
              <p className="text-emerald-700 text-sm mt-1 max-w-lg">
                When customers pay your invoices, eligible payment methods will settle to this account.
              </p>
              <div className="mt-4 bg-white/60 border border-emerald-200 rounded-lg p-3">
                <p className="text-sm font-semibold text-emerald-900">{merchant?.settlement_bank_name}</p>
                <p className="font-mono font-bold text-lg text-emerald-800">{primaryAccount?.account_number || maskAccountNumber(merchant?.settlement_account_number)}</p>
                <p className="text-xs text-emerald-700 uppercase tracking-wide mt-1">{merchant?.settlement_account_name}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                  disabled={refreshingAll || Boolean(refreshingMethod)}
                  onClick={() => void triggerRefreshAll()}
                >
                  {refreshingAll ? "Refreshing setup..." : "Refresh all payment setup"}
                </Button>
              </div>
              {refreshMessage ? (
                <p className="mt-3 text-xs font-medium text-emerald-800">{refreshMessage}</p>
              ) : null}
              {refreshError ? (
                <p className="mt-3 text-xs font-medium text-red-700">{refreshError}</p>
              ) : null}
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Payment methods for this payout account</p>
                {loadingAccounts ? (
                  <p className="text-xs text-emerald-700">Loading payment methods...</p>
                ) : paymentMethodReadiness.length ? (
                  paymentMethodReadiness.map((readiness) => (
                    <div key={readiness.method} className="rounded-lg border border-emerald-200 bg-white/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-emerald-950">
                          {readiness.label}
                        </p>
                        <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${paymentMethodStatusClassName(readiness.status)}`}>
                          {readiness.display_status || labelStatus(readiness.status)}
                        </span>
                      </div>
                      {readiness.message ? (
                        <p className="mt-2 text-xs text-amber-800">{readiness.message}</p>
                      ) : null}
                      {readiness.action_label ? (
                        <div className="mt-3">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={refreshingAll || Boolean(refreshingMethod)}
                            onClick={() => void triggerRefreshMethod(readiness.method)}
                            className="border-emerald-300 text-emerald-900 hover:bg-emerald-100"
                          >
                            {refreshingMethod === readiness.method ? "Refreshing setup..." : readiness.action_label}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-emerald-700">No payment methods are ready for this payout account yet.</p>
                )}
              </div>
            </div>
          </div>
          <Button 
            variant="outline" 
            onClick={() => setIsEditing(true)}
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-100 shrink-0"
          >
            Update Account
          </Button>
        </div>
      )}

      {(!isVerified || isEditing) && (
        <Card className="border-2 border-purp-200 shadow-none">
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <Banknote className="w-5 h-5 text-purp-700" />
              <CardTitle className="text-lg font-bold text-purp-900">
                {isVerified ? "Update Bank Details" : "Bank Details"}
              </CardTitle>
            </div>
            <CardDescription>
              {isVerified
                ? "Enter your new Nigerian bank account details. Future customer payments will settle here."
                : "Enter your Nigerian bank account details to receive customer payments."}
            </CardDescription>
            {isVerified && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 mt-2 flex gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-800 leading-relaxed">
                  <strong>Warning:</strong> Changing your payout account will immediately reroute future customer payments. Make sure these details are absolutely correct.
                </p>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>Select Bank</Label>
            <Select
              value={selectedBankCode}
              onValueChange={(v) => {
                setSelectedBankCode(v ?? "");
                setAccountName("");
                setResolveError(null);
              }}
              disabled={loadingBanks}
            >
              <SelectTrigger className="border-2 border-purp-200 bg-purp-50 h-11">
                <SelectValue placeholder={loadingBanks ? "Loading banks..." : "Choose your bank"} />
              </SelectTrigger>
              <SelectContent className="border-2 border-purp-200 max-h-[300px]">
                {banks.map((bank, idx) => (
                  <SelectItem key={`${bank.code}-${idx}`} value={bank.code}>
                    {bank.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Account Number</Label>
            <Input
              value={accountNumber}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                setAccountNumber(val);
                if (val.length < 10) {
                  setAccountName("");
                  setResolveError(null);
                }
              }}
              disabled={!selectedBankCode}
              placeholder="0123456789"
              className="border-2 border-purp-200 bg-purp-50 h-11"
              maxLength={10}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Account Name</Label>
            <div className="relative">
              <Input
                value={accountName}
                readOnly
                placeholder="Automatically resolved"
                className={`border-2 h-11 transition-colors ${
                  accountName ? "bg-emerald-50 border-emerald-400 text-emerald-900 font-semibold" : 
                  "bg-neutral-100 border-neutral-200 text-neutral-500"
                }`}
              />
              {resolving && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-purp-700 flex items-center gap-2 text-xs font-medium">
                  <Loader2 className="w-4 h-4 animate-spin" /> Resolving...
                </div>
              )}
            </div>
            {resolveError && (
              <p className="text-red-500 text-xs font-medium flex items-center gap-1 mt-1">
                <AlertTriangle className="w-3 h-3" /> {resolveError}
              </p>
            )}
            {accountName && (
              <p className="text-emerald-600 text-xs font-medium flex items-center gap-1 mt-1">
                <CheckCircle2 className="w-3 h-3" /> Account successfully verified
              </p>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start gap-2 mt-4">
            <AlertTriangle className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 leading-relaxed">
              By saving, you authorize Deraledger to disburse funds collected from your clients into this account. 
              Please ensure the account name matches your registered business name or personal name to avoid settlement delays.
            </p>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col gap-3 pt-2">
            {saveError && (
              <div className="w-full bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-100 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                {saveError}
              </div>
            )}
            {saveSuccess && (
              <div className="w-full bg-emerald-50 text-emerald-700 p-3 rounded-lg text-sm font-medium border border-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Settlement account {isVerified ? "updated" : "activated"} successfully!
              </div>
            )}
            <div className="flex gap-3">
              {isVerified && (
                <Button
                  variant="outline"
                  className="h-11 border-2 border-purp-200 w-full"
                  onClick={() => {
                    setIsEditing(false);
                    setSaveError(null);
                    setSaveSuccess(false);
                    // Reset to original values
                    if (merchant) {
                      setSelectedBankCode(merchant.settlement_bank_code || "");
                      setAccountNumber(merchant.settlement_account_number || "");
                      setAccountName(merchant.settlement_account_name || "");
                    }
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
              )}
              <Button
                className="w-full h-11 bg-purp-900 hover:bg-purp-700 text-white font-semibold"
                disabled={!accountName || saving}
                onClick={handleSave}
              >
                {saving ? (isVerified ? "Updating..." : "Activating Account...") : (isVerified ? "Update Payout Account" : "Confirm & Activate")}
              </Button>
            </div>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

function labelStatus(status?: string | null) {
  if (!status) return "Setup in progress";
  if (status === "ready") return "Ready";
  if (status === "setup_in_progress") return "Setup in progress";
  if (status === "needs_attention") return "Needs attention";
  if (status === "temporarily_unavailable") return "Temporarily unavailable";
  if (status === "not_available") return "Not available";
  return status.replaceAll("_", " ");
}

function paymentMethodStatusClassName(status?: string | null) {
  if (status === "ready") return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (status === "setup_in_progress") return "border-blue-300 bg-blue-50 text-blue-700";
  if (status === "temporarily_unavailable") return "border-amber-300 bg-amber-50 text-amber-700";
  if (status === "needs_attention") {
    return "border-red-300 bg-red-50 text-red-700";
  }
  return "border-neutral-300 bg-neutral-50 text-neutral-700";
}

function maskAccountNumber(accountNumber?: string | null) {
  if (!accountNumber) return "----";
  const digits = String(accountNumber);
  if (digits.startsWith("****")) return digits;
  return `****${digits.slice(-4) || "----"}`;
}
