"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, MailCheck } from "lucide-react";
import { forgotPasswordAction } from "../actions";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await forgotPasswordAction(email);
      if (result.success) {
        setSuccess(true);
      } else {
        setError(result.error || "Failed to send reset email");
      }
    } catch (err: any) {
      setError("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="w-full text-center space-y-6">
        <div className="w-16 h-16 bg-[#7B2FF7]/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <MailCheck className="w-8 h-8 text-[#B58CFF]" />
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Check your email</h1>
        <p className="text-white/60">
          We sent a password reset link to <strong className="text-white">{email}</strong>.
          The link will expire in 1 hour.
        </p>
        <Link href="/login" className="block pt-4 text-[#B58CFF] font-medium hover:text-white transition-colors">
          Return to login
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white tracking-tight">Reset Password</h1>
        <p className="text-white/60 mt-2">
          Enter your email address and we&apos;ll send you a link to create a new password.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="bg-red-500/10 text-red-400 p-3 rounded-lg text-sm font-medium border border-red-500/30 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email" className="text-white/80">Email Address</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="h-12 border-white/10 bg-[#12061F] text-white focus:border-[#7B2FF7] placeholder:text-white/30"
            disabled={loading}
          />
        </div>

        <Button
          type="submit"
          disabled={loading || !email}
          className="w-full bg-[#7B2FF7] hover:bg-[#B58CFF] hover:text-[#12061F] text-white h-12 text-base font-semibold transition-all border-0"
        >
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "Send Reset Link"}
        </Button>
      </form>

      <div className="mt-8 text-center text-sm">
        <Link href="/login" className="text-white/60 hover:text-white font-medium inline-flex items-center gap-2 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to login
        </Link>
      </div>
    </div>
  );
}
