"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";
import { ArrowLeft, Download, Upload, CheckCircle, AlertTriangle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { bulkCreateInvoicesAction } from "@/lib/actions";
import { getMerchant, getClients, getItemCatalog, getDiscountTemplates } from "@/lib/data";
import { calculateInvoiceTotals, formatNaira } from "@/lib/calculations";
import type { Client, ItemCatalog, DiscountTemplate } from "@/lib/types";

type RawInvoiceRow = {
  "Invoice Group"?: string;
  "Bulk Reference"?: string;
  Client?: string;
  "Client Email"?: string;
  "Invoice Type (collection/record)"?: string;
  "Discount Template Name"?: string;
  "Tax Percentage"?: string | number;
  "Item Name"?: string;
  Quantity?: string | number;
  "Unit Rate (blank uses Catalog)"?: string | number;
  "Allow Partial Payment (yes/no)"?: string;
  "Minimum Payment %"?: string | number;
  "Initial Payment Amount"?: string | number;
  "Payment Method (cash/bank_transfer/pos)"?: string;
  "Pay By Date (YYYY-MM-DD)"?: string | number;
  "Fee Absorption (business/customer)"?: string;
  Notes?: string;
};

type ParsedInvoice = {
  bulk_ref: string;
  client_id: string;
  client_email_raw: string;
  invoice_type: "collection" | "record";
  discount_pct: number;
  tax_pct: number;
  discount_value: number;
  tax_value: number;
  subtotal: number;
  grand_total: number;
  notes: string;
  pay_by_date: string;
  fee_absorption: "business" | "customer";
  allow_partial_payment: boolean;
  partial_payment_pct: number | null;
  initial_amount_paid?: number;
  payment_method?: string;
  lineItems: {
    item_name: string;
    quantity: number;
    unit_rate: number;
    line_total: number;
  }[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(text(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function excelDate(value: unknown) {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d)).toISOString();
    }
  }

  const raw = text(value);
  if (!raw) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : date.toISOString();
}

function normalizedInvoiceLevelValue(row: RawInvoiceRow, key: keyof RawInvoiceRow) {
  return text(row[key]).toLowerCase();
}

export default function BulkInvoicesPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedInvoice[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [success, setSuccess] = useState(false);
  const [templateType, setTemplateType] = useState<"collection" | "record">("collection");

  const [merchantId, setMerchantId] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [catalog, setCatalog] = useState<ItemCatalog[]>([]);
  const [discounts, setDiscounts] = useState<DiscountTemplate[]>([]);

  useEffect(() => {
    Promise.all([getMerchant(), getClients(), getItemCatalog(), getDiscountTemplates()]).then(
      ([m, c, cat, d]) => {
        if (m) setMerchantId(m.id);
        setClients(c);
        setCatalog(cat);
        setDiscounts(d);
      }
    );
  }, []);

  const downloadTemplate = async () => {
    const isRecord = templateType === "record";
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "DeraLedger";
    workbook.created = new Date();

    const invoicesSheet = workbook.addWorksheet("Invoices");
    const optionsSheet = workbook.addWorksheet("Dropdown Options");
    const clientsSheet = workbook.addWorksheet("Clients");
    const catalogSheet = workbook.addWorksheet("Item Catalog");
    const discountsSheet = workbook.addWorksheet("Discount Templates");
    const instructionsSheet = workbook.addWorksheet("Instructions");

    const clientOptions = clients.map((client) =>
      client.email ? `${client.full_name} <${client.email}>` : client.full_name
    );
    const itemOptions = catalog.map((item) => item.item_name);
    const discountOptions = discounts.map((discount) => discount.name);

    // Record templates omit collection-only columns but include initial payment fields.
    // Collection templates include all columns.
    const headers = isRecord
      ? [
          "Invoice Group",
          "Client",
          "Invoice Type (collection/record)",
          "Discount Template Name",
          "Tax Percentage",
          "Item Name",
          "Quantity",
          "Unit Rate (blank uses Catalog)",
          "Initial Payment Amount",
          "Payment Method (cash/bank_transfer/pos)",
          "Pay By Date (YYYY-MM-DD)",
          "Notes",
        ]
      : [
          "Invoice Group",
          "Client",
          "Invoice Type (collection/record)",
          "Discount Template Name",
          "Tax Percentage",
          "Item Name",
          "Quantity",
          "Unit Rate (blank uses Catalog)",
          "Allow Partial Payment (yes/no)",
          "Minimum Payment %",
          "Pay By Date (YYYY-MM-DD)",
          "Fee Absorption (business/customer)",
          "Notes",
        ];

    // Derive column letter by header name so validations are always correct.
    const colOf = (name: string) => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? String.fromCharCode(65 + idx) : null;
    };

    optionsSheet.state = "veryHidden";
    optionsSheet.getRow(1).values = ["Clients", "Items", "Discounts", "Invoice Types", "Fee Absorption", "Yes/No", "Payment Methods"];
    const paymentMethodOptions = ["cash", "bank_transfer", "pos"];
    const maxOptionRows = Math.max(clientOptions.length, itemOptions.length, discountOptions.length, paymentMethodOptions.length, 2);
    for (let index = 0; index < maxOptionRows; index += 1) {
      const row = optionsSheet.getRow(index + 2);
      row.getCell(1).value = clientOptions[index] || null;
      row.getCell(2).value = itemOptions[index] || null;
      row.getCell(3).value = discountOptions[index] || null;
      row.getCell(4).value = ["collection", "record"][index] || null;
      row.getCell(5).value = ["business", "customer"][index] || null;
      row.getCell(6).value = ["yes", "no"][index] || null;
      row.getCell(7).value = paymentMethodOptions[index] || null;
    }

    const firstCatalogItem = catalog[0]?.item_name || "Consultation";
    const secondCatalogItem = catalog[1]?.item_name || "Implementation";
    const firstDiscount = discounts[0]?.name || "";
    const firstClient = clientOptions[0] || "Client Name <client@example.com>";
    const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const invoiceTypeValue = isRecord ? "record" : "collection";

    const sampleRow1 = isRecord
      ? ["Invoice 1", firstClient, invoiceTypeValue, firstDiscount, 7.5, firstCatalogItem, 1, "", 0, "cash", dueDate, "First row controls invoice-level fields."]
      : ["Invoice 1", firstClient, invoiceTypeValue, firstDiscount, 7.5, firstCatalogItem, 1, "", "yes", 25, dueDate, "business", "First row controls invoice-level fields."];
    const sampleRow2 = isRecord
      ? ["Invoice 1", firstClient, invoiceTypeValue, firstDiscount, 7.5, secondCatalogItem, 2, "", "", "", dueDate, ""]
      : ["Invoice 1", firstClient, invoiceTypeValue, firstDiscount, 7.5, secondCatalogItem, 2, "", "yes", 25, dueDate, "business", ""];

    invoicesSheet.addRow(headers);
    invoicesSheet.addRow(sampleRow1);
    invoicesSheet.addRow(sampleRow2);
    invoicesSheet.columns = headers.map((header) => ({ header, key: header, width: Math.max(16, header.length + 2) }));
    invoicesSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    invoicesSheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2D1B6B" } };
    invoicesSheet.views = [{ state: "frozen", ySplit: 1 }];

    const listFormula = (optCol: string, count: number) =>
      `='Dropdown Options'!$${optCol}$2:$${optCol}$${Math.max(count + 1, 3)}`;

    for (let rowNumber = 2; rowNumber <= 201; rowNumber += 1) {
      const clientCol = colOf("Client");
      const discountCol = colOf("Discount Template Name");
      const itemCol = colOf("Item Name");
      const partialCol = colOf("Allow Partial Payment (yes/no)");
      const feeCol = colOf("Fee Absorption (business/customer)");

      if (clientCol) {
        invoicesSheet.getCell(`${clientCol}${rowNumber}`).dataValidation = {
          type: "list", allowBlank: false, formulae: [listFormula("A", clientOptions.length)],
        };
      }
      if (discountCol) {
        invoicesSheet.getCell(`${discountCol}${rowNumber}`).dataValidation = {
          type: "list", allowBlank: true, formulae: [listFormula("C", discountOptions.length)],
        };
      }
      if (itemCol) {
        invoicesSheet.getCell(`${itemCol}${rowNumber}`).dataValidation = {
          type: "list", allowBlank: false, formulae: [listFormula("B", itemOptions.length)],
        };
      }
      // Collection-only dropdowns
      if (!isRecord) {
        if (partialCol) {
          invoicesSheet.getCell(`${partialCol}${rowNumber}`).dataValidation = {
            type: "list", allowBlank: true, formulae: [listFormula("F", 2)],
          };
        }
        if (feeCol) {
          invoicesSheet.getCell(`${feeCol}${rowNumber}`).dataValidation = {
            type: "list", allowBlank: false, formulae: [listFormula("E", 2)],
          };
        }
      }
      // Record-only: payment method dropdown
      if (isRecord) {
        const pmCol = colOf("Payment Method (cash/bank_transfer/pos)");
        if (pmCol) {
          invoicesSheet.getCell(`${pmCol}${rowNumber}`).dataValidation = {
            type: "list", allowBlank: true, formulae: [listFormula("G", paymentMethodOptions.length)],
          };
        }
      }
    }

    clientsSheet.addRow(["Client Name", "Email", "Company", "Phone"]);
    clients.forEach((client) => clientsSheet.addRow([client.full_name, client.email, client.company_name, client.phone]));
    catalogSheet.addRow(["Item Name", "Default Rate", "Description", "Active"]);
    catalog.forEach((item) => catalogSheet.addRow([item.item_name, item.default_rate, item.description, item.is_active ? "yes" : "no"]));
    discountsSheet.addRow(["Template Name", "Percentage", "Active"]);
    discounts.forEach((discount) => discountsSheet.addRow([discount.name, discount.percentage, discount.is_active ? "yes" : "no"]));

    const instructionRows = isRecord
      ? [
          ["Bulk Record Invoice Import Instructions"],
          ["1. Fill the Invoices sheet only. This template is pre-configured for Record invoices."],
          ["2. Use the same Invoice Group for multiple line items that belong to one invoice."],
          ["3. The Client, Item Name, and Discount Template columns have dropdowns."],
          ["4. Leave Unit Rate blank to use a matching item catalog rate."],
          ["5. First row for each Invoice Group controls invoice-level fields: discount, tax, pay date, and notes."],
          ["6. Payment fields (partial payment, fee absorption) are not applicable to record invoices."],
        ]
      : [
          ["Bulk Collection Invoice Import Instructions"],
          ["1. Fill the Invoices sheet only. This template is pre-configured for Collection invoices."],
          ["2. Use the same Invoice Group for multiple line items that belong to one invoice."],
          ["3. The Client, Item Name, Discount Template, Fee Absorption, and Yes/No columns have dropdowns."],
          ["4. Leave Unit Rate blank to use a matching item catalog rate."],
          ["5. First row for each Invoice Group controls invoice-level fields: discount, tax, partial payment, fee absorption, pay date, and notes."],
          ["6. Allow Partial Payment and Fee Absorption only apply to collection invoices."],
        ];
    instructionsSheet.addRows(instructionRows);

    [clientsSheet, catalogSheet, discountsSheet, instructionsSheet].forEach((sheet) => {
      sheet.getRow(1).font = { bold: true };
      sheet.columns.forEach((column) => { column.width = 24; });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `deraledger_bulk_${templateType}_invoices_template.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    setError("");
    setWarnings([]);
    setParsedData([]);

    try {
      const buffer = await uploadedFile.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheetName = workbook.SheetNames.includes("Invoices") ? "Invoices" : workbook.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json<RawInvoiceRow>(workbook.Sheets[sheetName], { defval: "" });
      const rowWarnings: string[] = [];
      const groups: Record<string, RawInvoiceRow[]> = {};

      rows.forEach((row, index) => {
        const ref = text(row["Invoice Group"]) || text(row["Bulk Reference"]);
        if (!ref) {
          rowWarnings.push(`Row ${index + 2}: skipped because Invoice Group is empty.`);
          return;
        }
        if (!groups[ref]) groups[ref] = [];
        groups[ref].push(row);
      });

      const formattedInvoices = Object.keys(groups).map((ref) => {
        const groupRows = groups[ref];
        const firstRow = groupRows[0];
        const clientValue = text(firstRow.Client) || text(firstRow["Client Email"]);
        const emailMatch = clientValue.match(/<([^>]+)>/);
        const clientEmail = (emailMatch?.[1] || clientValue).toLowerCase();
        const matchedClient = clients.find((client) => {
          const emailMatches = client.email?.toLowerCase() === clientEmail;
          const nameMatches = client.full_name.toLowerCase() === clientValue.toLowerCase();
          const combinedMatches = client.email
            ? `${client.full_name} <${client.email}>`.toLowerCase() === clientValue.toLowerCase()
            : false;
          return emailMatches || nameMatches || combinedMatches;
        });

        if (!matchedClient) {
          rowWarnings.push(`${ref}: client "${clientValue || "blank"}" was not found. Map it manually before import.`);
        }

        const discountName = text(firstRow["Discount Template Name"]).toLowerCase();
        const matchedDiscount = discounts.find((discount) => discount.name.toLowerCase() === discountName);
        const discountPct = matchedDiscount ? matchedDiscount.percentage : 0;

        if (discountName && !matchedDiscount) {
          rowWarnings.push(`${ref}: discount template "${discountName}" was not found; using 0%.`);
        }

        const invoiceType = text(firstRow["Invoice Type (collection/record)"]).toLowerCase().includes("record")
          ? "record"
          : "collection";

        const invoiceLevelFields: (keyof RawInvoiceRow)[] = [
          "Client",
          "Client Email",
          "Invoice Type (collection/record)",
          "Discount Template Name",
          "Tax Percentage",
          "Allow Partial Payment (yes/no)",
          "Minimum Payment %",
          "Pay By Date (YYYY-MM-DD)",
          "Fee Absorption (business/customer)",
          "Notes",
        ];

        groupRows.slice(1).forEach((row, rowIndex) => {
          invoiceLevelFields.forEach((field) => {
            const firstValue = normalizedInvoiceLevelValue(firstRow, field);
            const rowValue = normalizedInvoiceLevelValue(row, field);
            if (rowValue && firstValue !== rowValue) {
              rowWarnings.push(`${ref}, row ${rowIndex + 2}: ${field} differs from the first row. The first row value will be used.`);
            }
          });
        });

        const lineItems = groupRows.map((row, rowIndex) => {
          const itemName = text(row["Item Name"]);
          const matchedCatalog = catalog.find((item) => item.item_name.toLowerCase() === itemName.toLowerCase());
          let unitRate = numberValue(row["Unit Rate (blank uses Catalog)"], Number.NaN);

          if (!Number.isFinite(unitRate)) {
            unitRate = matchedCatalog ? Number(matchedCatalog.default_rate) : 0;
          }

          if (!itemName) rowWarnings.push(`${ref}, row ${rowIndex + 1}: item name is blank.`);
          if (!matchedCatalog && unitRate === 0) {
            rowWarnings.push(`${ref}, item "${itemName || "blank"}": no catalog match and no unit rate supplied.`);
          }

          const quantity = numberValue(row.Quantity, 1);
          return {
            item_name: itemName || "Untitled item",
            quantity,
            unit_rate: unitRate,
            line_total: quantity * unitRate,
          };
        });

        const taxPct = numberValue(firstRow["Tax Percentage"], 0);
        const allowPartial = invoiceType === "collection" && text(firstRow["Allow Partial Payment (yes/no)"]).toLowerCase() === "yes";
        const partialPct = numberValue(firstRow["Minimum Payment %"], 0);
        const feeAbsorption = invoiceType === "collection" && text(firstRow["Fee Absorption (business/customer)"]).toLowerCase() === "customer"
          ? "customer"
          : "business";
        const totals = calculateInvoiceTotals(
          lineItems.map((item) => ({ quantity: item.quantity, unitRate: item.unit_rate })),
          discountPct,
          taxPct
        );

        // Record-only: initial payment
        const rawInitial = invoiceType === "record" ? numberValue(firstRow["Initial Payment Amount"], 0) : 0;
        const initialAmountPaid = rawInitial > 0 ? rawInitial : undefined;
        const paymentMethod = invoiceType === "record"
          ? (text(firstRow["Payment Method (cash/bank_transfer/pos)"]) || "cash")
          : undefined;

        if (initialAmountPaid !== undefined && initialAmountPaid > totals.grandTotal) {
          rowWarnings.push(`${ref}: Initial Payment Amount (${initialAmountPaid}) exceeds grand total (${totals.grandTotal}). It will be capped to the grand total.`);
        }

        return {
          bulk_ref: ref,
          client_id: matchedClient?.id || "",
          client_email_raw: clientEmail,
          invoice_type: invoiceType,
          discount_pct: discountPct,
          tax_pct: taxPct,
          discount_value: totals.discountValue,
          tax_value: totals.taxValue,
          subtotal: totals.subtotal,
          grand_total: totals.grandTotal,
          notes: text(firstRow.Notes),
          pay_by_date: excelDate(firstRow["Pay By Date (YYYY-MM-DD)"]),
          fee_absorption: feeAbsorption,
          allow_partial_payment: allowPartial,
          partial_payment_pct: allowPartial && partialPct > 0 ? partialPct : null,
          initial_amount_paid: initialAmountPaid,
          payment_method: paymentMethod,
          lineItems,
        } satisfies ParsedInvoice;
      });

      if (formattedInvoices.length === 0) {
        setError("No valid invoices found. Make sure the Invoices sheet includes Invoice Group values.");
        return;
      }

      setWarnings(rowWarnings);
      setParsedData(formattedInvoices);
    } catch (err) {
      console.error(err);
      setError("Failed to read the Excel file. Please upload the .xlsx template downloaded from this page.");
    }
  };

  const updateInvoiceClient = (index: number, clientId: string) => {
    const newData = [...parsedData];
    newData[index].client_id = clientId;
    setParsedData(newData);
  };

  const handleSubmit = async () => {
    const unmapped = parsedData.filter((inv) => !inv.client_id);
    if (unmapped.length > 0) {
      setError(`Please select a valid client for all invoices. ${unmapped.length} invoice(s) are unmapped.`);
      return;
    }

    const emptyTotals = parsedData.filter((inv) => inv.grand_total <= 0);
    if (emptyTotals.length > 0) {
      setError(`${emptyTotals.length} invoice(s) have zero total. Add valid catalog items or unit rates before import.`);
      return;
    }

    setIsUploading(true);
    setError("");

    try {
      const result = await bulkCreateInvoicesAction(merchantId, parsedData);

      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          router.push("/invoices");
        }, 2000);
      } else {
        setError((result as { error?: string }).error || "Failed to create bulk invoices.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setIsUploading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4 text-center">
        <div className="mb-2 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle className="h-8 w-8 text-emerald-600" />
        </div>
        <h2 className="text-2xl font-bold text-purp-900">Successfully Imported</h2>
        <p className="text-neutral-500">{parsedData.length} invoices have been created. Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/invoices">
          <Button variant="outline" size="icon" className="border-2 border-purp-200">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Bulk Invoice Import</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Upload an Excel workbook. One Invoice Group can contain multiple invoice line items.
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <div className="space-y-6 md:col-span-1">
          <Card className="border-2 border-purp-200 shadow-none">
            <CardHeader>
              <CardTitle className="text-base font-bold text-purp-900">Instructions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-neutral-600">
              <p>1. Select your invoice type below, then download the template.</p>
              <p>2. Fill the <strong>Invoices</strong> sheet.</p>
              <p>3. Dropdowns are preloaded from your clients, catalog, and discount templates.</p>
              <p>4. First row in each group controls invoice-level settings.</p>

              {/* Invoice type selector */}
              <div className="rounded-lg border-2 border-purp-200 bg-purp-50 p-1 flex gap-1">
                <button
                  type="button"
                  onClick={() => setTemplateType("collection")}
                  className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors ${
                    templateType === "collection"
                      ? "bg-purp-900 text-white"
                      : "text-purp-700 hover:bg-purp-100"
                  }`}
                >
                  Collection
                </button>
                <button
                  type="button"
                  onClick={() => setTemplateType("record")}
                  className={`flex-1 rounded-md py-2 text-xs font-semibold transition-colors ${
                    templateType === "record"
                      ? "bg-purp-900 text-white"
                      : "text-purp-700 hover:bg-purp-100"
                  }`}
                >
                  Record
                </button>
              </div>

              <p className="text-xs text-neutral-400">
                {templateType === "collection"
                  ? "Includes payment links, partial payment controls, and fee absorption."
                  : "Offline tracking only. Payment and fee fields are excluded."}
              </p>

              <Button onClick={downloadTemplate} className="mt-1 w-full border-2 border-purp-200 bg-purp-100 font-semibold text-purp-900 shadow-none hover:bg-purp-200">
                <Download className="mr-2 h-4 w-4" />
                Download {templateType === "collection" ? "Collection" : "Record"} Template
              </Button>
            </CardContent>
          </Card>

          <Card className="border-2 border-purp-200 shadow-none">
            <CardContent className="flex flex-col items-center justify-center space-y-4 p-5 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-purp-200 bg-purp-50">
                <Upload className="h-5 w-5 text-purp-700" />
              </div>
              <div>
                <p className="font-semibold text-purp-900">Upload Excel</p>
                <p className="mt-1 text-xs text-neutral-500">{file?.name || "Accepted: .xlsx, .xls"}</p>
              </div>
              <div className="relative w-full">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
                <Button className="pointer-events-none w-full bg-purp-900 font-semibold text-white">
                  Select File
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-3">
          <Card className="flex h-full flex-col border-2 border-purp-200 shadow-none">
            <CardHeader className="border-b-2 border-purp-100 pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold text-purp-900">Invoice Data Mapping</CardTitle>
                {parsedData.length > 0 && (
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-600">
                    {parsedData.length} invoice(s)
                  </span>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col p-0">
              {error && (
                <div className="m-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>{error}</p>
                </div>
              )}

              {warnings.length > 0 && (
                <div className="m-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <p className="font-semibold">Review before import</p>
                  <ul className="mt-2 list-inside list-disc space-y-1">
                    {warnings.slice(0, 6).map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              {parsedData.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center p-8 text-neutral-400">
                  <FileText className="mb-3 h-10 w-10 opacity-20" />
                  <p>Upload a file to see preview here</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-purp-50">
                      <TableRow>
                        <TableHead className="whitespace-nowrap font-bold text-purp-900">Ref</TableHead>
                        <TableHead className="min-w-[220px] whitespace-nowrap font-bold text-purp-900">Mapped Client</TableHead>
                        <TableHead className="whitespace-nowrap font-bold text-purp-900">Type</TableHead>
                        <TableHead className="whitespace-nowrap font-bold text-purp-900">Items</TableHead>
                        <TableHead className="whitespace-nowrap font-bold text-purp-900">Partial</TableHead>
                        {parsedData.some((inv) => inv.invoice_type === "record") && (
                          <TableHead className="whitespace-nowrap font-bold text-purp-900">Initial Paid</TableHead>
                        )}
                        <TableHead className="whitespace-nowrap font-bold text-purp-900">Grand Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedData.map((inv, idx) => (
                        <TableRow key={inv.bulk_ref}>
                          <TableCell className="text-xs font-medium">{inv.bulk_ref}</TableCell>
                          <TableCell>
                            {!inv.client_id ? (
                              <Select onValueChange={(val) => updateInvoiceClient(idx, String(val))}>
                                <SelectTrigger className="h-8 border-red-300 bg-red-50 text-xs text-red-700">
                                  <SelectValue placeholder={`Map: ${inv.client_email_raw || "missing email"}`} />
                                </SelectTrigger>
                                <SelectContent>
                                  {clients.map((client) => (
                                    <SelectItem key={client.id} value={client.id}>
                                      {client.full_name} ({client.email || "no email"})
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                <span className="text-sm">{clients.find((client) => client.id === inv.client_id)?.full_name}</span>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-sm capitalize text-neutral-500">{inv.invoice_type}</TableCell>
                          <TableCell className="text-sm text-neutral-500">{inv.lineItems.length} item(s)</TableCell>
                          <TableCell className="text-sm text-neutral-500">
                            {inv.invoice_type === "collection"
                              ? (inv.allow_partial_payment ? `${inv.partial_payment_pct || 0}% min` : "No")
                              : "—"}
                          </TableCell>
                          {parsedData.some((i) => i.invoice_type === "record") && (
                            <TableCell className="text-sm text-neutral-500">
                              {inv.invoice_type === "record"
                                ? (inv.initial_amount_paid ? formatNaira(inv.initial_amount_paid) : "—")
                                : "—"}
                            </TableCell>
                          )}
                          <TableCell className="font-semibold text-purp-900">{formatNaira(inv.grand_total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {parsedData.length > 0 && (
                <div className="mt-auto border-t-2 border-purp-100 bg-white p-4">
                  <Button
                    onClick={handleSubmit}
                    disabled={isUploading}
                    className="h-11 w-full bg-purp-900 font-semibold text-white hover:bg-purp-700"
                  >
                    {isUploading ? "Generating Invoices..." : `Create ${parsedData.length} Invoices`}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
