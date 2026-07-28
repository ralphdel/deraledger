import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function run() {
  const upgradePageSource = readFileSync(
    "src/app/checkout/upgrade/[plan]/page.tsx",
    "utf8",
  );
  const upgradeRouteSource = readFileSync(
    "src/app/api/payment/upgrade/route.ts",
    "utf8",
  );
  const upgradeSuccessSource = readFileSync(
    "src/app/(dashboard)/settings/upgrade-success/page.tsx",
    "utf8",
  );
  const subscriptionPageSource = readFileSync(
    "src/app/checkout/subscription/page.tsx",
    "utf8",
  );
  const onboardingInitSource = readFileSync(
    "src/app/api/onboarding/initialize-payment/route.ts",
    "utf8",
  );
  const renewInitSource = readFileSync(
    "src/app/api/payment/renew-initialize/route.ts",
    "utf8",
  );
  const verifyUpgradeSource = readFileSync(
    "src/app/api/payment/verify-upgrade/route.ts",
    "utf8",
  );
  const verifyAndProvisionSource = readFileSync(
    "src/app/api/onboarding/verify-and-provision/route.ts",
    "utf8",
  );

  assert.match(
    upgradePageSource,
    /individual:\s*\{/,
    "Solo Lite upgrade should remain configured on the shared upgrade checkout page.",
  );
  assert.match(
    upgradePageSource,
    /(business|corporate):\s*\{/,
    "Business upgrade should remain configured on the shared upgrade checkout page.",
  );
  assert.match(
    upgradePageSource,
    /parseUpgradeCheckoutResponse\(data\)/,
    "Upgrade checkout should parse the explicit normalized provider response.",
  );
  assert.match(
    upgradePageSource,
    /switch \(normalizedResponse\.completionMode\)/,
    "Upgrade checkout should dispatch explicitly by completion mode.",
  );
  assert.match(
    upgradePageSource,
    /resumePaystackCheckout\(normalizedResponse\.accessCode/,
    "Upgrade checkout should use Paystack resume only for declared paystack_resume responses.",
  );
  assert.match(
    upgradePageSource,
    /window\.location\.assign\(normalizedResponse\.checkoutUrl\)/,
    "Upgrade checkout should redirect to the exact Monnify checkout URL for hosted checkout responses.",
  );
  assert.doesNotMatch(
    upgradePageSource,
    /setup\(\{/,
    "Upgrade checkout should no longer create a new Paystack inline transaction directly in the browser.",
  );

  assert.match(
    upgradeRouteSource,
    /const soloPlusPreparation = normalizedPlan === "solo_plus"/,
    "Solo Plus case preparation must remain gated to the Solo Plus plan.",
  );
  assert.match(
    upgradeRouteSource,
    /if \(normalizedPlan !== "solo_plus"\) \{[\s\S]*paymentRecord = await createPendingPlanPaymentRecord/,
    "Solo Lite and Business upgrades should create their own payment records without entering the Solo Plus case flow.",
  );
  assert.match(
    upgradeRouteSource,
    /provider: "paystack"[\s\S]*completionMode: "paystack_resume"/,
    "Upgrade route should declare an explicit Paystack resume mode for server-initialized upgrade payments.",
  );
  assert.match(
    upgradeRouteSource,
    /provider: "monnify"[\s\S]*completionMode: "hosted_checkout_redirect"/,
    "Upgrade route should declare an explicit Monnify hosted checkout redirect mode.",
  );
  assert.match(
    upgradeRouteSource,
    /createPendingPlanPaymentRecord\(trustedSupabase,/,
    "Upgrade route should persist payment_records for non-Solo-Plus upgrades as well.",
  );

  assert.match(
    upgradeSuccessSource,
    /fetch\("\/api\/payment\/verify-upgrade"/,
    "All plan upgrades should still verify through the shared upgrade verification route.",
  );
  assert.match(
    verifyUpgradeSource,
    /const isSoloPlus = paymentRecord\?\.solo_plus_case_id != null;/,
    "Upgrade verification should keep Solo Plus payment linkage isolated from non-Solo-Plus upgrades.",
  );

  assert.match(
    subscriptionPageSource,
    /const handler = pop\.setup\(\{/,
    "Existing subscription checkout still uses the legacy Paystack inline popup path.",
  );
  assert.match(
    subscriptionPageSource,
    /handler\.openIframe\(\)/,
    "Existing subscription checkout still opens Paystack through the legacy popup flow.",
  );
  assert.match(
    subscriptionPageSource,
    /window\.location\.href = data\.authorizationUrl;/,
    "Existing subscription checkout still redirects to Monnify's returned URL.",
  );
  assert.match(
    onboardingInitSource,
    /prepareSoloPlusOnboardingPayment\(/,
    "Solo Plus subscription onboarding should still use the Solo Plus server preparation flow.",
  );
  assert.match(
    onboardingInitSource,
    /return NextResponse\.json\(\{[\s\S]*authorizationUrl: result\.authorizationUrl,[\s\S]*accessCode: result\.accessCode,[\s\S]*reference: resolvedReference,[\s\S]*provider: route\.provider,/,
    "Existing subscription onboarding payment init should retain its legacy accessCode response contract.",
  );
  assert.match(
    renewInitSource,
    /return NextResponse\.json\(\{[\s\S]*accessCode: result\.accessCode,[\s\S]*reference,[\s\S]*authorizationUrl: result\.authorizationUrl,[\s\S]*provider: route\.provider,/,
    "Existing subscription renewal init should retain its legacy accessCode response contract.",
  );
  assert.match(
    verifyAndProvisionSource,
    /const isSoloPlus = paymentRecord\?\.solo_plus_case_id != null;/,
    "Subscription payment verification should keep Solo Plus onboarding isolated from other subscription plans.",
  );

  console.log("upgrade-plan-compatibility-contract.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
