const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { chromium, request } = require("playwright");

const BASE_URL = "http://127.0.0.1:3000";
const FIXTURE_EMAIL = "phase1.legacy.individual@deraledger.test";
const FIXTURE_NAME = "Phase 1 Legacy Individual QA";
const FIXTURE_OWNER = "Phase 1 QA Owner";
const FIXTURE_PASSWORD = "Phase1Compat!123";
const CORPORATE_FIXTURE_EMAIL = "phase1.legacy.corporate@deraledger.test";
const CORPORATE_FIXTURE_NAME = "Phase 1 Legacy Corporate QA";

function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase environment variables.");
}

const ADMIN_HEADERS = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
};

function encodeFilter(value) {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

async function authAdmin(pathname, init = {}) {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...init,
    headers: {
      ...ADMIN_HEADERS,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Auth request failed ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function rest(pathname, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    ...init,
    headers: {
      ...ADMIN_HEADERS,
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`REST request failed ${response.status}: ${pathname} :: ${JSON.stringify(data)}`);
  }
  return data;
}

async function maybeFirst(pathname) {
  const data = await rest(pathname);
  return Array.isArray(data) ? data[0] || null : data;
}

async function ensureAuthUser(email) {
  const existingMerchant = await maybeFirst(
    `/merchants?email=eq.${encodeFilter(email)}&select=id,user_id,email`,
  );
  if (existingMerchant?.user_id) {
    await authAdmin(`/auth/v1/admin/users/${existingMerchant.user_id}`, {
      method: "PUT",
      body: JSON.stringify({
        password: FIXTURE_PASSWORD,
        email_confirm: true,
      }),
    });
    return existingMerchant.user_id;
  }

  const created = await authAdmin("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: FIXTURE_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: FIXTURE_OWNER },
      app_metadata: { provider: "email" },
    }),
  });

  const userId = created.user?.id || created.id;
  if (!userId) {
    throw new Error("Could not resolve fixture auth user id.");
  }
  return userId;
}

