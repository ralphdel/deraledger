"use client";

import { useState } from "react";
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
import { bulkCreateClientsAction } from "@/lib/actions";
import { getMerchant } from "@/lib/data";

type ClientImportRow = {
  full_name: string;
  email: string | null;
  phone: string | null;
  company_name: string | null;
  address: string | null;
  whatsapp_number: string | null;
  reminder_enabled: boolean;
  reminder_channels: string[];
};

type RawClientTemplateRow = {
  "Full Name"?: string;
  Email?: string;
  Phone?: string;
  "Company Name"?: string;
  Address?: string;
  "WhatsApp Number"?: string;
  "Reminder Enabled (yes/no)"?: string;
  "Reminder Channels (email/whatsapp/both)"?: string;
};

const clientHeaders = [
  "Full Name",
  "Email",
  "Phone",
  "Company Name",
  "Address",
  "WhatsApp Number",
  "Reminder Enabled (yes/no)",
  "Reminder Channels (email/whatsapp/both)",
];

function text(value: unknown) {
  return String(value ?? "").trim();
}

function reminderChannels(value: unknown) {
  const normalized = text(value).toLowerCase();
  if (normalized === "both") return ["email", "whatsapp"];
  if (normalized === "whatsapp") return ["whatsapp"];
  if (normalized === "email") return ["email"];
  return [];
}

