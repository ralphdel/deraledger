export type MerchantRelationshipType = "owner" | "team_member" | "super_admin";

export type MerchantContextResult =
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | { status: "ambiguous_team_membership" }
  | { status: "membership_query_failed" }
  | { status: "merchant_read_failed" }
  | {
      status: "resolved";
      merchantId: string;
      relationship: MerchantRelationshipType;
      roleName: string;
      permissions: Record<string, boolean>;
    };

export type DashboardMerchantNavigationDecision =
  | { action: "stay"; reason: "resolved_context" | "resolved_context_without_merchant_dto" }
  | { action: "login"; reason: "unauthenticated" }
  | { action: "onboarding"; reason: "no_workspace" | "ambiguous_team_membership" }
  | { action: "error"; reason: "membership_query_failed" | "merchant_read_failed" };

type SupabaseLike = {
  from(table: string): any;
};

type AuthUserLike = {
  id?: string | null;
  email?: string | null;
  app_metadata?: Record<string, unknown> | null;
};

type MerchantRow = {
  id?: string | null;
  user_id?: string | null;
  is_super_admin?: boolean | null;
};

type TeamMembershipRow = {
  merchant_id?: string | null;
  is_active?: boolean | null;
  roles?: { name?: string | null; permissions?: Record<string, boolean> | null }
    | Array<{ name?: string | null; permissions?: Record<string, boolean> | null }>
    | null;
};

const OWNER_PERMISSIONS: Record<string, boolean> = {
  view_invoices: true,
  create_invoice: true,
  edit_invoice: true,
  record_payment: true,
  manual_close: true,
  void_invoice: true,
  view_clients: true,
  manage_clients: true,
  delete_client: true,
  view_analytics: true,
  view_transactions: true,
  manage_kyc: true,
  change_fee_settings: true,
  manage_business: true,
  manage_billing: true,
  manage_team: true,
  use_purpbot: true,
  view_settlements: true,
  manage_advance_settings: true,
  manage_settlement_account: true,
  manage_item_catalog: true,
  manage_discount_template: true,
  view_item_catalog: true,
  view_discount_template: true,
  view_references: true,
  manage_references: true,
};

export async function resolveMerchantContextForUser(
  supabase: SupabaseLike,
  user: AuthUserLike | null | undefined,
  options: { preferredMerchantId?: string | null } = {},
): Promise<MerchantContextResult> {
  const userId = typeof user?.id === "string" ? user.id : null;
  if (!userId) return { status: "unauthenticated" };

  const isSuperAdmin = user?.app_metadata?.is_super_admin === true;
  const preferredMerchantId = normalizeUuidCandidate(options.preferredMerchantId);

  if (preferredMerchantId) {
    const preferred = await readMerchantById(supabase, preferredMerchantId);
    if (!preferred.ok) {
      return { status: "merchant_read_failed" };
    }

    if (preferred.row?.id) {
      if (preferred.row?.user_id === userId) {
        return ownerContext(preferred.row.id as string);
      }

      const membership = await readActiveTeamMembership(supabase, {
        userId,
        merchantId: preferred.row.id,
      });
      if (!membership.ok) {
        return { status: "membership_query_failed" };
      }
      if (membership.row?.merchant_id) {
        return teamContext(membership.row);
      }

      if (isSuperAdmin || await userOwnsSuperAdminMerchant(supabase, userId)) {
        return superAdminContext(preferred.row.id);
      }
    }

    const preferredMembership = await readActiveTeamMembership(supabase, {
      userId,
      merchantId: preferredMerchantId,
    });
    if (!preferredMembership.ok) {
      return { status: "membership_query_failed" };
    }
    if (preferredMembership.row?.merchant_id) {
      return teamContext(preferredMembership.row);
    }

    if (isSuperAdmin || await userOwnsSuperAdminMerchant(supabase, userId)) {
      return superAdminContext(preferredMerchantId);
    }
  }

  const owned = await readOwnedMerchant(supabase, userId);
  if (!owned.ok) {
    return { status: "merchant_read_failed" };
  }
  if (owned.row?.id) {
    if (owned.row.is_super_admin || isSuperAdmin) {
      return superAdminContext(owned.row.id);
    }
    return ownerContext(owned.row.id);
  }

  const memberships = await readActiveTeamMemberships(supabase, userId);
  if (!memberships.ok) {
    return { status: "membership_query_failed" };
  }
  if (memberships.rows.length > 1) {
    return { status: "ambiguous_team_membership" };
  }

  const membership = memberships.rows[0];
  if (membership?.merchant_id) {
    return teamContext(membership);
  }

  return { status: "not_found" };
}

export function getDashboardMerchantNavigationDecision(
  context: MerchantContextResult,
  hasMerchantDto: boolean,
): DashboardMerchantNavigationDecision {
  if (context.status === "unauthenticated") {
    return { action: "login", reason: "unauthenticated" };
  }

  if (context.status === "ambiguous_team_membership") {
    return { action: "onboarding", reason: "ambiguous_team_membership" };
  }

  if (context.status === "membership_query_failed" || context.status === "merchant_read_failed") {
    return { action: "error", reason: context.status };
  }

  if (context.status !== "resolved") {
    return { action: "onboarding", reason: "no_workspace" };
  }

  return {
    action: "stay",
    reason: hasMerchantDto ? "resolved_context" : "resolved_context_without_merchant_dto",
  };
}

