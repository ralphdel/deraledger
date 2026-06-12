import type { Metadata } from "next";
import { ThemeProvider, themeInitScript } from "@/components/theme-provider";
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
    <html lang="en" suppressHydrationWarning className="h-full overflow-x-hidden antialiased font-sans">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full w-full overflow-x-hidden bg-background text-foreground transition-colors">
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
