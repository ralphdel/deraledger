"use client";

import { useState } from "react";
import { formatNaira } from "@/lib/calculations";
import { recordManualPaymentAction } from "@/lib/actions";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

interface RecordPaymentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  merchantId: string;
  outstandingBalance: number;
}

export function RecordPaymentDrawer({ open, onOpenChange, invoiceId, merchantId, outstandingBalance }: RecordPaymentDrawerProps) {
  const [amount, setAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [dateReceived, setDateReceived] = useState<string>(new Date().toISOString().split("T")[0]);
  const [referenceNote, setReferenceNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      setError("Please enter a valid amount.");
      return;
    }
    if (numAmount > outstandingBalance) {
      setError(`Amount cannot exceed the outstanding balance of ${formatNaira(outstandingBalance)}.`);
      return;
    }

    setLoading(true);
    const result = await recordManualPaymentAction({
      invoice_id: invoiceId,
      merchant_id: merchantId,
      amount: numAmount,
      payment_method: paymentMethod,
      date_received: dateReceived,
      reference_note: referenceNote || undefined,
    });
    setLoading(false);

    if (result.success) {
      setSuccess(true);
      setTimeout(() => {
        onOpenChange(false);
        setSuccess(false);
        setAmount("");
        setReferenceNote("");
      }, 1500);
    } else {
      setError(result.error || "Failed to record payment.");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto border-l-2 border-purp-200">
        <SheetHeader>
          <SheetTitle className="text-purp-900 text-xl font-bold">Record Offline Payment</SheetTitle>
          <SheetDescription>
            Log a payment received outside of the Deraledger system. This will update the invoice's outstanding balance.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-6">
          <div className="bg-purp-50 border-2 border-purp-200 rounded-lg p-4">
            <p className="text-sm text-neutral-500 font-medium">Outstanding Balance</p>
            <p className="text-2xl font-bold text-purp-900 mt-1">{formatNaira(outstandingBalance)}</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="font-medium text-sm">Amount Received (₦)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={outstandingBalance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 50000"
                className="border-2 border-purp-200 h-11 bg-white"
                required
              />
            </div>

            <div className="space-y-2">
              <Label className="font-medium text-sm">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v ?? "")}>
                <SelectTrigger className="border-2 border-purp-200 h-11 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-2 border-purp-200">
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="pos">POS Terminal</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="font-medium text-sm">Date Received</Label>
              <Input
                type="date"
                value={dateReceived}
                onChange={(e) => setDateReceived(e.target.value)}
                className="border-2 border-purp-200 h-11 bg-white"
                required
              />
            </div>

            <div className="space-y-2">
              <Label className="font-medium text-sm">Reference Note</Label>
              <Textarea
                value={referenceNote}
                onChange={(e) => setReferenceNote(e.target.value)}
                placeholder="e.g. Transfer receipt #1234..."
                className="border-2 border-purp-200 bg-white min-h-[100px]"
              />
            </div>
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 border border-red-200 rounded-lg p-3 text-sm flex gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {success && (
            <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg p-3 text-sm flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Payment recorded successfully.
            </div>
          )}

          <SheetFooter className="pt-4 border-t border-neutral-100">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="border-2 border-neutral-200 w-full sm:w-auto"
              disabled={loading || success}
            >
              Cancel
            </Button>
            <Button type="submit" className="bg-purp-900 hover:bg-purp-800 text-white font-semibold w-full sm:w-auto" disabled={loading || success}>
              {loading ? "Saving..." : "Record Payment"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