export default function BulkClientsPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ClientImportRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [success, setSuccess] = useState(false);

  const downloadTemplate = () => {
    const workbook = XLSX.utils.book_new();
    const clientsSheet = XLSX.utils.json_to_sheet(
      [
        {
          "Full Name": "John Doe",
          Email: "john@example.com",
          Phone: "08012345678",
          "Company Name": "Doe Supplies",
          Address: "12 Market Road, Lagos",
          "WhatsApp Number": "08012345678",
          "Reminder Enabled (yes/no)": "yes",
          "Reminder Channels (email/whatsapp/both)": "both",
        },
      ],
      { header: clientHeaders }
    );

    const instructionsSheet = XLSX.utils.aoa_to_sheet([
      ["Bulk Client Import Instructions"],
      ["1. Fill the Clients sheet only. Do not rename the headers."],
      ["2. Full Name is required for every row."],
      ["3. Reminder Enabled accepts yes or no."],
      ["4. Reminder Channels accepts email, whatsapp, both, or blank."],
      ["5. Upload this .xlsx file when you are done."],
    ]);

    XLSX.utils.book_append_sheet(workbook, clientsSheet, "Clients");
    XLSX.utils.book_append_sheet(workbook, instructionsSheet, "Instructions");
    XLSX.writeFile(workbook, "deraledger_bulk_clients_template.xlsx");
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
      const sheetName = workbook.SheetNames.includes("Clients") ? "Clients" : workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<RawClientTemplateRow>(sheet, { defval: "" });

      const seenEmails = new Set<string>();
      const rowWarnings: string[] = [];
      const formatted = rows
        .map((row, index) => {
          const fullName = text(row["Full Name"]);
          const email = text(row.Email).toLowerCase();

          if (!fullName) {
            rowWarnings.push(`Row ${index + 2}: skipped because Full Name is empty.`);
            return null;
          }

          if (email) {
            if (seenEmails.has(email)) {
              rowWarnings.push(`Row ${index + 2}: duplicate email ${email}; import may fail if duplicates are not allowed.`);
            }
            seenEmails.add(email);
          }

          return {
            full_name: fullName,
            email: email || null,
            phone: text(row.Phone) || null,
            company_name: text(row["Company Name"]) || null,
            address: text(row.Address) || null,
            whatsapp_number: text(row["WhatsApp Number"]) || null,
            reminder_enabled: text(row["Reminder Enabled (yes/no)"]).toLowerCase() === "yes",
            reminder_channels: reminderChannels(row["Reminder Channels (email/whatsapp/both)"]),
          };
        })
        .filter((row): row is ClientImportRow => Boolean(row));

      if (formatted.length === 0) {
        setError("No valid clients found. Make sure the Clients sheet has at least one row with Full Name.");
        return;
      }

      setWarnings(rowWarnings);
      setParsedData(formatted);
    } catch (err) {
      console.error(err);
      setError("Failed to read the Excel file. Please upload the .xlsx template downloaded from this page.");
    }
  };

  const handleSubmit = async () => {
    if (parsedData.length === 0) {
      setError("No valid clients found in the file.");
      return;
    }

    setIsUploading(true);
    setError("");

    try {
      const merchant = await getMerchant();
      if (!merchant) throw new Error("Could not verify merchant identity.");

      const result = await bulkCreateClientsAction(merchant.id, parsedData);

      if (result.success) {
        setSuccess(true);
        setTimeout(() => {
          router.push("/clients");
        }, 2000);
      } else {
        setError((result as { error?: string }).error || "Failed to create bulk clients.");
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
        <p className="text-neutral-500">Your clients have been added. Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/clients">
          <Button variant="outline" size="icon" className="border-2 border-purp-200">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-purp-900">Bulk Client Import</h1>
          <p className="mt-1 text-sm text-neutral-500">Upload multiple clients with an Excel workbook.</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="space-y-6 md:col-span-1">
          <Card className="border-2 border-purp-200 shadow-none">
            <CardHeader>
              <CardTitle className="text-base font-bold text-purp-900">Instructions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-neutral-600">
              <p>1. Download the Excel template.</p>
              <p>2. Fill the <strong>Clients</strong> sheet without changing headers.</p>
              <p>3. <strong>Full Name</strong> is required for every row.</p>
              <p>4. Upload the completed .xlsx file here.</p>
              <Button onClick={downloadTemplate} className="mt-2 w-full border-2 border-purp-200 bg-purp-100 font-semibold text-purp-900 shadow-none hover:bg-purp-200">
                <Download className="mr-2 h-4 w-4" />
                Download Excel Template
              </Button>
            </CardContent>
          </Card>

          <Card className="border-2 border-purp-200 shadow-none">
            <CardContent className="flex flex-col items-center justify-center space-y-4 p-5 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-purp-200 bg-purp-50">
                <Upload className="h-5 w-5 text-purp-700" />
              </div>
              <div>
                <p className="font-semibold text-purp-900">Upload Excel File</p>
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

        <div className="md:col-span-2">
          <Card className="flex h-full flex-col border-2 border-purp-200 shadow-none">
            <CardHeader className="border-b-2 border-purp-100 pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold text-purp-900">Data Preview</CardTitle>
                {parsedData.length > 0 && (
                  <span className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-600">
                    {parsedData.length} valid row(s)
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
                    {warnings.slice(0, 4).map((warning) => (
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
                        <TableHead className="whitespace-nowrap font-bold text-purp-900">Full Name</TableHead>
                        <TableHead className="whitespace-nowrap font-bold text-purp-900">Email</TableHead>
                        <TableHead className="whitespace-nowrap font-bold text-purp-900">Company</TableHead>
                        <TableHead className="whitespace-nowrap font-bold text-purp-900">WhatsApp</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedData.slice(0, 8).map((row, idx) => (
                        <TableRow key={`${row.full_name}-${idx}`}>
                          <TableCell className="font-medium">{row.full_name}</TableCell>
                          <TableCell className="text-neutral-500">{row.email || "-"}</TableCell>
                          <TableCell className="text-neutral-500">{row.company_name || "-"}</TableCell>
                          <TableCell className="text-neutral-500">{row.whatsapp_number || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {parsedData.length > 8 && (
                    <div className="border-t bg-neutral-50 p-3 text-center text-xs text-neutral-500">
                      ...and {parsedData.length - 8} more rows
                    </div>
                  )}
                </div>
              )}

              {parsedData.length > 0 && (
                <div className="mt-auto border-t-2 border-purp-100 bg-white p-4">
                  <Button
                    onClick={handleSubmit}
                    disabled={isUploading}
                    className="h-11 w-full bg-purp-900 font-semibold text-white hover:bg-purp-700"
                  >
                    {isUploading ? "Importing Clients..." : `Import ${parsedData.length} Clients`}
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
