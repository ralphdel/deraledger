"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Shield, ShieldCheck, ShieldAlert, ToggleLeft, ToggleRight,
  RefreshCw, Save, CheckCircle, AlertTriangle, XCircle,
  Settings2, Activity, Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ProviderKey = "DOJAH" | "YOUVERIFY";
type HealthStatus = "ACTIVE" | "UNAVAILABLE" | "INSUFFICIENT_BALANCE" | "PERMISSION_ISSUE" | "UNCHECKED";

interface VerificationSettings {
  provider: ProviderKey;
  sandboxMode: boolean;
  health: Record<string, HealthStatus>;
}

const PROVIDER_META = {
  DOJAH: {
    label: "Dojah",
    description: "Nigerian fintech identity API. BVN + selfie via base64. CAC RC Number lookup.",
    docsUrl: "https://docs.dojah.io",
    color: "bg-purple-100 border-purple-200 text-purple-900",
    activeColor: "border-2 border-[#7B2FF7] bg-[#7B2FF7]/5",
  },
  YOUVERIFY: {
    label: "Youverify",
    description: "Youverify identity platform. BVN + selfie via image URL. CAC business lookup.",
    docsUrl: "https://docs.youverify.co",
    color: "bg-blue-100 border-blue-200 text-blue-900",
    activeColor: "border-2 border-blue-600 bg-blue-50/50",
  },
} as const;

function HealthBadge({ status }: { status: HealthStatus }) {
  switch (status) {
    case "ACTIVE":
      return (
        <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 gap-1 font-semibold">
          <CheckCircle className="h-3 w-3" /> Active
        </Badge>
      );
    case "UNAVAILABLE":
      return (
        <Badge className="bg-red-100 text-red-800 border border-red-200 gap-1 font-semibold">
          <XCircle className="h-3 w-3" /> Unavailable
        </Badge>
      );
    case "INSUFFICIENT_BALANCE":
      return (
        <Badge className="bg-amber-100 text-amber-800 border border-amber-200 gap-1 font-semibold">
          <AlertTriangle className="h-3 w-3" /> Insufficient Balance
        </Badge>
      );
    case "PERMISSION_ISSUE":
      return (
        <Badge className="bg-orange-100 text-orange-800 border border-orange-200 gap-1 font-semibold">
          <ShieldAlert className="h-3 w-3" /> Permission Issue
        </Badge>
      );
    case "UNCHECKED":
    default:
      return (
        <Badge className="bg-neutral-100 text-neutral-600 border border-neutral-200 gap-1">
          <Activity className="h-3 w-3" /> Not yet tested
        </Badge>
      );
  }
}

