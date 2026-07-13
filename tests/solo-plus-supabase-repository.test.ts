import assert from "node:assert/strict";
import {
  createSoloPlusSupabaseRepository,
  soloPlusSupabaseRpcNames,
  SoloPlusSupabaseRepositoryError,
  type SoloPlusSupabaseClientLike,
} from "../src/lib/solo-plus/server/supabase-repository";
import type {
  SoloPlusCaseCreateAtomicInput,
  SoloPlusCaseEventRecord,
  SoloPlusCaseTransitionAtomicParams,
  SoloPlusAttachMerchantAtomicParams,
} from "../src/lib/solo-plus/repository";

type QueryResponse = {
  data: unknown;
  error: { message: string } | null;
};

class FakeQueryBuilder {
  private readonly client: FakeSupabaseClient;
  private readonly table: string;
  private filters: Array<{ type: "eq" | "in"; column: string; value: unknown }> = [];
  private orClauses: string[] = [];
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private limitCount: number | null = null;
  private pendingInsert: Record<string, unknown>[] | null = null;
  private pendingUpdate: Record<string, unknown> | null = null;

  constructor(client: FakeSupabaseClient, table: string) {
    this.client = client;
    this.table = table;
  }

  select(): FakeQueryBuilder {
    return this;
  }

  eq(column: string, value: unknown): FakeQueryBuilder {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  in(column: string, values: readonly unknown[]): FakeQueryBuilder {
    this.filters.push({ type: "in", column, value: [...values] });
    return this;
  }

  or(filters: string): FakeQueryBuilder {
    this.orClauses.push(filters);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): FakeQueryBuilder {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number): FakeQueryBuilder {
    this.limitCount = count;
    return this;
  }

  insert(value: Record<string, unknown> | readonly Record<string, unknown>[]): FakeQueryBuilder {
    this.pendingInsert = (Array.isArray(value) ? value : [value]).map((row) =>
      JSON.parse(JSON.stringify(row)) as Record<string, unknown>,
    );
    return this;
  }

  update(value: Record<string, unknown>): FakeQueryBuilder {
    this.pendingUpdate = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    return this;
  }

  async maybeSingle(): Promise<QueryResponse> {
    const rows = this.resolveRows();
    return {
      data: rows[0] ?? null,
      error: null,
    };
  }

  async single(): Promise<QueryResponse> {
    const rows = this.resolveRows();
    return {
      data: rows[0] ?? null,
      error: null,
    };
  }

  async upsert(
    value: Record<string, unknown> | readonly Record<string, unknown>[],
    options?: { onConflict?: string },
  ): Promise<QueryResponse> {
    const rows = Array.isArray(value) ? value : [value];
    const sourceRows = (this.client.tables.get(this.table) ?? []) as Record<string, unknown>[];
    const merged = sourceRows.map((row) => JSON.parse(JSON.stringify(row)) as Record<string, unknown>);
    const conflictKeys = String(options?.onConflict || "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);

    for (const row of rows) {
      const incoming = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
      const existingIndex =
        conflictKeys.length === 0
          ? merged.findIndex((candidate) => candidate.id === incoming.id)
          : merged.findIndex((candidate) =>
              conflictKeys.every((key) => candidate[key] === incoming[key]),
            );

      if (existingIndex >= 0) {
        merged[existingIndex] = { ...merged[existingIndex], ...incoming };
      } else {
        merged.push(incoming);
      }
    }

    this.client.tables.set(this.table, merged);
    return { data: null, error: null };
  }

  then<TResult1 = QueryResponse, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({
      data: this.resolveRows(),
      error: null,
    }).then(onfulfilled, onrejected);
  }

  private resolveRows(): unknown[] {
    const sourceRows = (this.client.tables.get(this.table) ?? []).map((row) =>
      JSON.parse(JSON.stringify(row)),
    );
    let rows = sourceRows.map((row) => JSON.parse(JSON.stringify(row)));

    for (const filter of this.filters) {
      rows = rows.filter((row) => {
        const value = (row as Record<string, unknown>)[filter.column];
        if (filter.type === "eq") {
          return value === filter.value;
        }

        return (filter.value as readonly unknown[]).includes(value);
      });
    }

    for (const clause of this.orClauses) {
      rows = rows.filter((row) => this.matchesOrClause(row as Record<string, unknown>, clause));
    }

    if (this.orders.length > 0) {
      rows.sort((left, right) => {
        for (const order of this.orders) {
          const leftValue = (left as Record<string, unknown>)[order.column];
          const rightValue = (right as Record<string, unknown>)[order.column];
          if (leftValue === rightValue) {
            continue;
          }
          if (leftValue == null) {
            return order.ascending ? -1 : 1;
          }
          if (rightValue == null) {
            return order.ascending ? 1 : -1;
          }
          return leftValue < rightValue
            ? (order.ascending ? -1 : 1)
            : (order.ascending ? 1 : -1);
        }

        return 0;
      });
    }

    if (this.limitCount != null) {
      rows = rows.slice(0, this.limitCount);
    }

    if (this.pendingUpdate) {
      const mergedSource = sourceRows.map((row) => JSON.parse(JSON.stringify(row)));
      const updatedRows: unknown[] = [];

      for (let index = 0; index < mergedSource.length; index += 1) {
        const candidate = mergedSource[index] as Record<string, unknown>;
        const shouldUpdate = rows.some((row) => (row as Record<string, unknown>).id === candidate.id);
        if (!shouldUpdate) {
          continue;
        }

        mergedSource[index] = {
          ...candidate,
          ...this.pendingUpdate,
        };
        updatedRows.push(JSON.parse(JSON.stringify(mergedSource[index])));
      }

      this.client.tables.set(this.table, mergedSource);
      rows = updatedRows;
    }

    if (this.pendingInsert) {
      const mergedSource = sourceRows.map((row) => JSON.parse(JSON.stringify(row)));
      for (const row of this.pendingInsert) {
        mergedSource.push(JSON.parse(JSON.stringify(row)));
      }
      this.client.tables.set(this.table, mergedSource);
      rows = this.pendingInsert.map((row) => JSON.parse(JSON.stringify(row)));
    }

    return rows;
  }

  private matchesOrClause(row: Record<string, unknown>, clause: string): boolean {
    if (clause.includes(".ilike.")) {
      return clause.split(",").some((entry) => {
        const match = /^([a-z_]+)\.ilike\.%(.*)%$/i.exec(entry.trim());
        if (!match) {
          return false;
        }

        const column = match[1];
        const needle = match[2].toLowerCase();
        const value = row[column];
        return typeof value === "string" && value.toLowerCase().includes(needle);
      });
    }

    const cursorMatch = /^([a-z_]+)\.lt\.([^,]+),and\(\1\.eq\.([^,]+),id\.lt\.([^)]+)\)$/i.exec(
      clause,
    );
    if (cursorMatch) {
      const column = cursorMatch[1];
      const lessThanValue = cursorMatch[2];
      const equalValue = cursorMatch[3];
      const idLessThan = cursorMatch[4];
      const rawValue = row[column];
      const idValue = row.id;
      return (
        (typeof rawValue === "string" && rawValue < lessThanValue) ||
        (rawValue === equalValue && typeof idValue === "string" && idValue < idLessThan)
      );
    }

    return false;
  }
}

