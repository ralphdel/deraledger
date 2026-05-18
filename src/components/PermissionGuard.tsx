/**
 * PermissionGuard — Page-level access control for team members.
 *
 * Wrap any dashboard page with this component to ensure team members
 * who lack the required permission see a clear "Access Denied" screen
 * instead of the page content — even if they navigate directly via URL.
 *
 * Usage:
 *   <PermissionGuard permission="view_settlements" merchant={merchant}>
 *     {children}
 *   </PermissionGuard>
 */
"use client";

import { ShieldOff } from "lucide-react";
import Link from "next/link";
import type { Merchant } from "@/lib/types";

interface PermissionGuardProps {
  /** The permission key(s) from the merchant.permissions map. If an array is provided, ANY true permission grants access. */
  permission: string | string[];
  /** The merchant object returned from getMerchant() — may be null while loading */
  merchant: (Merchant & { permissions?: Record<string, boolean>; currentUserRole?: string }) | null;
  /** Content to render when access is granted */
  children: React.ReactNode;
  /** Optional: label for the page/feature shown in the access-denied message */
  featureLabel?: string;
}

export function PermissionGuard({
  permission,
  merchant,
  children,
  featureLabel,
}: PermissionGuardProps) {
  // While merchant is still loading, render nothing (the page's own loading state handles this)
  if (!merchant) return null;

  // Owners always have all permissions — guard is transparent for them
  if (merchant.currentUserRole === "owner" || merchant.currentUserRole === "superadmin") return <>{children}</>;

  // If permissions exist, check if at least one required permission is granted
  let hasAccess = false;
  if (merchant.permissions) {
    if (Array.isArray(permission)) {
      hasAccess = permission.some((p) => merchant.permissions![p] === true);
    } else {
      hasAccess = merchant.permissions[permission] === true;
    }
  }

  // If not granted → deny
  if (!hasAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-sm mx-auto gap-5">
        <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-500/10 border-2 border-red-200 dark:border-red-500/20 flex items-center justify-center">
          <ShieldOff className="w-7 h-7 text-red-600 dark:text-red-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Access Denied</h2>
          <p className="text-sm text-neutral-500 dark:text-white/60 leading-relaxed">
            Your role (<span className="font-semibold capitalize text-neutral-700 dark:text-white/80">{merchant.currentUserRole || "team member"}</span>)
            {featureLabel ? ` does not have permission to access ${featureLabel}.` : " does not have permission to view this page."}
            {" "}Ask your workspace owner to update your role if you need access.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-sm font-semibold text-purp-700 dark:text-[#B58CFF] hover:underline"
        >
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