export default function VerificationSettingsPage() {
  const [settings, setSettings] = useState<VerificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  // Staged changes (not committed until "Save")
  const [stagedProvider, setStagedProvider] = useState<ProviderKey>("DOJAH");
  const [stagedSandbox, setStagedSandbox] = useState(true);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/verification-settings");
      if (res.ok) {
        const data: VerificationSettings = await res.json();
        setSettings(data);
        setStagedProvider(data.provider);
        setStagedSandbox(data.sandboxMode);
      }
    } catch {
      // silent — user will see stale state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(null);
    try {
      const res = await fetch("/api/admin/verification-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: stagedProvider,
          sandboxMode: stagedSandbox,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || "Save failed.");
      } else {
        setSaveSuccess("Verification settings saved successfully.");
        await loadSettings();
      }
    } catch {
      setSaveError("Network error — could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const isDirty =
    stagedProvider !== settings?.provider ||
    stagedSandbox !== settings?.sandboxMode;

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-neutral-900">Verification Settings</h1>
        <Card className="border shadow-none animate-pulse">
          <CardContent className="p-6">
            <div className="h-48 bg-neutral-100 rounded" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Verification Settings</h1>
          <p className="text-neutral-500 text-sm mt-1">
            Configure the active identity and business verification provider.
            Changes take effect immediately for all new verification requests.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-2"
          onClick={loadSettings}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Panel 1 — Active Provider Selector */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base font-semibold text-neutral-900 flex items-center gap-2">
            <Shield className="h-4 w-4 text-[#7B2FF7]" />
            Active Provider
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-neutral-500">
            Select the verification provider for all BVN, selfie, and CAC lookups.
            Existing in-progress verifications are not affected.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(["DOJAH", "YOUVERIFY"] as ProviderKey[]).map((key) => {
              const meta = PROVIDER_META[key];
              const isSelected = stagedProvider === key;
              const health = settings?.health?.[key] || "UNCHECKED";
              return (
                <button
                  key={key}
                  id={`provider-${key.toLowerCase()}`}
                  onClick={() => setStagedProvider(key)}
                  className={`text-left rounded-xl border p-4 transition-all cursor-pointer ${
                    isSelected
                      ? meta.activeColor + " shadow-sm"
                      : "border-neutral-200 bg-white hover:bg-neutral-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="font-semibold text-sm text-neutral-900">{meta.label}</span>
                    <div className="flex items-center gap-1.5">
                      {isSelected && (
                        <Badge className="bg-[#7B2FF7] text-white text-[10px] px-1.5 py-0.5 border-0">
                          Active
                        </Badge>
                      )}
                      <HealthBadge status={health} />
                    </div>
                  </div>
                  <p className="text-xs text-neutral-500 leading-relaxed">{meta.description}</p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Panel 2 — Sandbox Toggle */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base font-semibold text-neutral-900 flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Sandbox Mode
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-neutral-900">
                {stagedSandbox ? "Sandbox enabled" : "Sandbox disabled (Production)"}
              </p>
              <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">
                {stagedSandbox
                  ? "All verification requests will bypass strict checks. BVN and face match results are mocked. Safe for development."
                  : "Production mode. All verifications make real API calls and enforce strict name matching. Ensure provider balance is sufficient."}
              </p>
            </div>
            <button
              id="sandbox-toggle"
              onClick={() => setStagedSandbox((v) => !v)}
              className="shrink-0 transition-colors"
              aria-label="Toggle sandbox mode"
            >
              {stagedSandbox ? (
                <ToggleRight className="h-10 w-10 text-amber-500" />
              ) : (
                <ToggleLeft className="h-10 w-10 text-neutral-400" />
              )}
            </button>
          </div>
          {!stagedSandbox && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 leading-relaxed">
              <strong>Production mode warning:</strong> Real API calls will be made.
              Ensure provider credentials are live credentials and account balance is sufficient.
              Disabling sandbox will affect all verification requests immediately.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Panel 3 — Provider Health Monitor */}
      <Card className="border shadow-none">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base font-semibold text-neutral-900 flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-600" />
            Provider Health Monitor
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-2">
          <p className="text-xs text-neutral-500 mb-3">
            Health status is automatically updated when a verification request encounters a provider error.
            This is not a live ping — it reflects the most recent verification attempt.
          </p>
          {(["DOJAH", "YOUVERIFY"] as ProviderKey[]).map((key) => {
            const meta = PROVIDER_META[key];
            const health = (settings?.health?.[key] as HealthStatus) || "UNCHECKED";
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-neutral-50 border border-neutral-100"
              >
                <div>
                  <span className="text-sm font-medium text-neutral-900">{meta.label}</span>
                  {settings?.provider === key && (
                    <span className="ml-2 text-[10px] text-[#7B2FF7] font-semibold uppercase tracking-wide">
                      Active
                    </span>
                  )}
                </div>
                <HealthBadge status={health} />
              </div>
            );
          })}
          <p className="text-xs text-neutral-400 pt-1">
            Last refreshed: {new Date().toLocaleTimeString("en-NG")}
          </p>
        </CardContent>
      </Card>

      {/* Save / Status */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Button
          id="save-verification-settings"
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="gap-2 bg-[#7B2FF7] hover:bg-[#9B4FFF] text-white border-0 disabled:opacity-50"
        >
          {saving ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? "Saving..." : "Save Configuration"}
        </Button>
        {!isDirty && !saveSuccess && (
          <span className="text-xs text-neutral-400">No unsaved changes.</span>
        )}
        {isDirty && (
          <span className="text-xs text-amber-600 font-medium flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Unsaved changes
          </span>
        )}
        {saveError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {saveError}
          </div>
        )}
        {saveSuccess && (
          <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4" />
            {saveSuccess}
          </div>
        )}
      </div>
    </div>
  );
}