class FakeSupabaseClient implements SoloPlusSupabaseClientLike {
  readonly tables = new Map<string, unknown[]>();
  readonly rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  readonly rpcResponses = new Map<string, QueryResponse>();

  from(table: string) {
    return new FakeQueryBuilder(this, table) as unknown as ReturnType<
      SoloPlusSupabaseClientLike["from"]
    >;
  }

  async rpc(name: string, args: Record<string, unknown>): Promise<QueryResponse> {
    this.rpcCalls.push({
      name,
      args: JSON.parse(JSON.stringify(args)),
    });

    return this.rpcResponses.get(name) ?? { data: null, error: null };
  }
}

function buildCaseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    merchant_id: "22222222-2222-4222-8222-222222222222",
    onboarding_session_id: null,
    flow_origin: "upgrade",
    source_plan: "solo_lite",
    target_plan: "solo_plus",
    case_status: "draft",
    payment_status: "pending",
    refund_status: "none",
    payment_record_id: null,
    payment_provider: null,
    payment_reference: null,
    expected_amount: "13000.50",
    payment_currency: "NGN",
    requirements_policy_version: "solo-plus-policy-v1",
    requirements_snapshot: { policy: "safe" },
    active_plan_snapshot: "solo_lite",
    rejection_reason: null,
    approved_at: null,
    approved_by_admin_id: null,
    rejected_at: null,
    rejected_by_admin_id: null,
    reopened_at: null,
    reopened_by_admin_id: null,
    idempotency_key: "idem-1",
    activation_idempotency_key: null,
    refund_idempotency_key: null,
    row_version: 0,
    audit_metadata: {},
    created_at: "2026-07-05T10:00:00.000Z",
    updated_at: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function buildRequirementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    case_id: "11111111-1111-4111-8111-111111111111",
    requirement_code: "bvn",
    requirement_state: "not_started",
    verification_log_id: null,
    evidence_source_type: null,
    evidence_source_id: null,
    evidence_reference: null,
    original_completed_at: null,
    reuse_decision_at: null,
    reuse_reason: null,
    policy_rule_applied: null,
    reviewed_by_admin_id: null,
    review_note: null,
    provider_name: null,
    provider_reference: null,
    failure_reason: null,
    completed_at: null,
    metadata: {},
    created_at: "2026-07-05T10:00:00.000Z",
    updated_at: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function buildEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    case_id: "11111111-1111-4111-8111-111111111111",
    event_type: "case_created",
    previous_state: {},
    new_state: {
      flowOrigin: "upgrade",
      targetPlan: "solo_plus",
    },
    actor_type: "merchant",
    actor_id: "55555555-5555-4555-8555-555555555555",
    request_idempotency_key: null,
    reason: "created",
    policy_version: "solo-plus-policy-v1",
    created_at: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function buildActivationMerchantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    subscription_plan: "solo_plus",
    merchant_tier: "individual",
    monthly_collection_limit: 5000000,
    setup_mode: false,
    live_features_enabled: true,
    live_features_activated_at: "2026-07-11T00:00:00.000Z",
    onboarding_status: "active",
    workspace_id: "77777777-7777-4777-8777-777777777777",
    verification_status: "verified",
    updated_at: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function buildActivationWorkspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    merchant_id: "66666666-6666-4666-8666-666666666666",
    owner_user_id: "55555555-5555-4555-8555-555555555555",
    workspace_type: "personal",
    display_name: "Solo Plus Workspace",
    plan_type: "solo_plus",
    onboarding_status: "active",
    setup_mode: false,
    live_features_enabled: true,
    updated_at: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function buildActivationWorkspaceSubscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    workspace_id: "77777777-7777-4777-8777-777777777777",
    merchant_id: "66666666-6666-4666-8666-666666666666",
    plan_type: "solo_plus",
    subscription_status: "active",
    payment_reference: "activation-payment-ref",
    amount_paid: "13000.00",
    period_start: "2026-07-11T00:00:00.000Z",
    period_end: null,
    updated_at: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function buildCreateInput(): SoloPlusCaseCreateAtomicInput {
  const caseRecord = buildCaseRow();
  return {
    intent: {
      flowOrigin: "upgrade",
      merchantId: caseRecord.merchant_id as string,
      onboardingSessionId: null,
      sourcePlan: "solo_lite",
      targetPlan: "solo_plus",
      expectedAmount: "13000.50",
      paymentCurrency: "NGN",
      requirementsPolicyVersion: "solo-plus-policy-v1",
      requirementsSnapshot: { policy: "safe" },
      activePlanSnapshot: "solo_lite",
    },
    caseRecord: {
      id: caseRecord.id as string,
      merchantId: caseRecord.merchant_id as string,
      onboardingSessionId: null,
      flowOrigin: "upgrade",
      sourcePlan: "solo_lite",
      targetPlan: "solo_plus",
      caseStatus: "draft",
      paymentStatus: "pending",
      refundStatus: "none",
      paymentRecordId: null,
      paymentProvider: null,
      paymentReference: null,
      expectedAmount: "13000.50",
      paymentCurrency: "NGN",
      requirementsPolicyVersion: "solo-plus-policy-v1",
      requirementsSnapshot: { policy: "safe" },
      activePlanSnapshot: "solo_lite",
      rejectionReason: null,
      approvedAt: null,
      approvedByAdminId: null,
      rejectedAt: null,
      rejectedByAdminId: null,
      reopenedAt: null,
      reopenedByAdminId: null,
      idempotencyKey: "idem-1",
      activationIdempotencyKey: null,
      refundIdempotencyKey: null,
      rowVersion: 0,
      auditMetadata: {},
      createdAt: "2026-07-05T10:00:00.000Z",
      updatedAt: "2026-07-05T10:00:00.000Z",
    },
    requirements: [],
    event: {
      id: "event-1",
      caseId: caseRecord.id as string,
      eventType: "case_created",
      previousState: {},
      newState: {
        accessMode: "public",
      },
      actorType: "merchant",
      actorId: "55555555-5555-4555-8555-555555555555",
      requestIdempotencyKey: null,
      reason: "created",
      policyVersion: "solo-plus-policy-v1",
      createdAt: "2026-07-05T10:00:00.000Z",
    },
  };
}

