"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  Users,
  Settings,
  Bot,
  LogOut,
  Menu,
  X,
  Bell,
  ChevronDown,
  UsersRound,
  Banknote,
  BarChart,
} from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getMerchant, getActiveSubscription } from "@/lib/data";
import { logoutUser } from "@/app/(auth)/actions";
import type { Merchant, Subscription } from "@/lib/types";
import { SubscriptionBanner } from "@/components/subscription-banner";
import { SubscriptionExpiryModal } from "@/components/subscription-expiry-modal";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/accounting-report", label: "Accounting Report", icon: BarChart },
  { href: "/settlements", label: "Settlements", icon: Banknote },
  { href: "/team", label: "Team", icon: UsersRound },
  { href: "/purpbot", label: "PurpBot AI", icon: Bot },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  useEffect(() => {
    getMerchant().then((m) => {
      if (m === null) {
        window.location.href = "/onboarding";
      } else {
        setMerchant(m);
        getActiveSubscription(m.id).then((sub) => {
          setSubscription(sub);
        });
      }
    });
  }, []);

  const businessName = merchant?.business_name || "PurpLedger";
  const email = merchant?.email || "";
  const initials = businessName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex-1 w-full flex bg-purp-50">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex lg:w-64 bg-purp-900 flex-col fixed inset-y-0 z-30 print:hidden">
        <div className="p-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center">
              <span className="text-purp-900 font-bold text-lg">P</span>
            </div>
            <span className="text-xl font-bold text-white">PurpLedger</span>
          </Link>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/15 text-white"
                    : "text-purp-200 hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/15">
          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar className="h-8 w-8 border-2 border-purp-700">
              <AvatarFallback className="bg-purp-700 text-white text-xs font-bold">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{businessName.split(" ")[0]}</p>
              <p className="text-xs text-purp-200 truncate">{email}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-64 bg-purp-900 flex flex-col z-50">
            <div className="p-6 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2" onClick={() => setSidebarOpen(false)}>
                <div className="w-9 h-9 bg-white rounded-lg flex items-center justify-center">
                  <span className="text-purp-900 font-bold text-lg">P</span>
                </div>
                <span className="text-xl font-bold text-white">PurpLedger</span>
              </Link>
              <button onClick={() => setSidebarOpen(false)} className="text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 px-4 space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-white/15 text-white"
                        : "text-purp-200 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 lg:ml-64 print:ml-0 flex flex-col min-h-screen">
        {subscription && (
          <>
            <SubscriptionBanner 
              daysRemaining={Math.ceil((new Date(subscription.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} 
              planType={subscription.plan_type} 
            />
            <SubscriptionExpiryModal 
              status={subscription.status} 
              expiryDate={subscription.expiry_date} 
            />
          </>
        )}
        {/* Top Bar */}
        <header className="sticky top-0 z-20 bg-white border-b-2 border-purp-200 h-16 flex items-center px-4 sm:px-6 lg:px-8 print:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden mr-4 text-purp-900"
          >
            <Menu className="h-6 w-6" />
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<button className="relative p-2 text-neutral-500 hover:text-purp-700 hover:bg-purp-50 rounded-lg transition-colors outline-none" />}
              >
                <Bell className="h-5 w-5" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 border-2 border-white bg-purp-700 rounded-full" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 border-2 border-purp-200 p-0 overflow-hidden">
                <div className="p-4 border-b-2 border-purp-100 bg-purp-50">
                  <h3 className="font-bold text-purp-900">Notifications</h3>
                </div>
                <div className="p-8 flex flex-col items-center justify-center text-center bg-white">
                  <div className="w-12 h-12 rounded-full bg-purp-50 border-2 border-purp-100 flex items-center justify-center mb-3">
                    <Bell className="h-5 w-5 text-purp-400" />
                  </div>
                  <p className="text-purp-900 font-bold text-sm">You're all caught up!</p>
                  <p className="text-neutral-500 text-xs mt-1 max-w-[200px]">We'll notify you when new payments arrive or when actions are needed.</p>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={<button className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-purp-50 transition-colors" />}
              >
                  <Avatar className="h-8 w-8 border-2 border-purp-200">
                    <AvatarFallback className="bg-purp-100 text-purp-900 text-xs font-bold">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium text-purp-900 hidden sm:block">
                    {businessName.split(" ").slice(0, 2).join(" ")}
                  </span>
                  <ChevronDown className="h-4 w-4 text-neutral-500" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 border-2 border-purp-200">
                <DropdownMenuItem render={<Link href="/settings" className="cursor-pointer" />}>
                  <Settings className="mr-2 h-4 w-4" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer text-red-600"
                  onClick={async () => {
                    await logoutUser();
                    window.location.href = "/login";
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Log Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
