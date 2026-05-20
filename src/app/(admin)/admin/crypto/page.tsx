"use client";

import { useState } from "react";
import Link from "next/link";
import { 
  Coins, Bitcoin, ShieldAlert, ShieldCheck, Search, Filter, 
  ArrowRight, AlertOctagon, RefreshCw, Terminal, CheckCircle2, Play
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MOCK_CRYPTO_TXS = [
  {
    id: "tx-1",
    hash: "0x8fae3256fb7d102e3b6a9a0e817cfa29a1b802611e9a26374a8109d9e6e8e811",
    coin: "USDT",
    network: "Ethereum Mainnet (ERC20)",
    confirmations: 45,
    required: 12,
    crypto_amount: 586.20,
    fiat_value: 850000,
    destination: "0x981bfda302810ab28dca99b0c2830f829c9910d2",
    breet_ref: "BRT-USDT-99180",
    status: "CONFIRMED",
    settlement: "OFFRAMPED"
  },
  {
    id: "tx-2",
    hash: "0x7bbd8826ab5c091f0927815dca89901e82810a9918e9a28b7a23c0a1f0a823a0",
    coin: "USDC",
    network: "Ethereum Mainnet (ERC20)",
    confirmations: 2,
    required: 12,
    crypto_amount: 300.00,
    fiat_value: 435000,
    destination: "0x981bfda302810ab28dca99b0c2830f829c9910d2",
    breet_ref: "BRT-USDC-99201",
    status: "PENDING",
    settlement: "PENDING_CONFIRMATION"
  },
  {
    id: "tx-3",
    hash: "0x12aee891a90c01fa90281fb7cfa901e829a1b80aef8a09bcda3b0a28f89bcada",
    coin: "USDT",
    network: "Binance Smart Chain (BEP20)",
    confirmations: 120,
    required: 15,
    crypto_amount: 150.00,
    fiat_value: 217500,
    destination: "0x981bfda302810ab28dca99b0c2830f829c9910d2",
    breet_ref: "BRT-USDT-99341",
    status: "CHAIN_MISMATCH", // USDT sent on BEP20 instead of ERC20!
    settlement: "HELD_IN_TREASURY"
  }
];

export default function AdminCryptoOpsCenter() {
  const [searchHash, setSearchHash] = useState("");
  const [network, setNetwork] = useState("ERC20");
  const [lookupResult, setLookupResult] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);

  const handleLookupTx = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchHash) return;

    setIsSearching(true);
    setLookupResult(null);

    setTimeout(() => {
      // Find matching mock transaction or return dummy search result
      const match = MOCK_CRYPTO_TXS.find(t => t.hash.toLowerCase() === searchHash.toLowerCase());
      if (match) {
        setLookupResult(match);
      } else {
        setLookupResult({
          hash: searchHash,
          coin: "USDT",
          network: network === "ERC20" ? "Ethereum Mainnet (ERC20)" : "Binance Smart Chain (BEP20)",
          confirmations: 8,
          required: 12,
          crypto_amount: 120.00,
          fiat_value: 174000,
          destination: "0x981bfda302810ab28dca99b0c2830f829c9910d2",
          breet_ref: "BRT-USDT-NEW",
          status: "PENDING",
          settlement: "WAITING_CONFIRMATIONS"
        });
      }
      setIsSearching(false);
    }, 1200);
  };

  const formatNaira = (amt: number) => {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amt);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-neutral-900 tracking-tight">Crypto Operations Center</h1>
        <p className="text-neutral-500 text-sm mt-1">
          Perform blockchain queries, monitor Breet API offramp parameters, and audit multi-chain stablecoin deposits.
        </p>
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
                      lookupResult.status === "CHAIN_MISMATCH" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                    }`}>
                      {lookupResult.status}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between"><span className="text-neutral-400">Coin/Network:</span><span className="font-semibold">{lookupResult.coin} ({lookupResult.network})</span></div>
                    <div className="flex justify-between"><span className="text-neutral-400">Confirmations:</span><span className="font-semibold">{lookupResult.confirmations} / {lookupResult.required}</span></div>
                    <div className="flex justify-between"><span className="text-neutral-400">Amount:</span><span className="font-semibold text-[#6F2CFF]">{lookupResult.crypto_amount} {lookupResult.coin}</span></div>
                    <div className="flex justify-between"><span className="text-neutral-400">Fiat Value:</span><span className="font-semibold">{formatNaira(lookupResult.fiat_value)}</span></div>
                    <div className="flex justify-between"><span className="text-neutral-400">Breet Reference:</span><span className="font-mono">{lookupResult.breet_ref}</span></div>
                  </div>
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
                    {MOCK_CRYPTO_TXS.map((tx) => {
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
                    })}
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
