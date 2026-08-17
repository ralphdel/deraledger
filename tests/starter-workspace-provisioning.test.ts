import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  provisionStarterSignup,
  repairAuthenticatedStarterWorkspace,
  type StarterAuthAdmin,
  type StarterAuthUser,
  type StarterMerchantRecord,
  type StarterWorkspaceRepository,
} from "../src/lib/services/starter-workspace.service";
import {
  isRecoverableStarterUser,
  requestStarterWorkspaceRecovery,
} from "../src/lib/starter-workspace-recovery";

const starterUser: StarterAuthUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "starter@example.test",
  user_metadata: {
    plan: "starter",
    business_name: "Starter Limited",
  },
};

class MemoryStarterRepository implements StarterWorkspaceRepository {
  merchants: StarterMerchantRecord[] = [];
  insertCount = 0;
  workspaceEnsureCount = 0;
  ownerMembershipEnsureCount = 0;
  lastInsert: Record<string, unknown> | null = null;
  lastUpdate: Record<string, unknown> | null = null;

  async findMerchantByUserId(userId: string) {
    return this.merchants.find((merchant) => merchant.user_id === userId) || null;
  }

  async findMerchantById(merchantId: string) {
    return this.merchants.find((merchant) => merchant.id === merchantId) || null;
  }

  async insertMerchant(values: Record<string, unknown>) {
    this.insertCount += 1;
    this.lastInsert = values;
    const id = String(values.id);
    if (this.merchants.some((merchant) => merchant.id === id)) {
      return { merchant: null, error: { code: "23505", message: "duplicate key" } };
    }
    const merchant = { id, user_id: String(values.user_id) };
    this.merchants.push(merchant);
    return { merchant, error: null };
  }

  async updateMerchant(_merchantId: string, values: Record<string, unknown>) {
    this.lastUpdate = values;
  }

  async findOwnerRoleId() {
    return "owner-role-id";
  }

  async upsertOwnerMembership() {
    this.ownerMembershipEnsureCount += 1;
  }

  async ensureWorkspace() {
    this.workspaceEnsureCount += 1;
    return "workspace-id";
  }
}

function createAuthAdmin(options: { existing?: boolean } = {}) {
  const calls = { createUser: 0, generateLink: 0 };
  const authAdmin: StarterAuthAdmin = {
    async createUser() {
      calls.createUser += 1;
      return options.existing
        ? { data: { user: null }, error: { status: 422, message: "User already registered" } }
        : { data: { user: starterUser }, error: null };
    },
    async generateLink() {
      calls.generateLink += 1;
      return {
        data: { user: starterUser, properties: { email_otp: "activation-otp" } },
        error: null,
      };
    },
  };
  return { authAdmin, calls };
}

async function run() {
  {
    const repository = new MemoryStarterRepository();
    const { authAdmin, calls } = createAuthAdmin();
    const result = await provisionStarterSignup(
      { authAdmin, repository },
      {
        email: " Starter@Example.Test ",
        registeredName: "Starter Limited",
        tradingName: "Starter Shop",
        ownerName: "Starter Owner",
      },
    );

    assert.equal(calls.createUser, 1, "New Starter signup must create one Auth user.");
    assert.equal(repository.insertCount, 1, "New Starter signup must create one merchant.");
    assert.equal(repository.workspaceEnsureCount, 1, "New Starter signup must ensure its workspace row.");
    assert.equal(repository.ownerMembershipEnsureCount, 1, "New Starter signup should mirror the owner membership when the role exists.");
    assert.equal(result.merchantId, starterUser.id);
    assert.equal(result.merchantCreated, true);
    assert.equal(repository.lastInsert?.subscription_plan, "starter");
    assert.equal(repository.lastInsert?.merchant_tier, "starter");
    assert.equal(repository.lastInsert?.setup_mode, false);
    assert.equal(repository.lastInsert?.live_features_enabled, false);
    assert.equal("subscription" in (repository.lastInsert || {}), false, "Starter provisioning must not create or require a subscription.");
  }

  {
    const repository = new MemoryStarterRepository();
    const result = await repairAuthenticatedStarterWorkspace(repository, starterUser);

    assert.equal(result.merchantCreated, true, "A logged-in Starter identity with no merchant must be repaired.");
    assert.equal(repository.insertCount, 1);
    assert.equal(repository.workspaceEnsureCount, 1);
  }

  {
    const repository = new MemoryStarterRepository();
    await repairAuthenticatedStarterWorkspace(repository, starterUser);
    const replay = await repairAuthenticatedStarterWorkspace(repository, starterUser);

    assert.equal(replay.merchantCreated, false);
    assert.equal(repository.insertCount, 1, "Repeated Starter provisioning must not duplicate the merchant.");
    assert.equal(repository.merchants.length, 1);
    assert.equal(repository.workspaceEnsureCount, 2, "Repeated provisioning may safely re-ensure the same workspace.");
  }

  {
    const repository = new MemoryStarterRepository();
    repository.merchants.push({ id: "trigger-created-merchant", user_id: starterUser.id });
    const { authAdmin } = createAuthAdmin({ existing: true });
    const result = await provisionStarterSignup(
      { authAdmin, repository },
      {
        email: "starter@example.test",
        registeredName: "Starter Limited",
        tradingName: "Starter Shop",
      },
    );

    assert.equal(result.merchantId, "trigger-created-merchant");
    assert.equal(repository.insertCount, 0, "A trigger-created merchant must be reused.");
  }

  {
    const paidUser = {
      ...starterUser,
      user_metadata: { plan: "solo_plus", business_name: "Paid Limited" },
    };
    assert.equal(isRecoverableStarterUser(paidUser), false);
    let fetchCalls = 0;
    const recovery = await requestStarterWorkspaceRecovery(
      async () => {
        fetchCalls += 1;
        return new Response(null, { status: 200 });
      },
      paidUser,
    );
    assert.deepEqual(recovery, { attempted: false, repaired: false });
    assert.equal(fetchCalls, 0, "Paid-plan users must never call the Starter repair endpoint.");
  }

  {
    const onboardingSource = readFileSync("src/app/onboarding/[plan]/page.tsx", "utf8");
    const dashboardLayoutSource = readFileSync("src/app/(dashboard)/layout.tsx", "utf8");
    assert.match(
      onboardingSource,
      /if \(planId === "starter"\)[\s\S]+fetch\("\/api\/onboarding\/provision-starter"/,
      "Starter onboarding should use direct free provisioning.",
    );
    assert.match(
      onboardingSource,
      /const sessionRes = await fetch\("\/api\/onboarding\/create-session"/,
      "Non-Starter onboarding must retain the existing paid-plan session flow.",
    );
    assert.match(
      onboardingSource,
      /router\.push\(`\/checkout\/subscription\?plan=/,
      "Non-Starter onboarding must still continue to checkout.",
    );
    assert.match(
      dashboardLayoutSource,
      /requestStarterWorkspaceRecovery\(fetch, user\)[\s\S]+resolveMerchantContextForUser/,
      "Dashboard must attempt one authenticated Starter repair before deciding to redirect.",
    );
  }

  console.log("starter-workspace-provisioning.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
