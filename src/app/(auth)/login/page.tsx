"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loginUser } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, ArrowRight, Eye, EyeOff, Building2, Users } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [loginMode, setLoginMode] = useState<"owner" | "team">("owner");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    
    // Clear workspace_code if logging in as owner to ensure owner account loads
    if (loginMode === "owner") {
      formData.delete("workspace_code");
    }

    startTransition(async () => {
      try {
        const result = await loginUser(formData);
        if (result.success) {
          if (result.mustChangePassword) {
            const workspace = result.workspace || formData.get("workspace_code") || "";
            router.push(`/set-password?workspace=${workspace}`);
          } else {
            router.push("/dashboard");
          }
        } else {
          setError(result.error || "Failed to log in.");
        }
      } catch (err: any) {
        console.error("Login exception:", err);
        setError(err.message || "An unexpected error occurred. Please try again.");
      }
    });
  };

  return (
    <div>
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <div className="w-8 h-8 bg-[#7B2FF7] rounded-lg flex items-center justify-center shadow-[0_0_10px_rgba(123,47,247,0.4)]">
          <span className="text-white font-bold text-sm">D</span>
        </div>
        <span className="text-xl font-bold text-white tracking-tight">DeraLedger</span>
      </div>

      <h1 className="text-2xl font-bold text-white">Welcome back</h1>
      <p className="mt-2 text-white/60">Sign in to your DeraLedger account</p>

      {/* Login Mode Toggle */}
      <div className="flex p-1 mt-6 bg-white/5 rounded-lg border border-white/10 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => setLoginMode("owner")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-md transition-all ${
            loginMode === "owner" ? "bg-[#3D0B66]/50 text-white shadow-sm border border-[#7B2FF7]/30" : "text-white/50 hover:text-white hover:bg-white/5"
          }`}
        >
          <Building2 className="w-4 h-4" />
          Business Owner
        </button>
        <button
          type="button"
          onClick={() => setLoginMode("team")}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-md transition-all ${
            loginMode === "team" ? "bg-[#3D0B66]/50 text-white shadow-sm border border-[#7B2FF7]/30" : "text-white/50 hover:text-white hover:bg-white/5"
          }`}
        >
          <Users className="w-4 h-4" />
          Team Member
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium text-white/80">
            Email Address
          </Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <Input
              name="email"
              id="email"
              type="email"
              placeholder="ade@business.ng"
              className="pl-10 h-11 border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] placeholder:text-white/30"
              required
            />
          </div>
        </div>

        {loginMode === "team" && (
          <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center justify-between">
              <Label htmlFor="workspace_code" className="text-sm font-medium text-white/80">
                Business ID <span className="text-red-400">*</span>
              </Label>
            </div>
            <Input
              name="workspace_code"
              id="workspace_code"
              type="text"
              placeholder="e.g. PL01234567890"
              required={loginMode === "team"}
              className="h-11 border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] uppercase placeholder:text-white/30"
            />
            <p className="text-xs text-white/50">
              Check your invite email for the Business ID.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-sm font-medium text-white/80">
              Password
            </Label>
            <Link href="/forgot-password" className="text-xs text-[#B58CFF] hover:text-white transition-colors font-medium">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
            <Input
              name="password"
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              className="pl-10 pr-10 h-11 border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] placeholder:text-white/30"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white transition-colors"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 text-red-400 text-sm p-3 rounded-md border border-red-500/30 font-medium text-center animate-in fade-in">
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={isPending}
          className="w-full h-11 bg-[#7B2FF7] hover:bg-[#B58CFF] hover:text-[#12061F] transition-all text-white font-semibold border-0"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Signing in...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              Sign In
              <ArrowRight className="h-4 w-4" />
            </span>
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-white/50">
        Don&apos;t have an account?{" "}
        <Link href="/onboarding" className="text-[#B58CFF] hover:text-white transition-colors font-semibold">
          Choose a plan to get started
        </Link>
      </p>
    </div>
  );
}
