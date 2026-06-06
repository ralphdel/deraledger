"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type PlatformSettings = {
  currentVersion: number;
  forceLogoutOnUpdate: boolean;
  title: string;
  summary: string;
  requiredAction: string;
  superadminSandboxEmail: string;
};

function normalizePlatformSettings(payload: Partial<PlatformSettings> | null | undefined): PlatformSettings {
  return {
    currentVersion: Math.max(1, Number(payload?.currentVersion || 1)),
    forceLogoutOnUpdate: Boolean(payload?.forceLogoutOnUpdate),
    title: payload?.title || "",
    summary: payload?.summary || "",
    requiredAction: payload?.requiredAction || "",
    superadminSandboxEmail: payload?.superadminSandboxEmail || "",
  };
}

export default function AdminSystemPage() {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [draft, setDraft] = useState<PlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/platform-settings")
      .then((res) => res.json())
      .then((payload) => {
        const normalized = normalizePlatformSettings(payload);
        setSettings(normalized);
        setDraft(normalized);
      })
      .catch(() => setFeedback("Could not load platform settings."))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setFeedback(null);
    const res = await fetch("/api/admin/platform-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setFeedback(payload.error || "Could not save platform settings.");
    } else {
      setSettings(draft);
      setFeedback("Platform update settings saved.");
    }
    setSaving(false);
  };

  const bumpVersion = () => {
    if (!draft) return;
    setDraft({ ...draft, currentVersion: Math.max(1, Number(draft.currentVersion || 1) + 1) });
  };

  if (loading || !draft) {
    return <div className="text-sm text-neutral-500">Loading system controls...</div>;
  }

  const hasVersionChanged = settings?.currentVersion !== draft.currentVersion;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">System Controls</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Manage platform update acknowledgements, one-time forced logout, and the superadmin sandbox exception.
        </p>
      </div>

      <Card className="border shadow-none">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-purp-700" />
            Platform Update State
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label>Current Platform Version</Label>
              <Input
                type="number"
                min={1}
                value={draft.currentVersion}
                onChange={(event) => setDraft({ ...draft, currentVersion: Number(event.target.value) })}
                className="max-w-xs"
              />
              <p className="text-xs text-neutral-500">
                Increasing this version forces users with older acknowledgements into the update flow.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={bumpVersion} className="border-purp-200">
              Bump Version
            </Button>
          </div>

          {hasVersionChanged && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              Saving this version will require existing non-exempt merchants to re-enter through the update acknowledgement flow.
            </div>
          )}

          <label className="flex items-start gap-3 rounded-lg border border-neutral-200 p-3">
            <input
              type="checkbox"
              checked={draft.forceLogoutOnUpdate}
              onChange={(event) => setDraft({ ...draft, forceLogoutOnUpdate: event.target.checked })}
              className="mt-1 h-4 w-4 accent-purp-700"
            />
            <span>
              <span className="block font-semibold text-sm text-neutral-900">Force one-time logout on new updates</span>
              <span className="block text-xs text-neutral-500 mt-0.5">
                Users are signed out once per platform version, then shown the update guidance after logging back in.
              </span>
            </span>
          </label>

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Update Title</Label>
              <Input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Update Summary</Label>
              <Textarea
                value={draft.summary}
                onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                className="min-h-24"
              />
            </div>
            <div className="space-y-2">
              <Label>Required User Action</Label>
              <Textarea
                value={draft.requiredAction}
                onChange={(event) => setDraft({ ...draft, requiredAction: event.target.value })}
                className="min-h-20"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border shadow-none">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-700" />
            Superadmin Safe Account
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2 max-w-lg">
            <Label>Safe Email</Label>
            <Input
              value={draft.superadminSandboxEmail}
              onChange={(event) => setDraft({ ...draft, superadminSandboxEmail: event.target.value })}
            />
          </div>
          <p className="text-xs text-neutral-500">
            This account is excluded from platform update forced logout and subscription expiry checks. Payment routing for this merchant is forced to sandbox.
          </p>
        </CardContent>
      </Card>

      {feedback && (
        <div className={`rounded-lg border p-3 text-sm ${feedback.includes("saved") ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`}>
          {feedback.includes("saved") && <CheckCircle2 className="mr-2 inline h-4 w-4" />}
          {feedback}
        </div>
      )}

      <Button onClick={save} disabled={saving} className="bg-purp-900 hover:bg-purp-800">
        {saving ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save System Controls
      </Button>
    </div>
  );
}
