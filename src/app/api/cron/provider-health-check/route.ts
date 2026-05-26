import { NextResponse } from "next/server";
import {
  getProviderRegistry,
  instantiateProvider,
  isVerificationSandboxMode,
  markProviderStatus,
  recordHealthEvent,
  updateProviderHealth,
  type VerificationProviderKey,
} from "@/lib/kyc/index";
import { sendProviderDownAlert } from "@/lib/brevo";

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return await runHealthChecks();
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  return await runHealthChecks();
}

async function runHealthChecks() {
  try {
    const registry = await getProviderRegistry();
    const results = [];
    const sandboxMode = await isVerificationSandboxMode();

    for (const row of registry) {
      if (row.status === "DISABLED") continue;

      const provider = instantiateProvider(row.provider_name, { sandboxMode });
      
      // Perform health check ping
      const checkResult = await (provider as any).checkProviderHealth();
      
      // Append to provider_health_events
      await recordHealthEvent(checkResult);

      let currentFailures = row.health_check_failures;

      if (checkResult.status === "DOWN") {
        currentFailures += 1;
        let newStatus = row.status;

        if (currentFailures >= 10) {
          newStatus = "DOWN";
          // Trigger Brevo Outage alert
          await sendProviderDownAlert(row.provider_name, currentFailures);
        } else if (currentFailures >= 5) {
          newStatus = "DEGRADED";
        }

        await markProviderStatus(row.provider_name, newStatus, currentFailures);
        await updateProviderHealth(row.provider_name as VerificationProviderKey, "UNAVAILABLE");
        results.push({ provider: row.provider_name, status: newStatus, failures: currentFailures });
      } else {
        // Success -> reset
        await updateProviderHealth(row.provider_name as VerificationProviderKey, "ACTIVE");
        await markProviderStatus(row.provider_name, "ACTIVE", 0);
        results.push({ provider: row.provider_name, status: "ACTIVE", failures: 0 });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (err: any) {
    console.error("[HealthCheckCron] Outer error:", err?.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
