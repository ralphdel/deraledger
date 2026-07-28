import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { mapUpgradeInitializationError } from "../src/app/api/payment/upgrade/error-mapping";
async function run() {
  {
    const mapped = mapUpgradeInitializationError(
      {
        code: "SOLO_PLUS_PAYMENT_INIT_CONFLICT",
        message: "Solo Plus case already has a different active payment initialization.",
      },
    );
    assert.equal(mapped.status, 409);
    assert.equal(mapped.code, "SOLO_PLUS_PAYMENT_INIT_CONFLICT");
    assert.equal(
      mapped.error,
      "Solo Plus case already has a different active payment initialization.",
    );
  }

  {
    const mapped = mapUpgradeInitializationError(
      {
        code: "SOLO_PLUS_PAYMENT_INITIALIZATION_RECOVERY_REQUIRED",
        message: "Solo Plus payment already has an unrecoverable provider checkout reference for this attempt.",
      },
    );
    assert.equal(mapped.status, 409);
    assert.equal(mapped.code, "SOLO_PLUS_PAYMENT_INITIALIZATION_RECOVERY_REQUIRED");
  }

  {
    const mapped = mapUpgradeInitializationError(
      new Error("Solo Plus repository mapping rejected merchant_id."),
    );
    assert.equal(mapped.status, 500);
    assert.equal(mapped.code, "INTERNAL_ERROR");
    assert.equal(mapped.error, "Upgrade initialization failed unexpectedly.");
  }

  {
    const routeSource = readFileSync(
      "src/app/api/payment/upgrade/route.ts",
      "utf8",
    );
    assert.match(
      routeSource,
      /hasReusablePaymentInitialization\(/,
      "Upgrade route should reuse a persisted Solo Plus checkout session before calling the provider again.",
    );
    assert.match(
      routeSource,
      /updatePlanPaymentRecordById\(/,
      "Upgrade route should persist payment-record initialization state by record id.",
    );
    assert.match(
      routeSource,
      /providerInitializationReused:\s*true/,
      "Upgrade route should surface replay metadata when a previous checkout session is reused.",
    );
  }

  console.log("payment-upgrade-route.test.ts passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
