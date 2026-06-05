"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2, Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function OnboardingSetPasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // The magic link from the welcome email lands here with tokens in the URL hash.
    // We must manually call setSession() because the @supabase/ssr client
    // does not auto-process URL hash tokens.
    const hash = window.location.hash;

    if (hash && hash.includes("access_token")) {
      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");

      if (accessToken && refreshToken) {
        supabase.auth
          .setSession({ access_token: accessToken, refresh_token: refreshToken })
          .then(({ data, error: sessionError }) => {
            if (sessionError || !data.session) {
              setError("This activation link has expired. Please contact support or request a new one.");
            } else {
              setSessionReady(true);
              window.history.replaceState(null, "", window.location.pathname);
            }
            setChecking(false);
          });
      } else {
        queueMicrotask(() => {
          setError("Invalid activation link. Please request a new one.");
          setChecking(false);
        });
      }
    } else {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setSessionReady(true);
        } else {
          setError("No active session. Please use the link from your welcome email.");
        }
        setChecking(false);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const strength = (p: string): { score: number; label: string; color: string } => {
    let score = 0;
    if (p.length >= 8) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    const labels = ["", "Weak", "Fair", "Good", "Strong"];
    const colors = ["", "#DC2626", "#D97706", "#2563EB", "#16A34A"];
    return { score, label: labels[score] || "", color: colors[score] || "" };
  };

  const passwordStrength = strength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User session lost.");

      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      // Clear the must_change_password flag so middleware doesn't force a reset loop
      await supabase
        .from("merchant_team")
        .update({ must_change_password: false })
        .eq("user_id", user.id);

      await fetch("/api/onboarding/mark-setup-complete", {
        method: "POST",
      }).catch(() => null);

      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to set password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="w-full flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="w-8 h-8 animate-spin text-purp-700" />
        <p className="text-neutral-500 text-sm">Activating your account…</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-purp-900 tracking-tight">Set Your Password</h1>
        <p className="text-neutral-500 mt-2">Choose a strong password to secure your account.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm font-medium border border-red-100 flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0 mt-1.5" />
            {error}
          </div>
        )}

        {sessionReady && (
          <>
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  className="focus:border-purp-700 h-12 pr-10"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {password && (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 rounded-full bg-neutral-200 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${(passwordStrength.score / 4) * 100}%`,
                        backgroundColor: passwordStrength.color,
                      }}
                    />
                  </div>
                  <span className="text-xs font-medium" style={{ color: passwordStrength.color }}>
                    {passwordStrength.label}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                required
                className="focus:border-purp-700 h-12"
                disabled={loading}
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-purp-900 hover:bg-purp-800 text-white h-12 text-base font-medium"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <span className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" />
                  Activate My Account
                </span>
              )}
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
