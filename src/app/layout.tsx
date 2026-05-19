import type { Metadata } from "next";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "DeraLedger - Built for Businesses That Get Paid in Parts",
  description:
    "DeraLedger is collections and receivables infrastructure for African businesses that accept deposits, installments, and fragmented payments.",
  keywords: ["collections", "receivables", "partial payments", "fintech", "Africa", "DeraLedger"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased font-sans overflow-x-hidden">
      <body className="min-h-full flex flex-col overflow-x-hidden w-full bg-[#0B0615]">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
