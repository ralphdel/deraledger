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
  FolderKanban,
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
import { PlatformUpdateModal } from "@/components/platform-update-modal";

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

  const businessName = merchant?.business_name || "Deraledger";
  const initials = businessName.split(" ").map(n => n[0]).join("").toUpperCase().substring(0, 2);
  const plan = merchant?.subscription_plan || merchant?.merchant_tier || "starter";
  const businessAddressMissing = plan !== "starter" && (!merchant?.business_street?.trim() || !merchant?.business_city?.trim() || !merchant?.business_state?.trim() || !merchant?.business_country?.trim());

  const allNavItems: NavItem[] = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/invoices", label: "Invoices", icon: FileText, requiredPermission: "view_invoices" },
    { href: "/references", label: "References", icon: FolderKanban, requiredPermission: "view_references" },
    { href: "/clients", label: "Clients", icon: Users, requiredPermission: "view_clients" },
    { href: "/settlements", label: "Settlements", icon: Banknote, requiredPermission: "view_settlements" },
    { href: "/accounting-report", label: "Reports", icon: BarChart, requiredPermission: "view_analytics" },
    { href: "/team", label: "Team", icon: UsersRound, requiredPermission: "manage_team" },
    { href: "/purpbot", label: "DeraBot AI", icon: Bot, requiredPermission: "use_purpbot" },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen bg-neutral-50 dark:bg-[#12061F] text-neutral-900 dark:text-white dark:selection:bg-[#7B2FF7]/30 transition-colors duration-300">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex flex-col w-64 bg-purp-900 dark:bg-[#12061F] border-r border-purp-800 dark:border-white/5 fixed inset-y-0 z-30">
        <div className="p-6">
          <Link href="/" className="flex items-center gap-2 text-white">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white dark:bg-[#7B2FF7] dark:shadow-[0_0_10px_rgba(123,47,247,0.4)] text-sm font-bold text-purp-600 dark:text-white">
              <div className="w-4 h-4 bg-purp-600 rounded-sm dark:hidden" />
              <span className="hidden dark:block">D</span>
            </div>
            <span className="text-xl font-bold tracking-tight">DeraLedger</span>
          </Link>
        </div>

        <nav className="flex-1 px-3 space-y-1">
          {allNavItems.filter(item => !item.requiredPermission || (merchant && merchant.permissions && merchant.permissions[item.requiredPermission])).map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive
                  ? "bg-white/15 text-white dark:bg-white/10"
                  : "text-purp-200 hover:bg-white/10 hover:text-white dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-white"
                  }`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 mt-auto border-t border-purp-800 dark:border-white/5">
          <button
            onClick={() => logoutUser()}
            className="flex items-center gap-3 px-3 py-2.5 w-full text-purp-200 hover:text-white hover:bg-white/10 rounded-lg text-sm font-medium transition-colors dark:text-white/60 dark:hover:text-white dark:hover:bg-white/5"
          >
            <LogOut className="h-5 w-5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden">
          <div className="fixed inset-0 bg-neutral-900/50 dark:bg-[#12061F]/80 backdrop-blur-sm z-40" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-72 bg-purp-900 dark:bg-[#12061F] dark:border-r dark:border-white/5 z-50 animate-in slide-in-from-left duration-300">
            <div className="p-6 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2 text-white">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white dark:bg-[#7B2FF7] dark:shadow-[0_0_10px_rgba(123,47,247,0.4)] text-sm font-bold text-purp-600 dark:text-white">
                  <div className="w-4 h-4 bg-purp-600 rounded-sm dark:hidden" />
                  <span className="hidden dark:block">D</span>
                </div>
                <span className="text-xl font-bold tracking-tight">DeraLedger</span>
              </Link>
              <button onClick={() => setSidebarOpen(false)} className="text-white p-1 dark:text-white/60 dark:hover:text-white">
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
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive
                      ? "bg-white/15 text-white dark:bg-white/10"
                      : "text-purp-200 hover:bg-white/10 hover:text-white dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-white"
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
        <header className="sticky top-0 z-20 bg-white dark:bg-[#12061F]/80 dark:backdrop-blur-md border-b-2 border-purp-200 dark:border-white/5 h-16 flex items-center px-4 sm:px-6 lg:px-8 print:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden mr-4 text-purp-900 dark:text-white/80"
          >
            <Menu className="h-6 w-6" />
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger
                render={<button className="relative p-2 text-neutral-500 dark:text-white/60 hover:text-purp-700 dark:hover:text-white hover:bg-purp-50 dark:hover:bg-white/5 rounded-lg transition-colors outline-none" />}
              >
                <Bell className="h-5 w-5" />
                {notifications.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 border-2 border-white dark:border-[#12061F] bg-purp-700 dark:bg-[#7B2FF7] rounded-full" />
                )}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E] p-0 overflow-hidden shadow-xl dark:shadow-2xl">
                <div className="p-4 border-b-2 border-purp-100 dark:border-white/10 bg-purp-50 dark:bg-white/5">
                  <h3 className="font-bold text-purp-900 dark:text-white">Notifications</h3>
                </div>

                <div className="max-h-[350px] overflow-y-auto">
                  {notifications.length > 0 ? (
                    <div className="divide-y divide-purp-50 dark:divide-white/5">
                      {notifications.map((note) => (
                        <Link
                          key={note.id}
                          href={note.link || "#"}
                          className="flex flex-col p-4 hover:bg-purp-50 dark:hover:bg-white/5 transition-colors group"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className={cn(
                              "text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider",
                              note.type === "error" ? "bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400 dark:border dark:border-red-500/20" :
                                note.type === "warning" ? "bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 dark:border dark:border-amber-500/20" :
                                  "bg-purp-100 text-purp-600 dark:bg-[#7B2FF7]/10 dark:text-[#B58CFF] dark:border dark:border-[#7B2FF7]/20"
                            )}>
                              {note.type}
                            </span>
                            <span className="text-[10px] text-neutral-400 dark:text-white/40 font-medium">{note.time}</span>
                          </div>
                          <h4 className="text-sm font-bold text-purp-900 dark:text-white group-hover:text-purp-700 dark:group-hover:text-[#B58CFF]">
                            {note.title}
                          </h4>
                          <p className="text-xs text-neutral-500 dark:text-white/60 leading-relaxed mt-0.5">
                            {note.message}
                          </p>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 flex flex-col items-center justify-center text-center bg-white dark:bg-transparent">
                      <div className="w-12 h-12 rounded-full bg-purp-50 dark:bg-white/5 border-2 border-purp-100 dark:border-white/10 flex items-center justify-center mb-3">
                        <Bell className="h-5 w-5 text-purp-400 dark:text-[#B58CFF]" />
                      </div>
                      <p className="text-purp-900 dark:text-white font-bold text-sm">You're all caught up!</p>
                      <p className="text-neutral-500 dark:text-white/50 text-xs mt-1 max-w-[200px]">We'll notify you when new payments arrive or when actions are needed.</p>
                    </div>
                  )}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={<button className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-purp-50 dark:hover:bg-white/5 transition-colors" />}
              >
                <Avatar className="h-8 w-8 border-2 border-purp-200 dark:border dark:border-[#7B2FF7]/50">
                  <AvatarFallback className="bg-purp-100 dark:bg-[#3D0B66] text-purp-900 dark:text-[#B58CFF] text-xs font-bold">{initials}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium text-purp-900 dark:text-white hidden sm:block">
                  {businessName.split(" ").slice(0, 2).join(" ")}
                </span>
                <ChevronDown className="h-4 w-4 text-neutral-500 dark:text-white/50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 border-2 border-purp-200 dark:border-white/10 dark:bg-[#1A0B2E] shadow-xl dark:shadow-2xl">
                <DropdownMenuItem render={<Link href="/settings" className="cursor-pointer dark:text-white dark:hover:bg-white/5 dark:hover:text-[#B58CFF]" />}>
                  <Settings className="mr-2 h-4 w-4" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator className="dark:bg-white/10" />
                <DropdownMenuItem
                  className="cursor-pointer text-red-600 dark:text-red-400 dark:hover:bg-white/5 dark:hover:text-red-300"
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
          {businessAddressMissing && pathname !== "/settings" ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6 bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400 dark:border dark:border-red-500/20">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2">
                Action Required
              </h2>
              <p className="text-neutral-600 dark:text-white/60 mb-8">
                Your business address is required to continue accessing the platform. Please navigate to settings and update your Business Profile to include your Street, City, and State.
              </p>
              <Link
                href="/settings"
                className="bg-purp-900 text-white dark:bg-[#7B2FF7] px-8 py-3 rounded-lg font-bold hover:bg-purp-800 dark:hover:bg-[#B58CFF] dark:hover:text-[#12061F] transition-all"
              >
                Go to Settings
              </Link>
            </div>
          ) : merchant?.is_hard_locked && pathname !== "/settings/billing" ? (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-md mx-auto">
              <div className={cn("w-16 h-16 rounded-full flex items-center justify-center mb-6 dark:border", merchant.is_suspended ? "bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20" : "bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20")}>
                <AlertCircle className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-neutral-900 dark:text-white mb-2">
                {merchant.is_suspended ? "Account Suspended" : "Access Restricted"}
              </h2>
              <p className="text-neutral-600 dark:text-white/60 mb-8">
                {merchant.is_suspended
                  ? "Your account has been suspended due to a violation of our terms of service or suspicious activity. Please contact support to resolve this issue."
                  : "Your account is currently deactivated or has an expired subscription. Access to dashboard features is blocked until your subscription is renewed."
                }
              </p>
              {merchant.is_suspended ? (
                <a
                  href="mailto:support@deraledger.com"
                  className="bg-red-600 dark:bg-red-500 text-white px-8 py-3 rounded-lg font-bold hover:bg-red-700 dark:hover:bg-red-600 transition-colors"
                >
                  Contact Support
                </a>
              ) : (
                <Link
                  href="/settings/billing"
                  className="bg-purp-900 text-white dark:bg-[#7B2FF7] px-8 py-3 rounded-lg font-bold hover:bg-purp-800 dark:hover:bg-[#B58CFF] dark:hover:text-[#12061F] transition-all"
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
      <PlatformUpdateModal />
    </div>
  );
}