function buildAttachInput(): SoloPlusAttachMerchantAtomicParams {
  const event: SoloPlusCaseEventRecord = {
    id: "44444444-4444-4444-8444-444444444444",
    caseId: "11111111-1111-4111-8111-111111111111",
    eventType: "merchant_attached",
    previousState: {},
    newState: {},
    actorType: "merchant",
    actorId: "55555555-5555-4555-8555-555555555555",
    requestIdempotencyKey: "attach-idem-1",
    reason: "attach",
    policyVersion: "solo-plus-policy-v1",
    createdAt: "2026-07-05T10:00:00.000Z",
  };

  return {
    caseId: event.caseId,
    onboardingSessionId: "66666666-6666-4666-8666-666666666666",
    merchantId: "22222222-2222-4222-8222-222222222222",
    expectedRowVersion: 0,
    requestIdempotencyKey: "attach-idem-1",
    event,
  };
}

function buildTransitionInput(): SoloPlusCaseTransitionAtomicParams {
  const event: SoloPlusCaseEventRecord = {
    id: "77777777-7777-4777-8777-777777777777",
    caseId: "11111111-1111-4111-8111-111111111111",
    eventType: "case_marked_awaiting_payment",
    previousState: {},
    newState: {},
    actorType: "merchant",
    actorId: "55555555-5555-4555-8555-555555555555",
    requestIdempotencyKey: "await-idem-1",
    reason: "await",
    policyVersion: "solo-plus-policy-v1",
    createdAt: "2026-07-05T10:00:00.000Z",
  };

  return {
    caseId: event.caseId,
    expectedRowVersion: 0,
    expectedCurrentStatus: "draft",
    targetStatus: "awaiting_payment",
    requestIdempotencyKey: "await-idem-1",
    patch: {
      caseStatus: "awaiting_payment",
      paymentStatus: "pending",
      paymentProvider: null,
      paymentReference: null,
      paymentRecordId: null,
    },
    event,
  };
}

