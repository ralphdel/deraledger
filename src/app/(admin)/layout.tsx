"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ShieldCheck,
  LayoutDashboard,
  Users,
  ScrollText,
  Activity,
  ChevronDown,
  LogOut,
  Menu,
  X,
  Banknote,
  CalendarClock,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { logoutUser } from "@/app/(auth)/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PlatformUpdateModal } from "@/components/platform-update-modal";

const adminNavItems = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/verification", label: "Verification Queue", icon: ShieldCheck },
  { href: "/admin/merchants", label: "Merchants", icon: Users },
  { href: "/admin/accounting", label: "Accounting", icon: Banknote },
  { href: "/admin/subscriptions", label: "Subscriptions", icon: CalendarClock },
  { href: "/admin/audit", label: "Audit Trail", icon: ScrollText },
  { href: "/admin/health", label: "Platform Health", icon: Activity },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex-1 w-full flex bg-neutral-50">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex lg:w-64 bg-neutral-900 flex-col fixed inset-y-0 z-30">
        <div className="p-6">
          <Link href="/admin" className="flex items-center gap-2">
            <div className="w-9 h-9 bg-red-500 rounded-lg flex items-center justify-center">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold text-white">Deraledger</span>
              <span className="text-[10px] font-semibold bg-red-500 text-white px-1.5 py-0.5 rounded ml-2 uppercase tracking-wider">Admin</span>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          {adminNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive
                  ? "bg-white/15 text-white"
                  : "text-neutral-400 hover:bg-white/10 hover:text-white"
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
            <Avatar className="h-8 w-8 border-2 border-red-500">
              <AvatarFallback className="bg-red-500 text-white text-xs font-bold">SA</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">SuperAdmin</p>
              <p className="text-xs text-neutral-400 truncate">admin@deraledger.app</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 w-64 bg-neutral-900 flex flex-col z-50">
            <div className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 bg-red-500 rounded-lg flex items-center justify-center">
                  <ShieldCheck className="h-5 w-5 text-white" />
                </div>
                <span className="text-lg font-bold text-white">Admin</span>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 px-4 space-y-1">
              {adminNavItems.map((item) => {
                const isActive = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setSidebarOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive
                      ? "bg-white/15 text-white"
                      : "text-neutral-400 hover:bg-white/10 hover:text-white"
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
      <div className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 bg-white border-b border-neutral-200 h-16 flex items-center px-4 sm:px-6 lg:px-8">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden mr-4 text-neutral-900">
            <Menu className="h-6 w-6" />
          </button>

          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-neutral-900">SuperAdmin Console</span>
            <span className="text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded uppercase tracking-wider">Production</span>
          </div>

          <div className="flex-1" />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<button className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-neutral-100 transition-colors" />}
            >
              <Avatar className="h-8 w-8 border-2 border-red-200">
                <AvatarFallback className="bg-red-100 text-red-700 text-xs font-bold">SA</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium text-neutral-900 hidden sm:block">SuperAdmin</span>
              <ChevronDown className="h-4 w-4 text-neutral-500" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem render={<Link href="/dashboard" className="cursor-pointer" />}>
                <LayoutDashboard className="mr-2 h-4 w-4" /> Merchant View
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
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
      <PlatformUpdateModal />
    </div>
  );
}
