"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Lock, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (response.ok) {
      router.push("/admin");
    } else {
      setError("Invalid password. Access denied.");
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 w-full bg-neutral-900 flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-2 border-red-900 bg-neutral-950 text-white shadow-2xl">
        <CardHeader className="pt-8 text-center space-y-4">
          <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-2 border border-red-500/50">
            <ShieldCheck className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">SuperAdmin Portal</h1>
          
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-left flex items-start gap-3 mt-4">
            <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-red-200">
              <p className="font-bold text-red-500 mb-0.5">RESTRICTED ZONE</p>
              <p>This is a highly restricted area. Unauthorized access is strictly prohibited and logged.</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pb-8">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-neutral-500" />
                <Input
                  type="password"
                  placeholder="Enter access code"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 bg-neutral-900 border-neutral-800 text-white placeholder:text-neutral-600 focus-visible:ring-red-500"
                  required
                />
              </div>
            </div>

            {error && (
              <p className="text-sm font-medium text-red-500 text-center">{error}</p>
            )}

            <Button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-red-600 hover:bg-red-700 text-white font-bold"
            >
              {loading ? "Authenticating..." : "Authenticate"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