async function ensurePlanFixture({
  email,
  businessName,
  planCode,
  priceNgn,
  referenceName,
  invoicePrefix,
}) {
  const userId = await ensureAuthUser(email);

  let merchant = await maybeFirst(`/merchants?email=eq.${encodeFilter(email)}&select=*`);

  if (!merchant) {
    const merchantId = crypto.randomUUID();
    const now = new Date().toISOString();
    const workspaceCode = `PLQA${Date.now().toString().slice(-8)}`;
    const verificationStepState =
      planCode === "corporate"
        ? {
            business_documents: { status: "verified" },
            utility_bill: { status: "verified" },
          }
        : {};

    const inserted = await rest("/merchants", {
      method: "POST",
      headers: {
        Prefer: "return=representation",
      },
      body: JSON.stringify([
        {
          id: merchantId,
          user_id: userId,
          business_name: businessName,
          trading_name: businessName,
          owner_name: FIXTURE_OWNER,
          email,
          phone: "+2348000000001",
          fee_absorption_default: "business",
          verification_status: "verified",
          merchant_tier: planCode,
          subscription_plan: planCode,
          monthly_collection_limit: planCode === "individual" ? 5000000 : 0,
          is_test_mode: true,
          cac_status: planCode === "corporate" ? "verified" : "unverified",
          bvn_status: "verified",
          selfie_status: "verified",
          cac_document_url: planCode === "corporate" ? "phase1-cac-doc.pdf" : null,
          utility_document_url: planCode === "corporate" ? "phase1-utility-doc.pdf" : null,
          utility_status: planCode === "corporate" ? "verified" : "unverified",
          workspace_code: workspaceCode,
          settlement_bank_name: "GTBank",
          settlement_bank_code: "058",
          settlement_account_number: "0152718746",
          settlement_account_name: FIXTURE_OWNER.toUpperCase(),
          settlement_account_type: "personal",
          payment_provider: "paystack",
          payment_subaccount_code: "ACCT_phase1fixture0001",
          subaccount_verified: true,
          platform_version: 1,
          is_super_admin: false,
          subscription_notifications_sent: {},
          business_country: "NG",
          business_type: planCode === "corporate" ? "ltd" : "sole_proprietorship",
          identity_verified: true,
          identity_verified_at: now,
          workspace_type: planCode === "corporate" ? "business" : "personal",
          onboarding_status: "active",
          setup_mode: false,
          live_features_enabled: true,
          relationship_claim: "owner_affiliated_claim",
          paid_setup_started_at: now,
          live_features_activated_at: now,
          verification_step_state: verificationStepState,
        },
      ]),
    });
    merchant = inserted[0];
  }

  const existingSubscription = await maybeFirst(
    `/subscriptions?merchant_id=eq.${merchant.id}&select=*&order=created_at.desc&limit=1`,
  );
  if (!existingSubscription) {
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
    await rest("/subscriptions", {
      method: "POST",
      body: JSON.stringify([
        {
          id: crypto.randomUUID(),
          merchant_id: merchant.id,
          plan_type: planCode,
          amount_paid: priceNgn,
          start_date: start.toISOString(),
          expiry_date: end.toISOString(),
          status: "active",
          last_notified_at: null,
          is_banner_dismissed: false,
        },
      ]),
    });
  }

  const existingPayment = await maybeFirst(
    `/subscription_payments?merchant_id=eq.${merchant.id}&select=*&limit=1`,
  );
  if (!existingPayment) {
    const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString();
    await rest("/subscription_payments", {
      method: "POST",
      body: JSON.stringify([
        {
          id: crypto.randomUUID(),
          merchant_id: merchant.id,
          plan: planCode,
          amount_ngn: priceNgn,
          period_start: start,
          period_end: end,
          paystack_ref: `QA-PHASE1-${planCode.toUpperCase()}`,
          payment_type: "new",
          status: "paid",
        },
      ]),
    });
  }

  let client = await maybeFirst(
    `/clients?merchant_id=eq.${merchant.id}&email=eq.${encodeFilter("phase1.client@deraledger.test")}&select=*`,
  );
  if (!client) {
    const inserted = await rest("/clients", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([
        {
          id: crypto.randomUUID(),
          merchant_id: merchant.id,
          full_name: "Phase 1 Test Client",
          email: "phase1.client@deraledger.test",
          phone: "+2348000000002",
          company_name: "Compat Client Ltd",
          is_deleted: false,
          reminder_enabled: false,
          reminder_channels: [],
        },
      ]),
    });
    client = inserted[0];
  }

  let reference = await maybeFirst(
    `/references?merchant_id=eq.${merchant.id}&name=eq.${encodeFilter(referenceName)}&select=*`,
  );
  if (!reference) {
    const inserted = await rest("/references", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([
        {
          id: crypto.randomUUID(),
          merchant_id: merchant.id,
          name: referenceName,
          description: "Compatibility migration regression reference",
          handled_by: FIXTURE_OWNER,
          project_total_value: planCode === "corporate" ? 45000 : 15000,
        },
      ]),
    });
    reference = inserted[0];
  }

  const ensureInvoice = async ({
    invoiceNumber,
    invoiceType,
    grandTotal,
    amountPaid,
    payByDate,
    shortLink,
  }) => {
    let invoice = await maybeFirst(
      `/invoices?merchant_id=eq.${merchant.id}&invoice_number=eq.${encodeFilter(invoiceNumber)}&select=*`,
    );
    if (!invoice) {
      const inserted = await rest("/invoices", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([
          {
            id: crypto.randomUUID(),
            merchant_id: merchant.id,
            client_id: client.id,
            invoice_number: invoiceNumber,
            status: amountPaid > 0 ? "partially_paid" : "open",
            subtotal: grandTotal,
            discount_pct: 0,
            discount_value: 0,
            tax_pct: 0,
            tax_value: 0,
            grand_total: grandTotal,
            amount_paid: amountPaid,
            outstanding_balance: grandTotal - amountPaid,
            fee_absorption: "business",
            pay_by_date: payByDate,
            short_link: shortLink,
            qr_code_url: null,
            notes: invoiceType === "record" ? "Offline payment record fixture" : "Collection invoice fixture",
            manual_close_reason: null,
            invoice_type: invoiceType,
            payment_notes: invoiceType === "record" ? "Bank transfer received" : null,
            allow_partial_payment: invoiceType === "collection",
            partial_payment_pct: invoiceType === "collection" ? 50 : null,
            reference_id: reference.id,
            handled_by: null,
            archived_at: null,
            is_archived: false,
            archived_by: null,
            payment_provider: "paystack",
            crypto_deposit_address: null,
            crypto_asset: null,
            invoice_stage: "standard",
            payment_status: "PENDING",
          },
        ]),
      });
      invoice = inserted[0];

      await rest("/line_items", {
        method: "POST",
        body: JSON.stringify([
          {
            id: crypto.randomUUID(),
            invoice_id: invoice.id,
            item_name: invoiceType === "record" ? "Recorded service retainer" : "Collection consulting fee",
            quantity: 1,
            unit_rate: grandTotal,
            line_total: grandTotal,
            sort_order: 1,
          },
        ]),
      });
    }
    return invoice;
  };

  const recordInvoice = await ensureInvoice({
    invoiceNumber: `${invoicePrefix}-RECORD`,
    invoiceType: "record",
    grandTotal: 10000,
    amountPaid: 5000,
    payByDate: null,
    shortLink: "PH1REC01",
  });

  const collectionInvoice = await ensureInvoice({
    invoiceNumber: `${invoicePrefix}-COLLECT`,
    invoiceType: "collection",
    grandTotal: 15000,
    amountPaid: 0,
    payByDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    shortLink: "PH1COL01",
  });

  return {
    merchant,
    client,
    reference,
    recordInvoice,
    collectionInvoice,
  };
}

