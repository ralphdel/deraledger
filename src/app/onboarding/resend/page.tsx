"use client";

import Link from "next/link";
import { Mail, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

// This page is shown when a magic link expires before the merchant clicks it.
// The merchant can restart from the landing page or contact support.
export default function OnboardingResendPage() {
  return (
    <div className="w-full text-center">
      <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-5">
        <Mail className="w-7 h-7 text-amber-600" />
      </div>
      <h1 className="text-2xl font-bold text-purp-900 mb-2">Activation Link Expired</h1>
      <p className="text-neutral-500 text-sm mb-6 max-w-sm mx-auto">
        The link in your welcome email has expired (links are valid for 1 hour). 
        Please contact support at{" "}
        <a href="mailto:support@deraledger.com" className="text-purp-700 font-medium hover:underline">
          support@deraledger.com
        </a>{" "}
        with your registered email to get a new activation link.
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Link href="/">
          <Button variant="outline" className="border-2 border-purp-200 text-purp-900 hover:bg-purp-100">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </Link>
        <Link href="/login">
          <Button className="bg-purp-900 hover:bg-purp-700 text-white">
            Log In Instead
          </Button>
        </Link>
      </div>
    </div>
  );
}
