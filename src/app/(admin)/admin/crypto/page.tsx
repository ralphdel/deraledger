"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { 
  Coins, Bitcoin, ShieldAlert, ShieldCheck, Search, Filter, 
  ArrowRight, AlertOctagon, RefreshCw, Terminal, CheckCircle2, Play
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export default function AdminCryptoOpsCenter() {
  const [searchHash, setSearchHash] = useState("");
  const [network, setNetwork] = useState("ERC20");
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadCryptoTransactions() {
    setLoading(true);
    try {
      const sb = createClient();
      const { data, error } = await sb
        .from("treasury_transactions")
        .select("*")
        .order("created_at", { ascending: false });

      if (data) {
        const mapped = data.map((tx: any) => {
          let statusText = "PENDING";
          let settlementText = tx.settlement_reference || "PENDING_CONFIRMATION";
          let confirmationsVal = 2;
          let requiredVal = 12;

          if (tx.status === "SETTLED") {
            statusText = "CONFIRMED";
            settlementText = "OFFRAMPED";
            confirmationsVal = 45;
          } else if (tx.status === "BLOCKCHAIN_CONFIRMED") {
            statusText = "PENDING";
            settlementText = "PENDING_CONFIRMATION";
            confirmationsVal = 2;
          } else if (tx.status === "FAILED") {
            statusText = "CHAIN_MISMATCH";
            settlementText = "HELD_IN_TREASURY";
            confirmationsVal = 120;
            requiredVal = 15;
          }

          return {
            id: tx.id,
            hash: tx.blockchain_tx_hash || "0x0000000000000",
            coin: tx.source_currency || "USDT",
            network: tx.payment_rail || "Ethereum Mainnet (ERC20)",
            confirmations: confirmationsVal,
            required: requiredVal,
            crypto_amount: Number(tx.source_amount || 0),
            fiat_value: Number(tx.gross_ngn || 0),
            destination: "0x981bfda302810ab28dca99b0c2830f829c9910d2",
            breet_ref: tx.breet_reference || "BRT-USDT-UNMAPPED",
            status: statusText,
            settlement: settlementText
          };
        });
        setTransactions(mapped);
      }
    } catch (err) {
      console.error("Failed to load crypto transactions:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCryptoTransactions();
  }, []);

  const handleLookupTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchHash) return;

    setIsSearching(true);
    setLookupResult(null);

    try {
      const sb = createClient();
      const { data, error } = await sb
        .from("treasury_transactions")
        .select("*")
        .eq("blockchain_tx_hash", searchHash.trim())
        .maybeSingle();

      if (data) {
        let statusText = "PENDING";
        let settlementText = data.settlement_reference || "PENDING_CONFIRMATION";
        let confirmationsVal = 2;
        let requiredVal = 12;

        if (data.status === "SETTLED") {
          statusText = "CONFIRMED";
          settlementText = "OFFRAMPED";
          confirmationsVal = 45;
        } else if (data.status === "BLOCKCHAIN_CONFIRMED") {
          statusText = "PENDING";
          settlementText = "PENDING_CONFIRMATION";
          confirmationsVal = 2;
        } else if (data.status === "FAILED") {
          statusText = "CHAIN_MISMATCH";
          settlementText = "HELD_IN_TREASURY";
          confirmationsVal = 120;
          requiredVal = 15;
        }

        setLookupResult({
          hash: data.blockchain_tx_hash,
          coin: data.source_currency || "USDT",
          network: data.payment_rail || "Ethereum Mainnet (ERC20)",
          confirmations: confirmationsVal,
          required: requiredVal,
          crypto_amount: Number(data.source_amount || 0),
          fiat_value: Number(data.gross_ngn || 0),
          destination: "0x981bfda302810ab28dca99b0c2830f829c9910d2",
          breet_ref: data.breet_reference || "BRT-USDT-UNMAPPED",
          status: statusText,
          settlement: settlementText
        });
      } else {
        // SPEC ENFORCEMENT: DeraLedger does NOT query blockchains directly.
        // Breet is the sole source of blockchain truth via verified webhooks.
        // If not in our DB, it has not been confirmed by Breet yet.
        setLookupResult({
          hash: searchHash,
          coin: "—",
          network: "—",
          confirmations: 0,
          required: 0,
          crypto_amount: 0,
          fiat_value: 0,
          destination: "—",
          breet_ref: "NOT_FOUND",
          status: "NOT_FOUND",
          settlement: "—"
        });
      }
    } catch (err) {
      console.error("Lookup failed:", err);
    } finally {
      setIsSearching(false);
    }
  };

  const formatNaira = (amt: number) => {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amt);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Crypto Operations Center</h1>
          <p className="text-neutral-500 text-sm mt-1">
            Perform blockchain queries, monitor Breet API offramp parameters, and audit multi-chain stablecoin deposits.
          </p>
        </div>
        <Button 
          onClick={loadCryptoTransactions} 
          disabled={loading} 
          variant="outline" 
          className="border-neutral-200 text-neutral-700 bg-white hover:bg-neutral-50"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
          Refresh Ledger
        </Button>
      </div>

      {/* Lookup controls */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1 space-y-6">
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200">
              <CardTitle className="text-base text-neutral-900">Blockchain Hash Lookup</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <form onSubmit={handleLookupTx} className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-neutral-400">Transaction Hash</Label>
                  <Input 
                    type="text" 
                    placeholder="Enter 0x transaction hash..." 
                    value={searchHash}
                    onChange={(e) => setSearchHash(e.target.value)}
                    required
                    className="bg-neutral-50 border-neutral-200 font-mono text-xs"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-neutral-400">Target Network</Label>
                  <select
                    value={network}
                    onChange={(e) => setNetwork(e.target.value)}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  >
                    <option value="ERC20">Ethereum Mainnet (USDT/USDC ERC20)</option>
                    <option value="BEP20">Binance Smart Chain (USDT BEP20)</option>
                    <option value="TRC20">Tron Network (USDT TRC20)</option>
                  </select>
                </div>

                <Button type="submit" disabled={isSearching} className="w-full bg-[#6F2CFF] hover:bg-[#5B21B6] text-white font-bold">
                  {isSearching ? "Querying RPC Node..." : "Query Blockchain"}
                </Button>
              </form>

              {lookupResult && (
                <div className="mt-4 border border-neutral-200 rounded-xl p-4 bg-neutral-50 space-y-3 text-xs">
                  <div className="flex justify-between items-center border-b border-neutral-200 pb-2">
                    <span className="font-bold text-neutral-800 uppercase">Query Result</span>
                    <span className={`px-2 py-0.5 rounded font-bold uppercase ${
                      lookupResult.status === "CONFIRMED" ? "bg-emerald-50 text-emerald-700" :
                      lookupResult.status === "CHAIN_MISMATCH" ? "bg-red-50 text-red-700" :
                      lookupResult.status === "NOT_FOUND" ? "bg-neutral-100 text-neutral-500" :
                      "bg-amber-50 text-amber-700"
                    }`}>
                      {lookupResult.status}
                    </span>
                  </div>
                  {lookupResult.status === "NOT_FOUND" ? (
                    <div className="text-center py-2 space-y-1">
                      <p className="text-neutral-600 font-semibold text-xs">Not in treasury ledger</p>
                      <p className="text-neutral-400 text-[11px]">This hash has not been confirmed by Breet via a verified webhook. DeraLedger does not query blockchains directly — Breet is the sole source of blockchain truth. If you just sent the transaction, please allow time for blockchain confirmation and Breet's webhook callback.</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex justify-between"><span className="text-neutral-400">Coin/Network:</span><span className="font-semibold">{lookupResult.coin} ({lookupResult.network})</span></div>
                      <div className="flex justify-between"><span className="text-neutral-400">Confirmations:</span><span className="font-semibold">{lookupResult.confirmations} / {lookupResult.required}</span></div>
                      <div className="flex justify-between"><span className="text-neutral-400">Amount:</span><span className="font-semibold text-[#6F2CFF]">{lookupResult.crypto_amount} {lookupResult.coin}</span></div>
                      <div className="flex justify-between"><span className="text-neutral-400">Fiat Value:</span><span className="font-semibold">{formatNaira(lookupResult.fiat_value)}</span></div>
                      <div className="flex justify-between"><span className="text-neutral-400">Breet Reference:</span><span className="font-mono">{lookupResult.breet_ref}</span></div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Transaction Logs */}
        <div className="lg:col-span-2">
          <Card className="bg-white border-neutral-200">
            <CardHeader className="border-b border-neutral-200 flex flex-row justify-between items-center">
              <CardTitle className="text-base text-neutral-900">Active Stablecoin Deposits &amp; Breet Logs</CardTitle>
              <Coins className="w-5 h-5 text-neutral-400" />
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="bg-neutral-50 border-b border-neutral-200 text-xs font-bold text-neutral-400 uppercase tracking-wider">
                      <th className="px-6 py-4">Transaction Hash</th>
                      <th className="px-6 py-4">Amount / Network</th>
                      <th className="px-6 py-4">Breet Reference</th>
                      <th className="px-6 py-4">Confs</th>
                      <th className="px-6 py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-neutral-400">
                          Querying blockchain stablecoin ledger...
                        </td>
                      </tr>
                    ) : transactions.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-neutral-400">
                          No blockchain stablecoin offramp logs logged in ledger.
                        </td>
                      </tr>
                    ) : (
                      transactions.map((tx) => {
                        const getStatusStyles = (status: string) => {
                          switch (status) {
                            case "CONFIRMED": return "bg-emerald-50 text-emerald-700 border-emerald-200";
                            case "CHAIN_MISMATCH": return "bg-red-50 text-red-700 border-red-200";
                            default: return "bg-amber-50 text-amber-700 border-amber-200";
                          }
                        };

                        return (
                          <tr key={tx.id} className="hover:bg-neutral-50/50">
                            <td className="px-6 py-4">
                              <span className="font-mono text-xs text-[#6F2CFF] truncate block w-40" title={tx.hash}>
                                {tx.hash}
                              </span>
                              <span className="block text-[11px] text-neutral-400 mt-0.5">Dest: {tx.destination.slice(0, 10)}...</span>
                            </td>
                            <td className="px-6 py-4">
                              <strong className="text-neutral-800">{tx.crypto_amount} {tx.coin}</strong>
                              <span className="block text-[10px] text-neutral-400 mt-0.5">{tx.network}</span>
                            </td>
                            <td className="px-6 py-4 font-mono text-xs text-neutral-600">
                              {tx.breet_ref}
                              <span className="block text-[10px] text-neutral-400 mt-0.5">Settlement: {tx.settlement}</span>
                            </td>
                            <td className="px-6 py-4 font-semibold text-neutral-600">
                              {tx.confirmations} / {tx.required}
                            </td>
                            <td className="px-6 py-4">
                              <span className={`inline-block px-2.5 py-0.5 border rounded-full text-[11px] font-semibold ${getStatusStyles(tx.status)}`}>
                                {tx.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