function attachDiagnostics(page, options = {}) {
  const issues = {
    console: [],
    pageErrors: [],
    requestFailures: [],
    badResponses: [],
  };

  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (type === "warning" || type === "error") {
      if (options.allowConsole && options.allowConsole.some((pattern) => text.includes(pattern))) {
        return;
      }
      issues.console.push(`${type}: ${text}`);
    }
  });

  page.on("pageerror", (error) => {
    issues.pageErrors.push(String(error));
  });

  page.on("requestfailed", (req) => {
    const failureText = req.failure()?.errorText || "unknown";
    if (failureText === "net::ERR_ABORTED") return;
    issues.requestFailures.push(`${req.method()} ${req.url()} :: ${failureText}`);
  });

  page.on("response", async (response) => {
    const status = response.status();
    if (status < 400) return;
    const url = response.url();
    if (options.allowResponse && options.allowResponse.some((rule) => url.includes(rule.url) && status === rule.status)) {
      return;
    }
    issues.badResponses.push(`${status} ${response.request().method()} ${url}`);
  });

  return issues;
}

function assertNoIssues(label, issues) {
  const all = [
    ...issues.console,
    ...issues.pageErrors,
    ...issues.requestFailures,
    ...issues.badResponses,
  ];
  if (all.length > 0) {
    throw new Error(`${label} had browser issues:\n${all.join("\n")}`);
  }
}

async function ensureLegacyIndividualFixture() {
  return ensurePlanFixture({
    email: FIXTURE_EMAIL,
    businessName: FIXTURE_NAME,
    planCode: "individual",
    priceNgn: 5000,
    referenceName: "Phase 1 QA Reference",
    invoicePrefix: "INV-PHASE1",
  });
}

async function ensureLegacyCorporateFixture() {
  return ensurePlanFixture({
    email: CORPORATE_FIXTURE_EMAIL,
    businessName: CORPORATE_FIXTURE_NAME,
    planCode: "corporate",
    priceNgn: 20000,
    referenceName: "Phase 1 Corporate QA Reference",
    invoicePrefix: "INV-PHASE1B",
  });
}

