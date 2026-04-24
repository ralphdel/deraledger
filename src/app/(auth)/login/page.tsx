"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { loginUser } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, Lock, ArrowRight, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    
    startTransition(async () => {
      const result = await loginUser(formData);
      if (result.success) {
        if (result.mustChangePassword) {
          router.push("/set-password");
        } else {
          router.push("/dashboard");
        }
      } else {
        setError(result.error || "Failed to log in.");
      }
    });
  };

  return (
    <div>
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <div className="w-8 h-8 bg-purp-900 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-sm">P</span>
        </div>
        <span className="text-xl font-bold text-purp-900">PurpLedger</span>
      </div>

      <h1 className="text-2xl font-bold text-purp-900">Welcome back</h1>
      <p className="mt-2 text-neutral-500">Sign in to your merchant account</p>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium text-neutral-900">
            Email Address
          </Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
            <Input
              name="email"
              id="email"
              type="email"
              placeholder="ade@business.ng"
              className="pl-10 h-11 border-2 border-purp-200 bg-purp-50 focus:border-purp-700 focus:ring-purp-700"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="workspace_code" className="text-sm font-medium text-neutral-900">
              Business ID <span className="text-neutral-500 font-normal">(Team Members Only)</span>
            </Label>
          </div>
          <Input
            name="workspace_code"
            id="workspace_code"
            type="text"
            placeholder="e.g. PL01234567890"
            className="h-11 border-2 border-purp-200 bg-purp-50 focus:border-purp-700 focus:ring-purp-700 uppercase"
          />
          <p className="text-xs text-neutral-500">
            Leave blank if you are the business owner. Team members check your invite email.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="text-sm font-medium text-neutral-900">
              Password
            </Label>
            <Link href="/forgot-password" className="text-xs text-purp-700 hover:underline font-medium">
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
            <Input
              name="password"
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              className="pl-10 pr-10 h-11 border-2 border-purp-200 bg-purp-50 focus:border-purp-700 focus:ring-purp-700"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-purp-700"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 text-sm p-3 rounded-md border border-red-200 font-medium text-center">
            {error}
          </div>
        )}

        <Button
          type="submit"
          disabled={isPending}
          className="w-full h-11 bg-purp-900 hover:bg-purp-700 text-white font-semibold"
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

      <p className="mt-6 text-center text-sm text-neutral-500">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="text-purp-700 hover:underline font-semibold">
          Create one free
        </Link>
      </p>
    </div>
  );
}
