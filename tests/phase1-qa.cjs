const { chromium, request } = require("playwright");

function attachDiagnostics(page) {
  const issues = {
    console: [],
    pageErrors: [],
    requestFailures: [],
  };

  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "warning" || type === "error") {
      issues.console.push(`${type}: ${msg.text()}`);
    }
  });

  page.on("pageerror", (error) => {
    issues.pageErrors.push(String(error));
  });

  page.on("requestfailed", (req) => {
    const failureText = req.failure()?.errorText || "unknown";
    const url = req.url();
    if (failureText === "net::ERR_ABORTED") {
      return;
    }
    issues.requestFailures.push(`${req.method()} ${url} :: ${failureText}`);
  });

  return issues;
}

function assertNoIssues(label, issues) {
  const all = [...issues.console, ...issues.pageErrors, ...issues.requestFailures];
  if (all.length > 0) {
    throw new Error(`${label} had browser issues:\n${all.join("\n")}`);
  }
}

async function runPageCheck(browser, label, url, interact) {
  const page = await browser.newPage();
  const issues = attachDiagnostics(page);
  await page.goto(url, { waitUntil: "networkidle" });
  if (interact) {
    await interact(page);
  }
  assertNoIssues(label, issues);
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  await runPageCheck(
    context,
    "onboarding plan selection",
    "http://127.0.0.1:3000/onboarding",
    async (page) => {
      await page.getByText("Solo Lite", { exact: true }).waitFor();
      await page.getByText("Business", { exact: true }).waitFor();
      await page.getByText("NGN 5,000/month", { exact: true }).waitFor();
      await page.getByText("NGN 20,000/month", { exact: true }).waitFor();
    },
  );

  await runPageCheck(
    context,
    "individual onboarding",
    "http://127.0.0.1:3000/onboarding/individual",
    async (page) => {
      await page.getByLabel("Email Address").fill("phase1@example.com");
      await page.getByLabel("Trading Name").fill("Phase One Store");
      await page.getByLabel("Owner Full Name").fill("Ada Compat");
      await page.getByRole("checkbox").check();
    },
  );

  await runPageCheck(
    context,
    "solo plus onboarding block",
    "http://127.0.0.1:3000/onboarding/solo_plus",
    async (page) => {
      await page.getByText("Solo Plus is currently unavailable", { exact: false }).waitFor();
    },
  );

  await runPageCheck(
    context,
    "solo plus subscription block",
    "http://127.0.0.1:3000/checkout/subscription?plan=solo_plus",
    async (page) => {
      await page.waitForLoadState("networkidle");
      const body = await page.locator("body").textContent();
      const currentUrl = page.url();
      if (!body?.includes("This plan is not available right now.") && !currentUrl.includes("/onboarding")) {
        throw new Error(`Expected solo_plus subscription direct URL to be blocked, got ${currentUrl}`);
      }
    },
  );

  await runPageCheck(
    context,
    "solo plus upgrade block",
    "http://127.0.0.1:3000/checkout/upgrade/solo_plus",
    async (page) => {
      await page.waitForLoadState("networkidle");
      const body = await page.locator("body").textContent();
      const currentUrl = page.url();
      if (
        !body?.includes("This plan is not available right now.") &&
        !currentUrl.includes("/settings") &&
        !currentUrl.includes("/login")
      ) {
        throw new Error(`Expected solo_plus upgrade direct URL to be blocked, got ${currentUrl}`);
      }
    },
  );

  const api = await request.newContext({ baseURL: "http://127.0.0.1:3000" });
  const createSession = await api.post("/api/onboarding/create-session", {
    data: {
      email: "phase1@example.com",
      businessName: "Phase One Store",
      plan: "solo_plus",
      verificationDisclosureAccepted: true,
    },
  });
  if (createSession.status() !== 403) {
    throw new Error(`Expected onboarding/create-session solo_plus to return 403, got ${createSession.status()}`);
  }

  const paymentMethods = await api.get("/api/checkout/payment-methods?kind=subscription&plan=solo_plus");
  if (paymentMethods.status() !== 403) {
    throw new Error(`Expected checkout/payment-methods solo_plus to return 403, got ${paymentMethods.status()}`);
  }

  await api.dispose();
  await context.close();
  await browser.close();

  console.log("phase1-qa.cjs passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
