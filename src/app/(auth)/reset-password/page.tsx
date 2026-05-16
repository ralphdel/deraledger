"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    /**
     * The @supabase/ssr client does NOT auto-process URL hash tokens.
     * Supabase's generateLink('recovery') sends an implicit-flow link where
     * the tokens arrive in the URL hash:
     *   /reset-password#access_token=...&refresh_token=...&type=recovery
     *
     * We must manually parse them and call setSession() ourselves.
     */
    const hash = window.location.hash;

    if (hash && hash.includes("access_token")) {
      const params = new URLSearchParams(hash.substring(1)); // strip leading #
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const type = params.get("type");

      if (accessToken && refreshToken && type === "recovery") {
        supabase.auth
          .setSession({ access_token: accessToken, refresh_token: refreshToken })
          .then(({ data, error: sessionError }) => {
            if (sessionError || !data.session) {
              setError(
                "This reset link is invalid or has expired. Please request a new one."
              );
            } else {
              setSessionReady(true);
              // Clean up the hash so tokens aren't visible in the URL bar
              window.history.replaceState(
                null,
                "",
                window.location.pathname
              );
            }
            setChecking(false);
          });
      } else {
        setError(
          "Invalid reset link. Please request a new password reset."
        );
        setChecking(false);
      }
    } else {
      // No hash — check if user already has an active session (e.g. page refresh)
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          setSessionReady(true);
        } else {
          setError(
            "Auth session missing! Please click the link in your email again."
          );
        }
        setChecking(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });
      if (updateError) throw updateError;

      await supabase.auth.signOut();
      router.push("/login?reset=success");
    } catch (err: any) {
      setError(err.message || "Failed to update password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (checking) {
    return (
      <div className="w-full flex flex-col items-center justify-center gap-4 py-16">
        <Loader2 className="w-8 h-8 animate-spin text-[#B58CFF]" />
        <p className="text-white/60 text-sm">Verifying your reset link…</p>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="w-full">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white tracking-tight">
          Create New Password
        </h1>
        <p className="text-white/60 mt-2">
          Your new password must be at least 8 characters.
        </p>
      </div>

      <form onSubmit={handleResetPassword} className="space-y-5">
        {error && (
          <div className="bg-red-500/10 text-red-400 p-3 rounded-lg text-sm font-medium border border-red-500/30 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}

        {sessionReady && (
          <>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-white/80">New Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
                className="h-12 border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] placeholder:text-white/30"
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-white/80">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                required
                className="h-12 border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] placeholder:text-white/30"
                disabled={loading}
              />
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-[#7B2FF7] hover:bg-[#B58CFF] hover:text-[#12061F] text-white h-12 text-base font-semibold transition-all border-0"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <span className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5" />
                  Reset Password
                </span>
              )}
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
