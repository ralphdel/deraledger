import type {
  CollectionLimitStateSnapshot,
  CommercialEntitlementSnapshot,
  MerchantComplianceProfileSnapshot,
  MerchantWorkspaceOperationalStateSnapshot,
  PayoutReadinessSnapshot,
  ProviderSettlementReadinessSnapshot,
  TrustedCollectionProvider,
  TrustedPaymentEnvironment,
  TrustedRuntimeCapabilityLoaderRepository,
  TrustedRuntimeCapabilityReadResult,
} from "./trusted-runtime-capability-loader-core";

/**
 * Read-only, dependency-injected repository implementation for the future
 * server-only capability loader. It is deliberately not imported by routes.
 */

export interface SupabaseReadQueryLike {
  select(columns: string): SupabaseReadQueryLike;
  eq(column: string, value: unknown): SupabaseReadQueryLike;
  in?(column: string, values: readonly unknown[]): SupabaseReadQueryLike;
  limit?(count: number): SupabaseReadQueryLike;
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

export interface SupabaseReadClientLike {
  from(table: string): Pick<SupabaseReadQueryLike, "select">;
}

export interface TrustedRuntimeCapabilityRepositoryOptions {
  /** These are trusted server routing/configuration inputs, never browser data. */
  provider: TrustedCollectionProvider;
  environment: TrustedPaymentEnvironment;
  now?: () => Date;
}

type Row = Record<string, unknown>;

const GLOBAL_FLAG_KEYS = {
  storefrontEnabled: "storefront_enabled",
  instantSaleEnabled: "instant_sale_enabled",
  receivableSaleEnabled: "receivable_sale_enabled",
  merchantConfirmationBeforeDepositEnabled: "merchant_confirmation_before_deposit_enabled",
  customerRegistrationRequiredForReceivables:
    "customer_registration_required_for_receivables",
} as const;

function asRows(result: unknown): Row[] | null {
  if (!result || typeof result !== "object") return null;
  const response = result as { data?: unknown; error?: unknown };
  if (response.error) return null;
  if (Array.isArray(response.data)) return response.data.filter(isRow);
  return isRow(response.data) ? [response.data] : [];
}

function isRow(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function lowerText(value: unknown): string | null {
  return text(value)?.toLowerCase() ?? null;
}

function bool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function queryError<T>(): TrustedRuntimeCapabilityReadResult<T> {
  return { kind: "error" };
}

function missing<T>(): TrustedRuntimeCapabilityReadResult<T> {
  return { kind: "missing" };
}

function found<T>(value: T): TrustedRuntimeCapabilityReadResult<T> {
  return { kind: "found", value };
}

async function runQuery(query: SupabaseReadQueryLike): Promise<Row[] | null> {
  try {
    return asRows(await query);
  } catch {
    return null;
  }
}

function withLimit(query: SupabaseReadQueryLike, count: number): SupabaseReadQueryLike {
  return query.limit ? query.limit(count) : query;
}

async function readDefaultPayoutAccount(
  client: SupabaseReadClientLike,
  merchantId: string,
): Promise<TrustedRuntimeCapabilityReadResult<Row>> {
  const rows = await runQuery(
    withLimit(
      client
        .from("merchant_settlement_accounts")
        .select("id,merchant_id,currency,is_default,status,verification_status")
        .eq("merchant_id", merchantId)
        .eq("is_default", true)
        .eq("status", "active")
        .eq("verification_status", "verified")
        .eq("currency", "NGN"),
      2,
    ),
  );
  if (!rows) return queryError();
  if (rows.length !== 1 || !text(rows[0].id)) return missing();
  return found(rows[0]);
}

function isCurrentLimitWindow(row: Row, now: Date): boolean {
  if (lowerText(row.window_type) !== "cumulative" || text(row.policy_timezone) !== "Africa/Lagos") {
    return false;
  }
  const start = Date.parse(String(row.window_start ?? ""));
  const end = row.window_end === null || row.window_end === undefined
    ? null
    : Date.parse(String(row.window_end));
  return Number.isFinite(start) && start <= now.getTime() && (end === null || end > now.getTime());
}

/**
 * Factory only. It performs no reads at import or construction time.
 */
export function createTrustedRuntimeCapabilityRepository(
  client: SupabaseReadClientLike,
  options: TrustedRuntimeCapabilityRepositoryOptions,
): TrustedRuntimeCapabilityLoaderRepository {
  return {
    async resolveTrustedMerchantWorkspace({ authenticatedUserId }) {
      const owners = await runQuery(
        withLimit(
          client.from("merchants").select("id,user_id").eq("user_id", authenticatedUserId),
          2,
        ),
      );
      if (!owners) return queryError();

      let merchantId: string | null = null;
      let relationship: "owner" | "team_member" | null = null;
      if (owners.length === 1 && text(owners[0].id)) {
        merchantId = text(owners[0].id);
        relationship = "owner";
      } else if (owners.length > 1) {
        return queryError();
      } else {
        const memberships = await runQuery(
          withLimit(
            client
              .from("merchant_team")
              .select("merchant_id,user_id,is_active")
              .eq("user_id", authenticatedUserId)
              .eq("is_active", true),
            2,
          ),
        );
        if (!memberships) return queryError();
        if (memberships.length !== 1 || !text(memberships[0].merchant_id)) return missing();
        merchantId = text(memberships[0].merchant_id);
        relationship = "team_member";
      }

      const workspaces = await runQuery(
        withLimit(
          client
            .from("workspaces")
            .select("id,merchant_id")
            .eq("merchant_id", merchantId as string),
          2,
        ),
      );
      if (!workspaces) return queryError();
      if (workspaces.length !== 1 || !text(workspaces[0].id)) return missing();
      return found({
        authenticatedUserId,
        merchantId: merchantId as string,
        workspaceId: text(workspaces[0].id) as string,
        relationship: relationship as "owner" | "team_member",
      });
    },

    async loadCommercialEntitlement({ merchantId, workspaceId }) {
      const [merchantRows, workspaceRows, subscriptions, workspaceSubscriptions] = await Promise.all([
        runQuery(withLimit(client.from("merchants").select("id,plan").eq("id", merchantId), 2)),
        runQuery(
          withLimit(
            client
              .from("workspaces")
              .select("id,merchant_id,plan_type")
              .eq("id", workspaceId)
              .eq("merchant_id", merchantId),
            2,
          ),
        ),
        runQuery(
          client
            .from("subscriptions")
            .select("merchant_id,plan_type,status,expiry_date")
            .eq("merchant_id", merchantId),
        ),
        runQuery(
          client
            .from("workspace_subscriptions")
            .select("merchant_id,workspace_id,plan_type,subscription_status")
            .eq("merchant_id", merchantId)
            .eq("workspace_id", workspaceId),
        ),
      ]);
      if (!merchantRows || !workspaceRows || !subscriptions || !workspaceSubscriptions) {
        return queryError<CommercialEntitlementSnapshot>();
      }
      if (merchantRows.length !== 1 || workspaceRows.length !== 1) {
        return missing<CommercialEntitlementSnapshot>();
      }
      return found({
        merchantPlan: text(merchantRows[0].plan),
        workspacePlan: text(workspaceRows[0].plan_type),
        subscriptions: subscriptions.map((row) => ({
          plan: text(row.plan_type),
          status: text(row.status),
          expiresAt: text(row.expiry_date),
        })),
        workspaceSubscriptions: workspaceSubscriptions.map((row) => ({
          plan: text(row.plan_type),
          status: text(row.subscription_status),
        })),
      });
    },

    async loadComplianceProfiles({ merchantId }) {
      const rows = await runQuery(
        withLimit(
          client
            .from("merchant_compliance_profiles")
            .select("merchant_id,compliance_status,activation_status,risk_rating,restriction_state,approved_monthly_volume,cumulative_collection_cap,cumulative_collection_used,hidden_daily_velocity_limit,single_transaction_limit,can_collect_payments,can_use_instant_sale,can_use_receivable_sale,can_use_storefront,can_activate_settlement,can_use_deposit_balance")
            .eq("merchant_id", merchantId),
          2,
        ),
      );
      if (!rows) return queryError<readonly MerchantComplianceProfileSnapshot[]>();
      return found(rows.map((row) => {
        const merchantEntitlements = {
          canCollectPayments: bool(row.can_collect_payments),
          canUseInstantSale: bool(row.can_use_instant_sale),
          canUseReceivableSale: bool(row.can_use_receivable_sale),
          canUseStorefront: bool(row.can_use_storefront),
          canActivateSettlement: bool(row.can_activate_settlement),
          canUseDepositBalance: bool(row.can_use_deposit_balance),
        };
        return {
          complianceStatus: text(row.compliance_status),
          activationStatus: text(row.activation_status),
          riskRating: text(row.risk_rating),
          restrictionState: text(row.restriction_state),
          approvedMonthlyVolumeNgn: numberValue(row.approved_monthly_volume),
          cumulativeCollectionCapNgn: numberValue(row.cumulative_collection_cap),
          cumulativeCollectionUsedNgn: numberValue(row.cumulative_collection_used),
          hiddenDailyVelocityLimitNgn: numberValue(row.hidden_daily_velocity_limit),
          singleTransactionLimitNgn: numberValue(row.single_transaction_limit),
          merchantEntitlements: Object.values(merchantEntitlements).every(
            (value) => typeof value === "boolean",
          ) ? merchantEntitlements : null,
          soloPlusEnhancedVerificationStatus: null,
          businessKybVerificationStatus: null,
        };
      }));
    },

    async loadGlobalFeatureFlags() {
      let query = client.from("platform_settings").select("key,value");
      if (query.in) query = query.in("key", Object.values(GLOBAL_FLAG_KEYS));
      const rows = await runQuery(withLimit(query, 6));
      if (!rows) return queryError();
      const values = new Map<string, boolean>();
      for (const row of rows) {
        const key = text(row.key);
        const value = lowerText(row.value);
        if (!key || values.has(key) || (value !== "true" && value !== "false")) return missing();
        values.set(key, value === "true");
      }
      const flags = Object.fromEntries(
        Object.entries(GLOBAL_FLAG_KEYS).map(([name, key]) => [name, values.get(key)]),
      ) as Record<keyof typeof GLOBAL_FLAG_KEYS, boolean | undefined>;
      if (Object.values(flags).some((value) => typeof value !== "boolean")) return missing();
      return found(flags);
    },

    async loadCollectionLimitState({ merchantId }) {
      const rows = await runQuery(
        client
          .from("merchant_collection_limit_windows")
          .select("merchant_id,window_type,window_start,window_end,policy_timezone,limit_amount,committed_amount,reserved_amount")
          .eq("merchant_id", merchantId),
      );
      if (!rows) return queryError<CollectionLimitStateSnapshot>();
      const current = rows.filter((row) => isCurrentLimitWindow(row, (options.now ?? (() => new Date()))()));
      if (current.length !== 1) return missing<CollectionLimitStateSnapshot>();
      const limit = numberValue(current[0].limit_amount);
      const committed = numberValue(current[0].committed_amount);
      const reserved = numberValue(current[0].reserved_amount);
      if (limit === null || committed === null || reserved === null || limit <= 0) {
        return missing<CollectionLimitStateSnapshot>();
      }
      return found({
        collectionLimit: {
          basis: "cumulative",
          limitNgn: limit,
          usedNgn: committed + reserved,
          approved: true,
        },
      });
    },

    async loadPayoutReadiness({ merchantId }) {
      const account = await readDefaultPayoutAccount(client, merchantId);
      if (account.kind === "error") return queryError<PayoutReadinessSnapshot>();
      return found({ payoutAccountVerified: account.kind === "found" });
    },

    async loadProviderSettlementReadiness({ merchantId }) {
      const account = await readDefaultPayoutAccount(client, merchantId);
      if (account.kind === "error") return queryError<ProviderSettlementReadinessSnapshot>();
      if (account.kind === "missing") {
        return found({
          providerMappingReady: false,
          selectedProvider: options.provider,
          selectedEnvironment: options.environment,
          mappingProvider: null,
          mappingEnvironment: null,
        });
      }
      const rows = await runQuery(
        withLimit(
          client
            .from("merchant_provider_settlement_accounts")
            .select("settlement_account_id,provider_name,environment,status,provider_subaccount_code,provider_account_reference")
            .eq("settlement_account_id", text(account.value.id) as string)
            .eq("provider_name", options.provider)
            .eq("environment", options.environment),
          2,
        ),
      );
      if (!rows) return queryError<ProviderSettlementReadinessSnapshot>();
      if (rows.length !== 1) {
        return found({
          providerMappingReady: false,
          selectedProvider: options.provider,
          selectedEnvironment: options.environment,
          mappingProvider: null,
          mappingEnvironment: null,
        });
      }
      const mapping = rows[0];
      const mappingProvider = lowerText(mapping.provider_name) as TrustedCollectionProvider | null;
      const mappingEnvironment = lowerText(mapping.environment) as TrustedPaymentEnvironment | null;
      const active = ["connected", "active"].includes(lowerText(mapping.status) ?? "");
      const hasIdentifier = options.provider === "breet"
        ? Boolean(text(mapping.provider_account_reference) || text(mapping.provider_subaccount_code))
        : Boolean(text(mapping.provider_subaccount_code));
      return found({
        providerMappingReady:
          active && hasIdentifier && mappingProvider === options.provider && mappingEnvironment === options.environment,
        selectedProvider: options.provider,
        selectedEnvironment: options.environment,
        mappingProvider,
        mappingEnvironment,
      });
    },

    async loadOperationalState({ merchantId, workspaceId }) {
      const [merchantRows, workspaceRows] = await Promise.all([
        runQuery(
          withLimit(
            client.from("merchants").select("id,setup_mode,live_features_enabled").eq("id", merchantId),
            2,
          ),
        ),
        runQuery(
          withLimit(
            client
              .from("workspaces")
              .select("id,merchant_id,setup_mode,live_features_enabled")
              .eq("id", workspaceId)
              .eq("merchant_id", merchantId),
            2,
          ),
        ),
      ]);
      if (!merchantRows || !workspaceRows) return queryError<MerchantWorkspaceOperationalStateSnapshot>();
      if (merchantRows.length !== 1 || workspaceRows.length !== 1) {
        return missing<MerchantWorkspaceOperationalStateSnapshot>();
      }
      return found({
        merchantSetupMode: bool(merchantRows[0].setup_mode),
        workspaceSetupMode: bool(workspaceRows[0].setup_mode),
        merchantLiveFeaturesEnabled: bool(merchantRows[0].live_features_enabled),
        workspaceLiveFeaturesEnabled: bool(workspaceRows[0].live_features_enabled),
      });
    },
  };
}