export function traceTeamDashboardRedirect(
  input: {
    source: string;
    context: MerchantContextResult;
    hasMerchantDto: boolean;
    hasWorkspaceCookie: boolean;
    workspaceAuthorized?: boolean | null;
    redirectReason: string;
  },
) {
  if (process.env.NODE_ENV === "production") return;
  const context = input.context;
  console.info("[team-dashboard-trace]", {
    source: input.source,
    contextKind: context.status === "resolved" ? context.relationship : context.status,
    hasMerchantContext: context.status === "resolved",
    hasMerchantDto: input.hasMerchantDto,
    hasWorkspaceCookie: input.hasWorkspaceCookie,
    workspaceAuthorized: input.workspaceAuthorized ?? (
      context.status === "resolved" && input.hasWorkspaceCookie ? true : null
    ),
    membershipActive: context.status === "resolved" ? context.relationship === "team_member" : null,
    role: context.status === "resolved" ? context.roleName : null,
    redirectReason: input.redirectReason,
  });
}

export function isResolvedMerchantContext(
  result: MerchantContextResult,
): result is Extract<MerchantContextResult, { status: "resolved" }> {
  return result.status === "resolved";
}

export function canManageSettlementAccounts(result: MerchantContextResult) {
  if (!isResolvedMerchantContext(result)) return false;
  if (result.relationship === "owner" || result.relationship === "super_admin") {
    return true;
  }
  return result.permissions.manage_settlement_account === true;
}

function ownerContext(merchantId: string): Extract<MerchantContextResult, { status: "resolved" }> {
  return {
    status: "resolved",
    merchantId,
    relationship: "owner",
    roleName: "owner",
    permissions: { ...OWNER_PERMISSIONS },
  };
}

function superAdminContext(merchantId: string): Extract<MerchantContextResult, { status: "resolved" }> {
  return {
    ...ownerContext(merchantId),
    relationship: "super_admin",
    roleName: "superadmin",
  };
}

function teamContext(
  membership: TeamMembershipRow,
): Extract<MerchantContextResult, { status: "resolved" }> {
  const role = normalizeRole(membership.roles);
  return {
    status: "resolved",
    merchantId: membership.merchant_id as string,
    relationship: "team_member",
    roleName: role.name || "viewer",
    permissions: role.permissions || {},
  };
}

async function readMerchantById(supabase: SupabaseLike, merchantId: string) {
  const result = await supabase
    .from("merchants")
    .select("id,user_id,is_super_admin")
    .eq("id", merchantId)
    .maybeSingle();
  if (hasQueryError(result)) {
    return { ok: false as const, row: null };
  }
  return { ok: true as const, row: normalizeSingleRow<MerchantRow>(result) };
}

async function readOwnedMerchant(supabase: SupabaseLike, userId: string) {
  const result = await supabase
    .from("merchants")
    .select("id,user_id,is_super_admin")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (hasQueryError(result)) {
    return { ok: false as const, row: null };
  }
  return { ok: true as const, row: normalizeSingleRow<MerchantRow>(result) };
}

async function userOwnsSuperAdminMerchant(supabase: SupabaseLike, userId: string) {
  const result = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", userId)
    .eq("is_super_admin", true)
    .limit(1)
    .maybeSingle();
  return Boolean(normalizeSingleRow<MerchantRow>(result)?.id);
}

async function readActiveTeamMembership(
  supabase: SupabaseLike,
  input: { userId: string; merchantId: string },
) {
  const result = await supabase
    .from("merchant_team")
    .select("merchant_id,is_active,roles(name,permissions)")
    .eq("merchant_id", input.merchantId)
    .eq("user_id", input.userId)
    .eq("is_active", true)
    .maybeSingle();
  if (hasQueryError(result)) {
    return { ok: false as const, row: null };
  }
  return { ok: true as const, row: normalizeSingleRow<TeamMembershipRow>(result) };
}

async function readActiveTeamMemberships(supabase: SupabaseLike, userId: string) {
  const result = await supabase
    .from("merchant_team")
    .select("merchant_id,is_active,roles(name,permissions)")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(2);
  if (hasQueryError(result)) {
    return { ok: false as const, rows: [] };
  }
  return { ok: true as const, rows: normalizeRows<TeamMembershipRow>(result) };
}

function hasQueryError(result: unknown) {
  return Boolean(result && typeof result === "object" && "error" in result && (result as { error?: unknown }).error);
}

function normalizeSingleRow<T>(result: unknown): T | null {
  const data = extractData(result);
  if (Array.isArray(data)) return (data[0] as T | undefined) || null;
  return (data as T | null | undefined) || null;
}

function normalizeRows<T>(result: unknown): T[] {
  const data = extractData(result);
  if (Array.isArray(data)) return data as T[];
  return data ? [data as T] : [];
}

function extractData(result: unknown) {
  if (result && typeof result === "object" && "data" in result) {
    return (result as { data?: unknown }).data;
  }
  return result;
}

function normalizeRole(value: TeamMembershipRow["roles"]) {
  const role = Array.isArray(value) ? value[0] : value;
  return {
    name: typeof role?.name === "string" && role.name ? role.name : "viewer",
    permissions: role?.permissions && typeof role.permissions === "object"
      ? role.permissions
      : {},
  };
}

function normalizeUuidCandidate(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
