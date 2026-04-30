"use client";

import { use, useEffect, useState } from "react";
import { getInvoiceById, getMerchant } from "@/lib/data";
import type { InvoiceWithLineItems, Merchant } from "@/lib/types";
import { formatNaira } from "@/lib/calculations";

export default function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [invoice, setInvoice] = useState<InvoiceWithLineItems | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getInvoiceById(id), getMerchant()]).then(([inv, merch]) => {
      setInvoice(inv);
      setMerchant(merch);
      setLoading(false);
    });
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="w-8 h-8 border-2 border-purple-700 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <p className="text-gray-500">Invoice not found.</p>
      </div>
    );
  }

  const businessName = merchant?.trading_name || merchant?.business_name || "PurpLedger Merchant";
  const ownerName = merchant?.owner_name || "";
  const clientName = invoice.clients?.full_name || "Client";
  const clientEmail = invoice.clients?.email || "";
  const clientPhone = invoice.clients?.phone || "";
  const clientCompany = invoice.clients?.company_name || "";
  const issuedDate = new Date(invoice.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
  const dueDate = invoice.pay_by_date
    ? new Date(invoice.pay_by_date).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const initials = businessName
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0])
    .join("")
    .toUpperCase();

  const statusLabel: Record<string, string> = {
    open: "Unpaid",
    partially_paid: "Partially Paid",
    closed: "Paid",
    manually_closed: "Closed",
    expired: "Overdue",
    void: "Void",
  };

  const statusColor: Record<string, string> = {
    open: "#d97706",
    partially_paid: "#7c3aed",
    closed: "#059669",
    manually_closed: "#6b7280",
    expired: "#dc2626",
    void: "#6b7280",
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background: #f8f8f8; }
        .invoice-wrapper { max-width: 860px; margin: 32px auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 32px rgba(0,0,0,0.10); }
        @media print {
          body { background: white; }
          .invoice-wrapper { margin: 0; border-radius: 0; box-shadow: none; }
          .no-print { display: none !important; }
          @page { margin: 0.5in; }
        }
      `}</style>

      {/* Action bar — hidden on print */}
      <div className="no-print" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, background: "#2D1B6B", padding: "10px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: "white", fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 15 }}>PurpLedger — Invoice Preview</span>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={() => window.print()}
            style={{ background: "white", color: "#2D1B6B", border: "none", borderRadius: 8, padding: "8px 20px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "Inter, sans-serif" }}
          >
            ⬇ Save as PDF
          </button>
          <button
            onClick={() => window.close()}
            style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "1px solid rgba(255,255,255,0.3)", borderRadius: 8, padding: "8px 16px", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "Inter, sans-serif" }}
          >
            ✕ Close
          </button>
        </div>
      </div>

      <div style={{ paddingTop: 64 }} className="no-print" />

      {/* Invoice Document */}
      <div className="invoice-wrapper">
        {/* Header */}
        <div style={{ background: "#2D1B6B", padding: "36px 48px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {merchant?.logo_url ? (
              <img
                src={merchant.logo_url}
                alt={businessName}
                style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", border: "2px solid rgba(255,255,255,0.3)", background: "white" }}
              />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: 10, background: "rgba(255,255,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center", border: "2px solid rgba(255,255,255,0.3)" }}>
                <span style={{ color: "white", fontWeight: 800, fontSize: 22, fontFamily: "Inter, sans-serif" }}>{initials}</span>
              </div>
            )}
            <div>
              <div style={{ color: "white", fontWeight: 800, fontSize: 22, fontFamily: "Inter, sans-serif" }}>{businessName}</div>
              {ownerName && <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 2, fontFamily: "Inter, sans-serif" }}>{ownerName}</div>}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "Inter, sans-serif" }}>Invoice</div>
            <div style={{ color: "white", fontWeight: 800, fontSize: 24, marginTop: 4, fontFamily: "Inter, sans-serif" }}>{invoice.invoice_number}</div>
            <div style={{ marginTop: 8, display: "inline-block", background: statusColor[invoice.status] || "#6b7280", color: "white", padding: "3px 12px", borderRadius: 100, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", fontFamily: "Inter, sans-serif" }}>
              {statusLabel[invoice.status] || invoice.status}
            </div>
          </div>
        </div>

        {/* Meta row */}
        <div style={{ background: "#f5f3ff", padding: "16px 48px", display: "flex", gap: 48, borderBottom: "1px solid #e9e0ff" }}>
          <div>
            <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "Inter, sans-serif" }}>Issue Date</div>
            <div style={{ color: "#1a1a2e", fontWeight: 600, fontSize: 13, marginTop: 2, fontFamily: "Inter, sans-serif" }}>{issuedDate}</div>
          </div>
          {dueDate && (
            <div>
              <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "Inter, sans-serif" }}>Due Date</div>
              <div style={{ color: "#1a1a2e", fontWeight: 600, fontSize: 13, marginTop: 2, fontFamily: "Inter, sans-serif" }}>{dueDate}</div>
            </div>
          )}
          <div>
            <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "Inter, sans-serif" }}>Invoice Type</div>
            <div style={{ color: "#1a1a2e", fontWeight: 600, fontSize: 13, marginTop: 2, textTransform: "capitalize", fontFamily: "Inter, sans-serif" }}>{invoice.invoice_type === "record" ? "Record / Offline" : "Collection"}</div>
          </div>
        </div>

        {/* Bill To */}
        <div style={{ padding: "32px 48px 0", display: "flex", justifyContent: "space-between" }}>
          <div>
            <div style={{ color: "#6b7280", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontFamily: "Inter, sans-serif" }}>Bill To</div>
            <div style={{ color: "#1a1a2e", fontWeight: 700, fontSize: 16, fontFamily: "Inter, sans-serif" }}>{clientName}</div>
            {clientCompany && <div style={{ color: "#4b5563", fontSize: 13, marginTop: 2, fontFamily: "Inter, sans-serif" }}>{clientCompany}</div>}
            {clientEmail && <div style={{ color: "#4b5563", fontSize: 13, marginTop: 2, fontFamily: "Inter, sans-serif" }}>{clientEmail}</div>}
            {clientPhone && <div style={{ color: "#4b5563", fontSize: 13, marginTop: 2, fontFamily: "Inter, sans-serif" }}>{clientPhone}</div>}
          </div>
        </div>

        {/* Line Items Table */}
        <div style={{ padding: "24px 48px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "Inter, sans-serif" }}>
            <thead>
              <tr style={{ background: "#f5f3ff" }}>
                <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "2px solid #ddd6fe" }}>#</th>
                <th style={{ textAlign: "left", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "2px solid #ddd6fe" }}>Description</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "2px solid #ddd6fe" }}>Qty</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "2px solid #ddd6fe" }}>Unit Rate</th>
                <th style={{ textAlign: "right", padding: "10px 12px", fontSize: 11, fontWeight: 700, color: "#7c3aed", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "2px solid #ddd6fe" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(invoice.line_items || []).map((item, idx) => (
                <tr key={item.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "12px", fontSize: 13, color: "#9ca3af" }}>{idx + 1}</td>
                  <td style={{ padding: "12px", fontSize: 14, fontWeight: 500, color: "#111827" }}>{item.item_name}</td>
                  <td style={{ padding: "12px", fontSize: 13, textAlign: "right", color: "#374151" }}>{item.quantity}</td>
                  <td style={{ padding: "12px", fontSize: 13, textAlign: "right", color: "#374151" }}>{formatNaira(Number(item.unit_rate))}</td>
                  <td style={{ padding: "12px", fontSize: 14, textAlign: "right", fontWeight: 600, color: "#111827" }}>{formatNaira(Number(item.line_total))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <div style={{ width: 280 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#6b7280", fontFamily: "Inter, sans-serif" }}>
                <span>Subtotal</span>
                <span style={{ fontWeight: 500, color: "#374151" }}>{formatNaira(Number(invoice.subtotal))}</span>
              </div>
              {Number(invoice.discount_pct) > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#6b7280", fontFamily: "Inter, sans-serif" }}>
                  <span>Discount ({invoice.discount_pct}%)</span>
                  <span style={{ color: "#dc2626" }}>−{formatNaira(Number(invoice.discount_value))}</span>
                </div>
              )}
              {Number(invoice.tax_pct) > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: 13, color: "#6b7280", fontFamily: "Inter, sans-serif" }}>
                  <span>VAT ({invoice.tax_pct}%)</span>
                  <span>+{formatNaira(Number(invoice.tax_value))}</span>
                </div>
              )}
              <div style={{ height: 1, background: "#ddd6fe", margin: "8px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontFamily: "Inter, sans-serif" }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: "#2D1B6B" }}>Grand Total</span>
                <span style={{ fontWeight: 800, fontSize: 20, color: "#2D1B6B" }}>{formatNaira(Number(invoice.grand_total))}</span>
              </div>
              {Number(invoice.amount_paid) > 0 && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 13, color: "#6b7280", fontFamily: "Inter, sans-serif" }}>
                    <span>Amount Paid</span>
                    <span style={{ color: "#059669", fontWeight: 600 }}>−{formatNaira(Number(invoice.amount_paid))}</span>
                  </div>
                  <div style={{ height: 1, background: "#ddd6fe", margin: "8px 0" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontFamily: "Inter, sans-serif" }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: "#1a1a2e" }}>Balance Due</span>
                    <span style={{ fontWeight: 800, fontSize: 18, color: invoice.outstanding_balance > 0 ? "#dc2626" : "#059669" }}>
                      {formatNaira(Number(invoice.outstanding_balance))}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div style={{ padding: "0 48px 24px", fontFamily: "Inter, sans-serif" }}>
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "12px 16px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>Notes</div>
              <div style={{ fontSize: 13, color: "#374151" }}>{invoice.notes}</div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ background: "#f5f3ff", padding: "20px 48px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #e9e0ff" }}>
          <div style={{ fontSize: 12, color: "#7c3aed", fontWeight: 600, fontFamily: "Inter, sans-serif" }}>
            Generated by PurpLedger
          </div>
          <div style={{ fontSize: 12, color: "#9ca3af", fontFamily: "Inter, sans-serif" }}>
            {invoice.invoice_number} · {new Date().toLocaleDateString("en-NG")}
          </div>
        </div>
      </div>

      <div style={{ height: 40 }} className="no-print" />
    </>
  );
}