async function run() {
  const client = new FakeSupabaseClient();
  const repository = createSoloPlusSupabaseRepository({ client });

  client.tables.set("solo_plus_cases", [buildCaseRow()]);
  client.tables.set("solo_plus_case_requirements", [buildRequirementRow()]);
  client.tables.set("solo_plus_case_events", [buildEventRow()]);
  client.rpcResponses.set(soloPlusSupabaseRpcNames.caseBundlePayload, {
    data: {
      case: buildCaseRow(),
      requirements: [buildRequirementRow()],
      created_event: buildEventRow(),
    },
    error: null,
  });

  const mappedCase = await repository.findCaseById(
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(mappedCase?.expectedAmount, "13000.50");
  assert.equal(mappedCase?.caseStatus, "draft");
  assert.equal(mappedCase?.createdAt, "2026-07-05T10:00:00.000Z");
  assert.equal(mappedCase?.approvedByAdminId, null);
  assert.deepEqual(mappedCase?.auditMetadata, {});

  const mappedByIdempotencyKey = await repository.findCaseByIdempotencyKey("idem-1");
  assert.equal(mappedByIdempotencyKey?.expectedAmount, "13000.50");
  assert.equal(mappedByIdempotencyKey?.refundStatus, "none");

  const mappedByMerchant = await repository.findActiveCaseByMerchantId(
    "22222222-2222-4222-8222-222222222222",
  );
  assert.equal(mappedByMerchant?.expectedAmount, "13000.50");
  assert.equal(mappedByMerchant?.merchantId, "22222222-2222-4222-8222-222222222222");

  client.tables.set("solo_plus_cases", [
    buildCaseRow({
      flow_origin: "onboarding",
      merchant_id: null,
      onboarding_session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      source_plan: null,
    }),
  ]);
  client.rpcResponses.set(soloPlusSupabaseRpcNames.caseBundlePayload, {
    data: {
      case: buildCaseRow({
        flow_origin: "onboarding",
        merchant_id: null,
        onboarding_session_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        source_plan: null,
      }),
      requirements: [buildRequirementRow()],
      created_event: buildEventRow(),
    },
    error: null,
  });
  const mappedBySession = await repository.findActiveCaseByOnboardingSessionId(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  assert.equal(mappedBySession?.expectedAmount, "13000.50");
  assert.equal(mappedBySession?.flowOrigin, "onboarding");

  client.tables.set("solo_plus_cases", [buildCaseRow()]);
  client.rpcResponses.set(soloPlusSupabaseRpcNames.caseBundlePayload, {
    data: {
      case: buildCaseRow(),
      requirements: [buildRequirementRow()],
      created_event: buildEventRow(),
    },
    error: null,
  });

  const mappedRequirement = await repository.listRequirements(
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(mappedRequirement.length, 1);
  assert.equal(mappedRequirement[0].requirementCode, "bvn");

  const mappedEvents = await repository.listSafeEvents(
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(mappedEvents.length, 1);
  assert.equal(mappedEvents[0].eventType, "case_created");

  client.tables.set("merchants", [
    {
      id: "22222222-2222-4222-8222-222222222222",
      business_name: "Acme Retail",
      owner_name: "Ada Owner",
      email: "owner@example.test",
      subscription_plan: "solo_lite",
    },
  ]);
  client.tables.set("solo_plus_cases", [
    buildCaseRow({
      id: "11111111-1111-4111-8111-111111111111",
      merchant_id: "22222222-2222-4222-8222-222222222222",
      case_status: "verification_pending",
      payment_status: "paid",
      updated_at: "2026-07-12T01:00:00.000Z",
      created_at: "2026-07-10T00:00:00.000Z",
      row_version: 6,
    }),
    buildCaseRow({
      id: "99999999-9999-4999-8999-999999999999",
      merchant_id: "22222222-2222-4222-8222-222222222222",
      case_status: "manual_review",
      payment_status: "paid",
      updated_at: "2026-07-12T01:00:00.000Z",
      created_at: "2026-07-09T00:00:00.000Z",
      row_version: 5,
    }),
  ]);
  client.tables.set("solo_plus_case_requirements", [
    buildRequirementRow({
      case_id: "11111111-1111-4111-8111-111111111111",
      requirement_code: "bvn",
      requirement_state: "passed",
    }),
    buildRequirementRow({
      id: "55555555-5555-4555-8555-555555555555",
      case_id: "11111111-1111-4111-8111-111111111111",
      requirement_code: "proof_of_address",
      requirement_state: "failed",
      evidence_source_type: "merchant_document",
      evidence_reference: "kyc-documents/proof.pdf",
      metadata: {
        uploadedAt: "2026-07-12T04:00:00.000Z",
        contentType: "application/pdf",
        fileSizeBytes: 2048,
        storageKey: "kyc-documents/proof.pdf",
      },
    }),
  ]);
  client.tables.set("solo_plus_case_events", [
    buildEventRow({
      case_id: "11111111-1111-4111-8111-111111111111",
      event_type: "case_review_requested_more_information",
      reason: "Need updated address document.",
      created_at: "2026-07-12T02:00:00.000Z",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actor_type: "admin",
      actor_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
    buildEventRow({
      case_id: "11111111-1111-4111-8111-111111111111",
      event_type: "case_created",
      created_at: "2026-07-10T00:00:00.000Z",
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    }),
    buildEventRow({
      case_id: "99999999-9999-4999-8999-999999999999",
      event_type: "case_approved",
      created_at: "2026-07-11T00:00:00.000Z",
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      actor_type: "admin",
      actor_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
  ]);

  const adminQueue = await repository.listAdminCases({
    caseStatus: "verification_pending",
    flowOrigin: null,
    paymentStatus: "paid",
    refundStatus: null,
    merchantSearch: "Acme",
    cursor: null,
    limit: 1,
  });
  assert.equal(adminQueue.items.length, 1);
  assert.equal(adminQueue.items[0].merchant?.businessName, "Acme Retail");
  assert.equal(adminQueue.items[0].requirements.length, 2);
  assert.equal(
    adminQueue.items[0].latestReviewDecisionEvent?.eventType,
    "case_review_requested_more_information",
  );
  assert.equal(adminQueue.nextCursor, null);

  const adminQueueNextPage = await repository.listAdminCases({
    caseStatus: null,
    flowOrigin: null,
    paymentStatus: "paid",
    refundStatus: null,
    merchantSearch: null,
    cursor: {
      updatedAt: "2026-07-12T01:00:00.000Z",
      caseId: "99999999-9999-4999-8999-999999999999",
    },
    limit: 10,
  });
  assert.equal(adminQueueNextPage.items.length, 1);
  assert.equal(
    adminQueueNextPage.items[0].caseRecord.id,
    "11111111-1111-4111-8111-111111111111",
  );

  const adminDetail = await repository.getAdminCaseDetail(
    "11111111-1111-4111-8111-111111111111",
  );
  assert.equal(adminDetail?.merchant?.email, "owner@example.test");
  assert.equal(adminDetail?.requirements[1]?.evidenceReference, "kyc-documents/proof.pdf");
  assert.equal(
    adminDetail?.latestReviewDecisionEvent?.eventType,
    "case_review_requested_more_information",
  );

  const adminEvents = await repository.listAdminCaseEvents(
    "11111111-1111-4111-8111-111111111111",
    {
      cursor: null,
      limit: 1,
    },
  );
  assert.equal(adminEvents.items.length, 1);
  assert.equal(adminEvents.items[0].eventType, "case_review_requested_more_information");
  assert.deepEqual(adminEvents.nextCursor, {
    createdAt: "2026-07-12T02:00:00.000Z",
    eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });

  const upsertedRequirements = await repository.upsertCaseRequirements(
    "11111111-1111-4111-8111-111111111111",
    [
      {
        ...mappedRequirement[0],
        requirementState: "reused",
        evidenceSourceType: "verification_log",
        verificationLogId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        evidenceReference: "verification-log-1",
        policyRuleApplied: "reuse_bvn_v1",
        reuseDecisionAt: "2026-07-05T12:00:00.000Z",
        reuseReason: "Eligible under reuse_bvn_v1.",
        completedAt: "2026-07-05T12:00:00.000Z",
        metadata: {
          provenance: {
            evaluatorOutcome: "reusable",
          },
        },
        updatedAt: "2026-07-05T12:00:00.000Z",
      },
    ],
  );
  assert.equal(upsertedRequirements[0]?.requirementState, "reused");
  assert.equal(
    (client.tables.get("solo_plus_case_requirements")?.[0] as Record<string, unknown>)?.policy_rule_applied,
    "reuse_bvn_v1",
  );

  client.tables.set("solo_plus_cases", [buildCaseRow({ case_status: "not_real" })]);
  client.rpcResponses.set(soloPlusSupabaseRpcNames.caseBundlePayload, {
    data: {
      case: buildCaseRow({ case_status: "not_real" }),
      requirements: [buildRequirementRow()],
      created_event: buildEventRow(),
    },
    error: null,
  });
  await assert.rejects(
    async () => repository.findCaseById("11111111-1111-4111-8111-111111111111"),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusSupabaseRepositoryError);
      assert.equal(error.code, "SOLO_PLUS_REPOSITORY_MAPPING_ERROR");
      return true;
    },
  );

  client.tables.set("solo_plus_cases", [buildCaseRow({ created_at: "not-a-date" })]);
  client.rpcResponses.set(soloPlusSupabaseRpcNames.caseBundlePayload, {
    data: {
      case: buildCaseRow({ created_at: "not-a-date" }),
      requirements: [buildRequirementRow()],
      created_event: buildEventRow(),
    },
    error: null,
  });
  await assert.rejects(
    async () => repository.findCaseById("11111111-1111-4111-8111-111111111111"),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusSupabaseRepositoryError);
      assert.equal(error.code, "SOLO_PLUS_REPOSITORY_MAPPING_ERROR");
      return true;
    },
  );

  client.tables.set("solo_plus_cases", [buildCaseRow({ row_version: -1 })]);
  client.rpcResponses.set(soloPlusSupabaseRpcNames.caseBundlePayload, {
    data: {
      case: buildCaseRow({ row_version: -1 }),
      requirements: [buildRequirementRow()],
      created_event: buildEventRow(),
    },
    error: null,
  });
  await assert.rejects(
    async () => repository.findCaseById("11111111-1111-4111-8111-111111111111"),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusSupabaseRepositoryError);
      return true;
    },
  );

  client.tables.set("solo_plus_cases", [buildCaseRow({ requirements_snapshot: [] })]);
  client.rpcResponses.set(soloPlusSupabaseRpcNames.caseBundlePayload, {
    data: {
      case: buildCaseRow({ requirements_snapshot: [] }),
      requirements: [buildRequirementRow()],
      created_event: buildEventRow(),
    },
    error: null,
  });
  await assert.rejects(
    async () => repository.findCaseById("11111111-1111-4111-8111-111111111111"),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusSupabaseRepositoryError);
      return true;
    },
  );

  client.tables.set("solo_plus_cases", [buildCaseRow({ expected_amount: "oops" })]);
  client.rpcResponses.set(soloPlusSupabaseRpcNames.caseBundlePayload, {
    data: {
      case: buildCaseRow({ expected_amount: "oops" }),
      requirements: [buildRequirementRow()],
      created_event: buildEventRow(),
    },
    error: null,
  });
  await assert.rejects(
    async () => repository.findCaseById("11111111-1111-4111-8111-111111111111"),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusSupabaseRepositoryError);
      return true;
    },
  );

  client.tables.set("solo_plus_cases", [buildCaseRow({ expected_amount: "9999999999999999.99" })]);
  client.rpcResponses.set(soloPlusSupabaseRpcNames.caseBundlePayload, {
    data: {
      case: buildCaseRow({ expected_amount: "9999999999999999.99" }),
      requirements: [buildRequirementRow()],
      created_event: buildEventRow(),
    },
    error: null,
  });
  const mappedBoundaryCase = await repository.findCaseById("11111111-1111-4111-8111-111111111111");
  assert.equal(mappedBoundaryCase?.expectedAmount, "9999999999999999.99");

  client.tables.set("solo_plus_cases", [buildCaseRow({ expected_amount: 13000.5 })]);
  await assert.rejects(
    async () => repository.findCaseById("11111111-1111-4111-8111-111111111111"),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusSupabaseRepositoryError);
      return true;
    },
  );

  client.tables.set("solo_plus_cases", [buildCaseRow()]);
  client.rpcResponses.set(soloPlusSupabaseRpcNames.caseBundlePayload, {
    data: {
      case: buildCaseRow(),
      requirements: [buildRequirementRow()],
      created_event: buildEventRow(),
    },
    error: null,
  });

  client.rpcResponses.set(soloPlusSupabaseRpcNames.createCaseBundle, {
    data: {
      kind: "created",
      case: buildCaseRow(),
      requirements: [buildRequirementRow()],
      event: buildEventRow(),
    },
    error: null,
  });
  const createResult = await repository.createCaseWithRequirementsAndEvent(buildCreateInput());
  assert.equal(createResult.kind, "created");
  assert.equal(client.rpcCalls.at(-1)?.name, soloPlusSupabaseRpcNames.createCaseBundle);
  assert.equal(typeof client.rpcCalls.at(-1)?.args.p_expected_amount, "string");

  client.rpcResponses.set(soloPlusSupabaseRpcNames.createCaseBundle, {
    data: {
      kind: "idempotent_replay",
      case: buildCaseRow(),
    },
    error: null,
  });
  const createReplay = await repository.createCaseWithRequirementsAndEvent(buildCreateInput());
  assert.equal(createReplay.kind, "idempotent_replay");

  client.rpcResponses.set(soloPlusSupabaseRpcNames.createCaseBundle, {
    data: {
      kind: "existing_active_case",
      case: buildCaseRow(),
    },
    error: null,
  });
  const existingActive = await repository.createCaseWithRequirementsAndEvent(buildCreateInput());
  assert.equal(existingActive.kind, "existing_active_case");

  client.rpcResponses.set(soloPlusSupabaseRpcNames.createCaseBundle, {
    data: {
      kind: "idempotency_conflict",
      case: buildCaseRow(),
    },
    error: null,
  });
  const createIdemConflict = await repository.createCaseWithRequirementsAndEvent(buildCreateInput());
  assert.equal(createIdemConflict.kind, "idempotency_conflict");

  client.rpcResponses.set(soloPlusSupabaseRpcNames.createCaseBundle, {
    data: {
      kind: "active_case_conflict",
      case: buildCaseRow(),
    },
    error: null,
  });
  const createActiveConflict = await repository.createCaseWithRequirementsAndEvent(buildCreateInput());
  assert.equal(createActiveConflict.kind, "active_case_conflict");

  client.rpcResponses.set(soloPlusSupabaseRpcNames.attachOnboardingMerchant, {
    data: {
      kind: "updated",
      case: buildCaseRow({ merchant_id: "22222222-2222-4222-8222-222222222222", row_version: 1 }),
      event: buildEventRow({ event_type: "merchant_attached" }),
    },
    error: null,
  });
  const attachUpdated = await repository.attachMerchantToOnboardingCase(buildAttachInput());
  assert.equal(attachUpdated.kind, "updated");
  assert.equal(client.rpcCalls.at(-1)?.name, soloPlusSupabaseRpcNames.attachOnboardingMerchant);

  for (const kind of [
    "idempotent_replay",
    "not_found",
    "idempotency_conflict",
    "active_case_conflict",
    "version_conflict",
    "state_conflict",
    "ownership_conflict",
  ] as const) {
    client.rpcResponses.set(soloPlusSupabaseRpcNames.attachOnboardingMerchant, {
      data:
        kind === "not_found"
          ? { kind }
          : { kind, case: buildCaseRow(), event: kind === "idempotent_replay" ? buildEventRow() : undefined },
      error: null,
    });

    const result = await repository.attachMerchantToOnboardingCase(buildAttachInput());
    assert.equal(result.kind, kind);
  }

  client.rpcResponses.set(soloPlusSupabaseRpcNames.markAwaitingPayment, {
    data: {
      kind: "updated",
      case: buildCaseRow({ case_status: "awaiting_payment", row_version: 1 }),
      event: buildEventRow({ event_type: "case_marked_awaiting_payment" }),
    },
    error: null,
  });
  const transitionUpdated = await repository.transitionCaseStatus(buildTransitionInput());
  assert.equal(transitionUpdated.kind, "updated");
  assert.equal(client.rpcCalls.at(-1)?.name, soloPlusSupabaseRpcNames.markAwaitingPayment);

  for (const kind of [
    "idempotent_replay",
    "not_found",
    "idempotency_conflict",
    "version_conflict",
    "state_conflict",
  ] as const) {
    client.rpcResponses.set(soloPlusSupabaseRpcNames.markAwaitingPayment, {
      data:
        kind === "not_found"
          ? { kind }
          : { kind, case: buildCaseRow({ case_status: kind === "state_conflict" ? "verification_pending" : "awaiting_payment" }), event: kind === "idempotent_replay" ? buildEventRow() : undefined },
      error: null,
    });

    const result = await repository.transitionCaseStatus(buildTransitionInput());
    assert.equal(result.kind, kind);
  }

  client.rpcResponses.set(soloPlusSupabaseRpcNames.reviewCase, {
    data: {
      kind: "updated",
      case: buildCaseRow({
        case_status: "rejected",
        payment_status: "paid",
        refund_status: "review_required",
        row_version: 5,
        rejected_at: "2026-07-08T00:00:00.000Z",
        rejected_by_admin_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        rejection_reason: "missing documents",
      }),
      event: buildEventRow({
        event_type: "case_rejected",
        actor_type: "admin",
        actor_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        request_idempotency_key: "reject-idem-1",
        reason: "missing documents",
        created_at: "2026-07-08T00:00:00.000Z",
      }),
    },
    error: null,
  });
  const rejectTransition = await repository.transitionCaseStatus({
    caseId: "11111111-1111-4111-8111-111111111111",
    expectedRowVersion: 4,
    expectedCurrentStatus: "manual_review",
    targetStatus: "rejected",
    requestIdempotencyKey: "reject-idem-1",
    patch: {
      caseStatus: "rejected",
      refundStatus: "review_required",
      rejectionReason: "missing documents",
      rejectedAt: "2026-07-08T00:00:00.000Z",
      rejectedByAdminId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    event: {
      id: "88888888-8888-4888-8888-888888888888",
      caseId: "11111111-1111-4111-8111-111111111111",
      eventType: "case_rejected",
      previousState: { caseStatus: "manual_review" },
      newState: { caseStatus: "rejected", refundStatus: "review_required" },
      actorType: "admin",
      actorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      requestIdempotencyKey: "reject-idem-1",
      reason: "missing documents",
      policyVersion: "solo-plus-policy-v1",
      createdAt: "2026-07-08T00:00:00.000Z",
    },
  });
  assert.equal(rejectTransition.kind, "updated");
  assert.equal(rejectTransition.caseRecord.caseStatus, "rejected");
  assert.equal(rejectTransition.caseRecord.rejectedByAdminId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(rejectTransition.caseRecord.refundStatus, "review_required");
  assert.equal(client.rpcCalls.at(-1)?.name, soloPlusSupabaseRpcNames.reviewCase);

  client.rpcResponses.set(soloPlusSupabaseRpcNames.reviewCase, {
    data: {
      kind: "idempotent_replay",
      case: buildCaseRow({
        case_status: "rejected",
        payment_status: "paid",
        refund_status: "review_required",
        row_version: 5,
      }),
      event: buildEventRow({
        event_type: "case_rejected",
        actor_type: "admin",
        actor_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        request_idempotency_key: "reject-idem-1",
        reason: "missing documents",
      }),
    },
    error: null,
  });
  const rejectReplay = await repository.transitionCaseStatus({
    caseId: "11111111-1111-4111-8111-111111111111",
    expectedRowVersion: 4,
    expectedCurrentStatus: "manual_review",
    targetStatus: "rejected",
    requestIdempotencyKey: "reject-idem-1",
    patch: {
      caseStatus: "rejected",
      refundStatus: "review_required",
      rejectionReason: "missing documents",
      rejectedAt: "2026-07-08T00:00:00.000Z",
      rejectedByAdminId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    event: {
      id: "99999999-9999-4999-8999-999999999999",
      caseId: "11111111-1111-4111-8111-111111111111",
      eventType: "case_rejected",
      previousState: { caseStatus: "manual_review" },
      newState: { caseStatus: "rejected", refundStatus: "review_required" },
      actorType: "admin",
      actorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      requestIdempotencyKey: "reject-idem-1",
      reason: "missing documents",
      policyVersion: "solo-plus-policy-v1",
      createdAt: "2026-07-08T00:00:01.000Z",
    },
  });
  assert.equal(rejectReplay.kind, "idempotent_replay");

  client.rpcResponses.set(soloPlusSupabaseRpcNames.reviewCase, {
    data: {
      kind: "idempotency_conflict",
      case: buildCaseRow({
        case_status: "rejected",
        payment_status: "paid",
        refund_status: "review_required",
        row_version: 5,
      }),
    },
    error: null,
  });
  const rejectConflict = await repository.transitionCaseStatus({
    caseId: "11111111-1111-4111-8111-111111111111",
    expectedRowVersion: 4,
    expectedCurrentStatus: "manual_review",
    targetStatus: "approved",
    requestIdempotencyKey: "reject-idem-1",
    patch: {
      caseStatus: "approved",
      approvedAt: "2026-07-08T00:00:02.000Z",
      approvedByAdminId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      refundStatus: "none",
    },
    event: {
      id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      caseId: "11111111-1111-4111-8111-111111111111",
      eventType: "case_approved",
      previousState: { caseStatus: "manual_review" },
      newState: { caseStatus: "approved" },
      actorType: "admin",
      actorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      requestIdempotencyKey: "reject-idem-1",
      reason: "conflict",
      policyVersion: "solo-plus-policy-v1",
      createdAt: "2026-07-08T00:00:02.000Z",
    },
  });
  assert.equal(rejectConflict.kind, "idempotency_conflict");

  client.rpcResponses.set(soloPlusSupabaseRpcNames.createCaseBundle, {
    data: null,
    error: { message: "rpc failed with internal details" },
  });
  await assert.rejects(
    async () => repository.createCaseWithRequirementsAndEvent(buildCreateInput()),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusSupabaseRepositoryError);
      assert.equal(error.code, "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE");
      assert.equal(error.message.includes("internal details"), true);
      assert.equal(error.message.includes('"kind"'), false);
      return true;
    },
  );

  const createInput = buildCreateInput();
  const beforeCreateInput = JSON.stringify(createInput);
  client.rpcResponses.set(soloPlusSupabaseRpcNames.createCaseBundle, {
    data: {
      kind: "created",
      case: buildCaseRow(),
      requirements: [buildRequirementRow()],
      event: buildEventRow(),
    },
    error: null,
  });
  await repository.createCaseWithRequirementsAndEvent(createInput);
  assert.equal(JSON.stringify(createInput), beforeCreateInput);

  client.rpcResponses.set(soloPlusSupabaseRpcNames.activateCase, {
    data: {
      kind: "applied",
      case: buildCaseRow({
        case_status: "approved",
        payment_status: "paid",
        activation_idempotency_key: "activation-idem-1",
        row_version: 8,
      }),
      event: buildEventRow({
        event_type: "case_activated",
        actor_type: "admin",
        actor_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        request_idempotency_key: "activation-idem-1",
        reason: "Solo Plus activation completed.",
        created_at: "2026-07-11T00:00:00.000Z",
      }),
      merchant: buildActivationMerchantRow(),
      workspace: buildActivationWorkspaceRow(),
      workspace_subscription: buildActivationWorkspaceSubscriptionRow(),
    },
    error: null,
  });
  const activationApplied = await repository.activateSoloPlusCase({
    caseId: "11111111-1111-4111-8111-111111111111",
    expectedRowVersion: 7,
    requestIdempotencyKey: "activation-idem-1",
    activatorAdminId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    policyVersion: "solo-plus-activation-policy-v1",
  });
  assert.equal(activationApplied.kind, "applied");
  assert.equal(client.rpcCalls.at(-1)?.name, soloPlusSupabaseRpcNames.activateCase);
  assert.deepEqual(client.rpcCalls.at(-1)?.args, {
    p_case_id: "11111111-1111-4111-8111-111111111111",
    p_expected_row_version: 7,
    p_request_idempotency_key: "activation-idem-1",
    p_activator_admin_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    p_policy_version: "solo-plus-activation-policy-v1",
  });

  client.rpcResponses.set(soloPlusSupabaseRpcNames.activateCase, {
    data: {
      kind: "idempotent_replay",
      case: buildCaseRow({
        case_status: "approved",
        payment_status: "paid",
        activation_idempotency_key: "activation-idem-1",
        row_version: 8,
      }),
      event: buildEventRow({
        event_type: "case_activated",
        actor_type: "admin",
        actor_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        request_idempotency_key: "activation-idem-1",
      }),
      merchant: buildActivationMerchantRow(),
      workspace: buildActivationWorkspaceRow(),
      workspace_subscription: buildActivationWorkspaceSubscriptionRow(),
    },
    error: null,
  });
  const activationReplay = await repository.activateSoloPlusCase({
    caseId: "11111111-1111-4111-8111-111111111111",
    expectedRowVersion: 7,
    requestIdempotencyKey: "activation-idem-1",
    activatorAdminId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    policyVersion: null,
  });
  assert.equal(activationReplay.kind, "idempotent_replay");

  client.rpcResponses.set(soloPlusSupabaseRpcNames.activateCase, {
    data: {
      kind: "applied",
      case: buildCaseRow({
        case_status: "approved",
        payment_status: "paid",
        activation_idempotency_key: "activation-idem-2",
        row_version: 9,
      }),
      merchant: buildActivationMerchantRow(),
      workspace: buildActivationWorkspaceRow(),
      workspace_subscription: buildActivationWorkspaceSubscriptionRow(),
    },
    error: null,
  });
  await assert.rejects(
    async () =>
      repository.activateSoloPlusCase({
        caseId: "11111111-1111-4111-8111-111111111111",
        expectedRowVersion: 8,
        requestIdempotencyKey: "activation-idem-2",
        activatorAdminId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        policyVersion: "solo-plus-activation-policy-v1",
      }),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusSupabaseRepositoryError);
      assert.equal(error.code, "SOLO_PLUS_REPOSITORY_MAPPING_ERROR");
      return true;
    },
  );

  await assert.rejects(
    async () =>
      repository.activateSoloPlusCase({
        caseId: "11111111-1111-4111-8111-111111111111",
        expectedRowVersion: Number.MAX_SAFE_INTEGER + 1,
        requestIdempotencyKey: "activation-idem-overflow",
        activatorAdminId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        policyVersion: "solo-plus-activation-policy-v1",
      }),
    (error: unknown) => {
      assert.ok(error instanceof SoloPlusSupabaseRepositoryError);
      assert.equal(error.code, "SOLO_PLUS_ATOMIC_PERSISTENCE_UNAVAILABLE");
      return true;
    },
  );

  console.log("solo-plus-supabase-repository.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