async function loginAndVisit(context, targetPath, email) {
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email Address").fill(email);
  await page.getByLabel("Password").fill(FIXTURE_PASSWORD);
  await page.getByRole("button", { name: /^Sign In$/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  await page.waitForTimeout(2000);
  if (targetPath !== "/dashboard") {
    await page.goto(`${BASE_URL}${targetPath}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const body = await page.locator("body").textContent();
    if (body?.includes("Default Business") || body?.includes("Starter Plan")) {
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
    }
  }
  return page;
}

async function verifyLegacyIndividualFlow(browser, fixture) {
  const context = await browser.newContext();
  const billingPage = await loginAndVisit(context, "/settings/billing", FIXTURE_EMAIL);
  const billingIssues = attachDiagnostics(billingPage);

  await billingPage.getByRole("heading", { name: "Billing & Subscription" }).waitFor();
  const billingBody = await billingPage.locator("body").textContent();
  if (!billingBody?.includes("Solo Lite")) {
    throw new Error(`Expected Solo Lite label on legacy individual billing page, got: ${billingBody?.slice(0, 600)}`);
  }
  if (!billingBody?.includes("NGN 5,000")) {
    throw new Error(`Expected NGN 5,000 on legacy individual billing page, got: ${billingBody?.slice(0, 600)}`);
  }

  await billingPage.getByRole("button", { name: /Renew Now/i }).click();
  await billingPage.waitForURL(/\/checkout\/subscription\?plan=individual&context=renewal/);
  await billingPage.getByText("Solo Lite", { exact: false }).waitFor();
  await billingPage.goBack({ waitUntil: "networkidle" });

  await billingPage.getByRole("link", { name: /Upgrade to Business/i }).click();
  await billingPage.waitForURL(/\/settings\/upgrade\/corporate/);
  await billingPage.goBack({ waitUntil: "networkidle" });
  assertNoIssues("legacy individual billing flow", billingIssues);
  await billingPage.close();

  const invoicesPage = await loginAndVisit(context, "/invoices", FIXTURE_EMAIL);
  const invoiceIssues = attachDiagnostics(invoicesPage);

  await invoicesPage.getByRole("heading", { name: "Invoices" }).waitFor();
  await invoicesPage.getByPlaceholder(/Search invoice number/i).fill("INV-PHASE1");
  await invoicesPage.getByText("INV-PHASE1-RECORD", { exact: true }).waitFor();
  await invoicesPage.getByText("INV-PHASE1-COLLECT", { exact: true }).waitFor();
  await invoicesPage.getByRole("button", { name: /Collection/i }).click();
  await invoicesPage.getByText("INV-PHASE1-COLLECT", { exact: true }).waitFor();
  await invoicesPage.getByRole("button", { name: /Record/i }).click();
  await invoicesPage.getByText("INV-PHASE1-RECORD", { exact: true }).waitFor();
  assertNoIssues("legacy individual invoices list", invoiceIssues);
  await invoicesPage.close();

  const recordPage = await loginAndVisit(context, `/invoices/${fixture.recordInvoice.id}`, FIXTURE_EMAIL);
  const recordIssues = attachDiagnostics(recordPage);
  await recordPage.getByText("INV-PHASE1-RECORD", { exact: true }).waitFor();
  assertNoIssues("legacy individual record invoice", recordIssues);
  await recordPage.close();

  const collectionPage = await loginAndVisit(context, `/invoices/${fixture.collectionInvoice.id}`, FIXTURE_EMAIL);
  const collectionIssues = attachDiagnostics(collectionPage);
  await collectionPage.getByText("INV-PHASE1-COLLECT", { exact: true }).waitFor();
  assertNoIssues("legacy individual collection invoice", collectionIssues);
  await collectionPage.close();

  const referencesPage = await loginAndVisit(context, "/references", FIXTURE_EMAIL);
  const referenceIssues = attachDiagnostics(referencesPage);
  await referencesPage.getByRole("heading", { name: "References" }).waitFor();
  await referencesPage.getByLabel("Search references").fill("Phase 1 QA Reference");
  await referencesPage.getByText("Phase 1 QA Reference", { exact: true }).waitFor();
  assertNoIssues("legacy individual references", referenceIssues);
  await referencesPage.close();

  const payPage = await context.newPage();
  const payIssues = attachDiagnostics(payPage);
  await payPage.goto(`${BASE_URL}/pay/${fixture.collectionInvoice.id}`, { waitUntil: "networkidle" });
  await payPage.getByText("INV-PHASE1-COLLECT", { exact: true }).waitFor();
  await payPage.getByLabel("Amount to Pay").fill("7500");
  assertNoIssues("legacy individual payment page", payIssues);
  await payPage.close();

  const soloPlusPage = await loginAndVisit(context, "/settings/upgrade/solo_plus", FIXTURE_EMAIL);
  const soloPlusIssues = attachDiagnostics(soloPlusPage, {
    allowResponse: [{ url: "/api/plans/availability?plan=solo_plus", status: 403 }],
  });
  await soloPlusPage.waitForLoadState("networkidle");
  const soloPlusBody = await soloPlusPage.locator("body").textContent();
  if (
    !soloPlusBody?.includes("This plan is not available right now.") &&
    !soloPlusPage.url().includes("/settings/billing")
  ) {
    throw new Error(`Expected authenticated solo_plus upgrade route to be blocked, got ${soloPlusPage.url()}`);
  }
  assertNoIssues("legacy individual solo plus block", soloPlusIssues);
  await soloPlusPage.close();

  const api = await request.newContext({
    baseURL: BASE_URL,
    storageState: await context.storageState(),
  });
  const soloPlusMethods = await api.get("/api/checkout/payment-methods?kind=upgrade&plan=solo_plus");
  if (soloPlusMethods.status() !== 403) {
    throw new Error(`Expected authenticated solo_plus upgrade payment-methods to return 403, got ${soloPlusMethods.status()}`);
  }
  await api.dispose();
  await context.close();
}

async function verifyCorporateFlow(browser, fixture) {
  const email = CORPORATE_FIXTURE_EMAIL;
  const context = await browser.newContext();

  const billingPage = await loginAndVisit(context, "/settings/billing", email);
  const billingIssues = attachDiagnostics(billingPage);
  await billingPage.getByRole("heading", { name: "Billing & Subscription" }).waitFor();
  const billingBody = await billingPage.locator("body").textContent();
  if (!billingBody?.includes("Business")) {
    throw new Error(`Expected Business label on corporate billing page, got: ${billingBody?.slice(0, 600)}`);
  }
  if (!billingBody?.includes("NGN 20,000")) {
    throw new Error(`Expected NGN 20,000 on corporate billing page, got: ${billingBody?.slice(0, 600)}`);
  }
  await billingPage.getByRole("button", { name: /Renew Now/i }).click();
  await billingPage.waitForURL(/\/checkout\/subscription\?plan=corporate&context=renewal/);
  await billingPage.goBack({ waitUntil: "networkidle" });
  assertNoIssues("corporate billing flow", billingIssues);
  await billingPage.close();

  const invoicesPage = await loginAndVisit(context, "/invoices", email);
  const invoiceIssues = attachDiagnostics(invoicesPage);
  await invoicesPage.getByRole("heading", { name: "Invoices" }).waitFor();
  await invoicesPage.getByPlaceholder(/Search invoice number/i).fill("INV-PHASE1B");
  await invoicesPage.getByText("INV-PHASE1B-RECORD", { exact: true }).waitFor();
  await invoicesPage.getByText("INV-PHASE1B-COLLECT", { exact: true }).waitFor();
  assertNoIssues("corporate invoices list", invoiceIssues);
  await invoicesPage.close();

  const recordPage = await loginAndVisit(context, `/invoices/${fixture.recordInvoice.id}`, email);
  const recordIssues = attachDiagnostics(recordPage);
  await recordPage.getByText("INV-PHASE1B-RECORD", { exact: true }).waitFor();
  assertNoIssues("corporate record invoice", recordIssues);
  await recordPage.close();

  const collectionPage = await loginAndVisit(context, `/invoices/${fixture.collectionInvoice.id}`, email);
  const collectionIssues = attachDiagnostics(collectionPage);
  await collectionPage.getByText("INV-PHASE1B-COLLECT", { exact: true }).waitFor();
  assertNoIssues("corporate collection invoice", collectionIssues);
  await collectionPage.close();

  const referencesPage = await loginAndVisit(context, "/references", email);
  const referenceIssues = attachDiagnostics(referencesPage);
  await referencesPage.getByRole("heading", { name: "References" }).waitFor();
  await referencesPage.getByText("Phase 1 Corporate QA Reference", { exact: true }).waitFor();
  assertNoIssues("corporate references", referenceIssues);
  await referencesPage.close();

  const payPage = await context.newPage();
  const payIssues = attachDiagnostics(payPage);
  await payPage.goto(`${BASE_URL}/pay/${fixture.collectionInvoice.id}`, { waitUntil: "networkidle" });
  await payPage.getByText("INV-PHASE1B-COLLECT", { exact: true }).waitFor();
  await payPage.getByLabel("Amount to Pay").fill("5000");
  assertNoIssues("corporate payment page", payIssues);
  await payPage.close();

  const soloPlusPage = await loginAndVisit(context, "/settings/upgrade/solo_plus", email);
  const soloPlusIssues = attachDiagnostics(soloPlusPage, {
    allowResponse: [{ url: "/api/plans/availability?plan=solo_plus", status: 403 }],
  });
  await soloPlusPage.waitForLoadState("networkidle");
  const soloPlusBody = await soloPlusPage.locator("body").textContent();
  if (
    !soloPlusBody?.includes("This plan is not available right now.") &&
    !soloPlusPage.url().includes("/settings/billing")
  ) {
    throw new Error(`Expected authenticated corporate solo_plus upgrade route to be blocked, got ${soloPlusPage.url()}`);
  }
  assertNoIssues("corporate solo plus block", soloPlusIssues);
  await soloPlusPage.close();

  await context.close();
}

(async () => {
  const fixture = await ensureLegacyIndividualFixture();
  const corporateFixture = await ensureLegacyCorporateFixture();
  const browser = await chromium.launch({ headless: true });

  try {
    await verifyLegacyIndividualFlow(browser, fixture);
    await verifyCorporateFlow(browser, corporateFixture);
  } finally {
    await browser.close();
  }

  console.log("phase1-auth-qa.cjs passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
