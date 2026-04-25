import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "PurpLedger — The Smart Ledger for Modern Collections",
  description:
    "PurpLedger is the smart invoicing platform that handles partial payments, proportional tax allocation, and dynamic ledger tracking. Built for Nigerian businesses.",
  keywords: ["invoicing", "partial payments", "fintech", "Nigeria", "collections", "PurpLedger"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
