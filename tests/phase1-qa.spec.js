const { test, expect, request } = require("@playwright/test");

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
    issues.requestFailures.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText || "unknown"}`);
  });

  return issues;
}

function expectNoBrowserIssues(issues) {
  expect(issues.console, `Console warnings/errors: ${issues.console.join("\n")}`).toEqual([]);
  expect(issues.pageErrors, `Page errors: ${issues.pageErrors.join("\n")}`).toEqual([]);
  expect(issues.requestFailures, `Request failures: ${issues.requestFailures.join("\n")}`).toEqual([]);
}

test.describe("Phase 1 soft migration QA", () => {
  test("onboarding plan selection shows compatibility labels", async ({ page }) => {
    const issues = attachDiagnostics(page);

    await page.goto("http://127.0.0.1:3100/onboarding");
    await expect(page.getByText("Solo Lite", { exact: true })).toBeVisible();
    await expect(page.getByText("Business", { exact: true })).toBeVisible();
    await expect(page.getByText("NGN 5,000/month", { exact: true })).toBeVisible();
    await expect(page.getByText("NGN 20,000/month", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Get Started" }).first().hover();

    expectNoBrowserIssues(issues);
  });

  test("individual onboarding form is interactive without warnings", async ({ page }) => {
    const issues = attachDiagnostics(page);

    await page.goto("http://127.0.0.1:3100/onboarding/individual");
    await page.getByLabel("Email Address").fill("phase1@example.com");
    await page.getByLabel("Business / Trading Name").fill("Phase One Store");
    await page.getByLabel("Business Owner Full Name").fill("Ada Compat");
    await page.getByRole("checkbox").check();

    await expect(page.getByText("Solo Lite", { exact: true })).toBeVisible();
    await expect(page.getByText("Continue to payment", { exact: false })).toBeVisible();

    expectNoBrowserIssues(issues);
  });

  test("solo plus direct routes stay blocked while flag is off", async ({ page }) => {
    const issues = attachDiagnostics(page);

    await page.goto("http://127.0.0.1:3100/onboarding/solo_plus");
    await expect(page.getByText("Solo Plus is currently unavailable", { exact: false })).toBeVisible();

    await page.goto("http://127.0.0.1:3100/checkout/subscription?plan=solo_plus");
    await expect(page.getByText("This plan is not available right now.", { exact: true })).toBeVisible();

    await page.goto("http://127.0.0.1:3100/checkout/upgrade/solo_plus");
    await expect(page.getByText("This plan is not available right now.", { exact: true })).toBeVisible();

    expectNoBrowserIssues(issues);
  });

  test("solo plus direct API attempts are rejected", async () => {
    const api = await request.newContext({ baseURL: "http://127.0.0.1:3100" });

    const createSession = await api.post("/api/onboarding/create-session", {
      data: {
        email: "phase1@example.com",
        businessName: "Phase One Store",
        plan: "solo_plus",
        verificationDisclosureAccepted: true,
      },
    });
    expect(createSession.status()).toBe(403);

    const paymentMethods = await api.get("/api/checkout/payment-methods?kind=subscription&plan=solo_plus");
    expect(paymentMethods.status()).toBe(403);

    await api.dispose();
  });
});
