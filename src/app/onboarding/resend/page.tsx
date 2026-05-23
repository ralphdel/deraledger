"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Mail, ArrowLeft, CheckCircle2, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resendActivationLinkAction } from "@/app/(auth)/actions";

/**
 * /onboarding/resend
 *
 * Shown when a merchant's onboarding magic link has expired (1-hour window).
 * Allows them to enter their registered email and receive a fresh activation link.
 */
export default function OnboardingResendPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);

    startTransition(async () => {
      const result = await resendActivationLinkAction(email.trim());
      if (result?.success === false && result.error) {
        setError(result.error);
      } else {
        setSubmitted(true);
      }
    });
  };

  if (submitted) {
    return (
      <div className="w-full text-center">
        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-5">
          <CheckCircle2 className="w-8 h-8 text-emerald-600" />
        </div>
        <h1 className="text-2xl font-bold text-purp-900 mb-2">Check Your Inbox</h1>
        <p className="text-neutral-500 text-sm mb-6 max-w-sm mx-auto">
          If{" "}
          <span className="font-semibold text-neutral-700">{email}</span>{" "}
          is registered with Deraledger, a fresh activation link has been sent.
          The link is valid for <strong>1 hour</strong> — please check your spam folder too.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/">
            <Button variant="outline" className="border-2 border-purp-200 text-purp-900 hover:bg-purp-50">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Button>
          </Link>
          <Button
            variant="ghost"
            className="text-purp-700 hover:text-purp-900 hover:bg-purp-50"
            onClick={() => { setSubmitted(false); setEmail(""); }}
          >
            Use a different email
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Icon */}
      <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
        <Mail className="w-7 h-7 text-amber-600" />
      </div>

      {/* Header */}
      <div className="text-center mb-7">
        <h1 className="text-2xl font-bold text-purp-900 mb-2">Activation Link Expired</h1>
        <p className="text-neutral-500 text-sm max-w-sm mx-auto">
          The link in your welcome email has expired — links are valid for <strong>1 hour</strong>.
          Enter your registered email below and we&apos;ll send you a fresh one immediately.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="resend-email"
            className="block text-sm font-medium text-neutral-700 mb-1.5"
          >
            Registered Email Address
          </label>
          <Input
            id="resend-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="border-2 border-neutral-200 focus:border-purp-500 h-11"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        )}

        <Button
          type="submit"
          className="w-full bg-purp-900 hover:bg-purp-800 text-white h-11 font-semibold"
          disabled={isPending || !email.trim()}
        >
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Sending…
            </>
          ) : (
            <>
              <RefreshCw className="w-4 h-4 mr-2" />
              Resend Activation Link
            </>
          )}
        </Button>
      </form>

      {/* Footer links */}
      <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
        <Link href="/">
          <Button
            variant="ghost"
            size="sm"
            className="text-neutral-500 hover:text-purp-900"
          >
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
            Back to Home
          </Button>
        </Link>
        <span className="hidden sm:block text-neutral-300 self-center">·</span>
        <Link href="/login">
          <Button
            variant="ghost"
            size="sm"
            className="text-neutral-500 hover:text-purp-900"
          >
            Log In Instead
          </Button>
        </Link>
        <span className="hidden sm:block text-neutral-300 self-center">·</span>
        <a
          href="mailto:support@deraledger.com"
          className="inline-flex items-center justify-center text-sm text-neutral-500 hover:text-purp-900 transition-colors px-3 py-1.5 rounded-md hover:bg-purp-50"
        >
          Contact Support
        </a>
      </div>
    </div>
  );
}
