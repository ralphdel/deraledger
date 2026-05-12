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

export default function SettlementSettingsPage() {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);

  const [banks, setBanks] = useState<Bank[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(true);

  const [selectedBankCode, setSelectedBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // Load merchant
    getMerchant().then((m) => {
      if (m) {
        setMerchant(m);
        if (m.settlement_bank_code) {
          setSelectedBankCode(m.settlement_bank_code);
          setAccountNumber(m.settlement_account_number || "");
          setAccountName(m.settlement_account_name || "");
        }
      }
      setLoading(false);
    });

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
    if (selectedBankCode && accountNumber.length === 10 && merchant?.subaccount_verified !== true) {
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
        } catch (err) {
          setResolveError("An error occurred during account verification.");
        } finally {
          setResolving(false);
        }
      };

      const timeoutId = setTimeout(resolveAccount, 1000); // debounce
      return () => clearTimeout(timeoutId);
    }
  }, [selectedBankCode, accountNumber, merchant]);

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
      // Update local merchant state
      setMerchant({
        ...merchant,
        settlement_bank_code: selectedBankCode,
        settlement_bank_name: bankName,
        settlement_account_number: accountNumber,
        settlement_account_name: accountName,
        subaccount_verified: true,
      });
    } else {
      setSaveError(result.error || "Failed to save settlement account.");
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
          <h1 className="text-2xl font-bold text-purp-900">Settlement Account</h1>
          <p className="text-neutral-500 text-sm mt-1">Configure where your funds are disbursed</p>
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

  const isVerified = merchant?.subaccount_verified === true;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link href="/settings" className="inline-flex items-center text-sm font-medium text-neutral-500 hover:text-purp-700 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to Settings
      </Link>
      
      <div>
        <h1 className="text-2xl font-bold text-purp-900">Settlement Account</h1>
        <p className="text-neutral-500 text-sm mt-1">
          Configure where funds from your Collection Invoices will be disbursed.
        </p>
      </div>

      {isVerified && (
        <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div>
            <h3 className="font-bold text-emerald-900">Settlement Account Active</h3>
            <p className="text-emerald-700 text-sm mt-1">
              Your account is successfully connected. Payments collected via your invoices will be automatically routed here.
            </p>
          </div>
        </div>
      )}

      <Card className="border-2 border-purp-200 shadow-none">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Banknote className="w-5 h-5 text-purp-700" />
            <CardTitle className="text-lg font-bold text-purp-900">Bank Details</CardTitle>
          </div>
          <CardDescription>
            {isVerified
              ? "Your current payout destination. Contact support to change."
              : "Enter your Nigerian bank account details to enable online payments."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>Select Bank</Label>
            <Select
              value={selectedBankCode}
              onValueChange={(v) => setSelectedBankCode(v ?? "")}
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
          <Button
            className="w-full h-11 bg-purp-900 hover:bg-purp-700 text-white font-semibold"
            disabled={!accountName || saving}
            onClick={handleSave}
          >
            {saving ? (isVerified ? "Updating..." : "Activating Account...") : (isVerified ? "Update Settlement Account" : "Confirm & Activate")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
