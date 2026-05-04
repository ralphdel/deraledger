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
  AlertCircle,
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
import { getMerchant, getActiveSubscription, getNotifications, type AppNotification } from "@/lib/data";
import { logoutUser } from "@/app/(auth)/actions";
import { cn } from "@/lib/utils";
import type { Merchant, Subscription } from "@/lib/types";
import { SubscriptionBanner } from "@/components/subscription-banner";
import { SubscriptionExpiryModal } from "@/components/subscription-expiry-modal";
import { ThemeToggle } from "@/components/theme-toggle";

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  requiredPermission?: string;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    getMerchant().then((m) => {
      if (m === null) {
        window.location.href = "/onboarding";
      } else {
        setMerchant(m);
        getActiveSubscription(m.id).then((sub) => {
          setSubscription(sub);
        });
        getNotifications(m.id).then((notes) => {
          setNotifications(notes);
        });
      }
    });
  }, []);

  const businessName = merchant?.business_name || "PurpLedger";
  const initials = businessName.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);

  const allNavItems: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/invoices", label: "Invoices", icon: FileText, requiredPermission: "view_invoices" },
    { href: "/clients", label: "Clients", icon: Users, requiredPermission: "view_clients" },
    { href: "/settlements", label: "Settlements", icon: Banknote, requiredPermission: "view_settlements" },
    { href: "/accounting-report", label: "Reports", icon: BarChart, requiredPermission: "view_analytics" },
    { href: "/team", label: "Team", icon: UsersRound, requiredPermission: "manage_team" },
    { href: "/purpbot", label: "PurpBot AI", icon: Bot, requiredPermission: "use_purpbot" },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-neutral-50 dark:bg-neutral-950 transition-colors duration-300">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex flex-col w-64 bg-purp-900 dark:bg-neutral-900 border-r border-purp-800 dark:border-neutral-800 fixed inset-y-0 z-30">
        <div className="p-6">
          <Link href="/dashboard" className="flex items-center gap-2 text-white">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
              <div className="w-4 h-4 bg-purp-600 rounded-sm" />
            </div>
            <span className="text-xl font-bold tracking-tight">PurpLedger</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {allNavItems.filter(item => !item.requiredPermission || (merchant && merchant.permissions && merchant.permissions[item.requiredPermission])).map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
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
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto border-t border-purp-800 dark:border-neutral-800">
          <button
            onClick={() => logoutUser()}
            className="flex items-center gap-3 px-3 py-2.5 w-full text-purp-200 hover:text-white hover:bg-white/10 rounded-lg text-sm font-medium transition-colors"
          >
            <LogOut className="h-5 w-5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden">
          <div className="fixed inset-0 bg-neutral-900/50 backdrop-blur-sm z-40" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-72 bg-purp-900 dark:bg-neutral-900 z-50 animate-in slide-in-from-left duration-300">
            <div className="p-6 flex items-center justify-between">
              <Link href="/dashboard" className="flex items-center gap-2 text-white">
                <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
                  <div className="w-4 h-4 bg-purp-600 rounded-sm" />
                </div>
                <span className="text-xl font-bold tracking-tight">PurpLedger</span>
              </Link>
              <button onClick={() => setSidebarOpen(false)} className="text-white p-1">
                <X className="h-6 w-6" />
              </button>
            </div>
            <nav className="px-3 py-4 space-y-1">
              {allNavItems.filter(item => !item.requiredPermission || (merchant && merchant.permissions && merchant.permissions[item.requiredPermission])).map((item) => {
                const isActive = pathname === item.href;
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
        {/* Subscription Banner — show for active subs OR starter plan with no sub */}
        {subscription ? (
          <>
            <SubscriptionBanner 
              daysRemaining={Math.ceil((new Date(subscription.expiry_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} 
              planType={subscription.plan_type} 
              status={subscription.status}
            />
            <SubscriptionExpiryModal 
              status={subscription.status} 
              expiryDate={subscription.expiry_date} 
            />
          </>
        ) : merchant?.subscription_plan === "starter" ? (
          <SubscriptionBanner 
            daysRemaining={9999} 
            planType="starter" 
            status="active"
          />
        ) : null}
        {/* Top Bar */}
        <header className="sticky top-0 z-20 bg-white dark:bg-neutral-900 border-b-2 border-purp-200 dark:border-neutral-800 h-16 flex items-center px-4 sm:px-6 lg:px-8 print:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden mr-4 text-purp-900 dark:text-purp-200"
          >
            <Menu className="h-6 w-6" />
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger
                render={<button className="relative p-2 text-neutral-500 dark:text-neutral-400 hover:text-purp-700 dark:hover:text-purp-300 hover:bg-purp-50 dark:hover:bg-neutral-800 rounded-lg transition-colors outline-none" />}
              >
                <Bell className="h-5 w-5" />
                {notifications.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 border-2 border-white dark:border-neutral-900 bg-purp-700 rounded-full" />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 border-2 border-purp-200 dark:border-neutral-800 p-0 overflow-hidden shadow-xl">
                <div className="p-4 border-b-2 border-purp-100 dark:border-neutral-800 bg-purp-50 dark:bg-neutral-900">
                  <h3 className="font-bold text-purp-900 dark:text-purp-100">Notifications</h3>
                </div>
                
                <div className="max-h-[350px] overflow-y-auto">
                  {notifications.length > 0 ? (
                    <div className="divide-y divide-purp-50 dark:divide-neutral-800">
                      {notifications.map((note) => (
                        <Link 
                          key={note.id} 
                          href={note.link || "#"}
                          className="flex flex-col p-4 hover:bg-purp-50 dark:hover:bg-neutral-800 transition-colors group"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={cn(
                              "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                              note.type === "error" ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400" :
                              note.type === "warning" ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400" :
                              "bg-purp-100 text-purp-600 dark:bg-purp-900/30 dark:text-purp-400"
                            )}>
                              {note.type}
                            </span>
                            <span className="text-[10px] text-neutral-400 font-medium">{note.time}</span>
                          </div>
                          <h4 className="text-sm font-bold text-purp-900 dark:text-purp-100 group-hover:text-purp-700 dark:group-hover:text-purp-300">
                            {note.title}
                          </h4>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed mt-0.5">
                            {note.message}
                          </p>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 flex flex-col items-center justify-center text-center bg-white dark:bg-neutral-900">
                      <div className="w-12 h-12 rounded-full bg-purp-50 dark:bg-neutral-800 border-2 border-purp-100 dark:border-neutral-800 flex items-center justify-center mb-3">
                        <Bell className="h-5 w-5 text-purp-400" />
                      </div>
                      <p className="text-purp-900 dark:text-purp-100 font-bold text-sm">You're all caught up!</p>
                      <p className="text-neutral-500 dark:text-neutral-400 text-xs mt-1 max-w-[200px]">We'll notify you when new payments arrive or when actions are needed.</p>
                    </div>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={<button className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-purp-50 dark:hover:bg-neutral-800 transition-colors" />}
              >
                  <Avatar className="h-8 w-8 border-2 border-purp-200 dark:border-neutral-700">
                    <AvatarFallback className="bg-purp-100 dark:bg-neutral-800 text-purp-900 dark:text-purp-100 text-xs font-bold">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium text-purp-900 dark:text-purp-100 hidden sm:block">
                    {businessName.split(" ").slice(0, 2).join(" ")}
                  </span>
                  <ChevronDown className="h-4 w-4 text-neutral-500 dark:text-neutral-400" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 border-2 border-purp-200 dark:border-neutral-800 shadow-xl">
                <DropdownMenuItem render={<Link href="/settings" className="cursor-pointer" />}>
                  <Settings className="mr-2 h-4 w-4" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer text-red-600 dark:text-red-400"
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
        <main className="flex-1 p-4 sm:p-6 lg:p-8">
          {merchant?.is_hard_locked && pathname !== "/settings/billing" ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto">
              <div className={cn("w-16 h-16 rounded-full flex items-center justify-center mb-6", merchant.is_suspended ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600")}>
                <AlertCircle className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100 mb-2">
                {merchant.is_suspended ? "Account Suspended" : "Access Restricted"}
              </h2>
              <p className="text-neutral-600 dark:text-neutral-400 mb-8">
                {merchant.is_suspended 
                  ? "Your account has been suspended due to a violation of our terms of service or suspicious activity. Please contact support to resolve this issue."
                  : "Your account is currently deactivated or has an expired subscription. Access to dashboard features is blocked until your subscription is renewed."
                }
              </p>
              {merchant.is_suspended ? (
                <a 
                  href="mailto:support@purpledger.com" 
                  className="bg-red-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-red-700 transition-colors"
                >
                  Contact Support
                </a>
              ) : (
                <Link 
                  href="/settings/billing" 
                  className="bg-purp-900 text-white px-8 py-3 rounded-lg font-bold hover:bg-purp-800 transition-colors"
                >
                  Go to Billing & Subscription
                </Link>
              )}
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}
