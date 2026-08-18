import { NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { sendOnboardingWelcomeEmail } from "@/lib/brevo";
import {
  createSupabaseStarterWorkspaceRepository,
  getStarterProvisioningLogPayload,
  provisionStarterSignup,
  repairAuthenticatedStarterWorkspace,
  StarterProvisioningError,
  type StarterAuthUser,
} from "@/lib/services/starter-workspace.service";
import { getAppUrl } from "@/lib/server-utils";
import { createClient as createServerClient } from "@/lib/supabase/server";

type ProvisionStarterRouteDependencies = {
  getAuthenticatedUser: () => Promise<StarterAuthUser | null>;
  getAdminClient: () => SupabaseClient;
  sendWelcomeEmail: typeof sendOnboardingWelcomeEmail;
  appUrl: () => string;
};

export function createProvisionStarterRouteHandler(
  dependencies: ProvisionStarterRouteDependencies,
) {
  return {
    async POST(request: Request) {
      try {
        const authenticatedUser = await dependencies.getAuthenticatedUser();
        const adminClient = dependencies.getAdminClient();
        const repository = createSupabaseStarterWorkspaceRepository(adminClient);

        // Logged-in recovery never trusts request fields. Eligibility and business
        // identity come only from the validated Supabase Auth session metadata.
        if (authenticatedUser) {
          const result = await repairAuthenticatedStarterWorkspace(repository, authenticatedUser);
          logProvisioningWarnings(result.warnings);
          return NextResponse.json({ success: true, repaired: result.merchantCreated });
        }

        const body = await request.json().catch(() => null) as Record<string, unknown> | null;
        const email = normalizeText(body?.email);
        const tradingName = normalizeText(body?.tradingName);
        const registeredName = normalizeText(body?.registeredName);
        const ownerName = normalizeText(body?.ownerName);

        if (!email || !tradingName || !registeredName) {
          return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
        }

        const result = await provisionStarterSignup(
          {
            authAdmin: adminClient.auth.admin,
            repository,
          },
          { email, tradingName, registeredName, ownerName },
        );
        logProvisioningWarnings(result.warnings);

        const appUrl = dependencies.appUrl();
        const otp = result.activationProperties?.email_otp;
        const setPasswordLink = otp
          ? `${appUrl}/auth/verify?token=${otp}&email=${encodeURIComponent(email.toLowerCase())}&type=magiclink&next=${encodeURIComponent("/onboarding/set-password")}`
          : `${appUrl}/onboarding/resend`;

        try {
          await dependencies.sendWelcomeEmail(email, tradingName, "starter", setPasswordLink);
        } catch {
          console.warn("Starter provisioning warning", {
            code: "WELCOME_EMAIL_FAILED",
            stage: "welcome_email",
            message: "Starter workspace was created, but the welcome email could not be sent.",
          });
        }

        return NextResponse.json({ success: true });
      } catch (error: unknown) {
        if (error instanceof StarterProvisioningError) {
          const status = error.code === "NOT_STARTER_USER" || error.code === "STARTER_METADATA_MISSING"
            ? 409
            : 500;
          console.error("Starter provisioning failed", getStarterProvisioningLogPayload(error));
          return NextResponse.json(
            { error: status === 409 ? error.message : "Failed to provision Starter workspace" },
            { status },
          );
        }

        console.error("Starter provisioning failed", getStarterProvisioningLogPayload(error));
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
      }
    },
  };
}

async function getAuthenticatedUser(): Promise<StarterAuthUser | null> {
  const serverClient = await createServerClient();
  const { data: { user }, error } = await serverClient.auth.getUser();
  if (error || !user) return null;
  return user as Pick<User, "id" | "email" | "user_metadata">;
}

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const route = createProvisionStarterRouteHandler({
  getAuthenticatedUser,
  getAdminClient,
  sendWelcomeEmail: sendOnboardingWelcomeEmail,
  appUrl: getAppUrl,
});

export const POST = route.POST;

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function logProvisioningWarnings(
  warnings: Array<{ code: string; stage: string; message: string; supabase: unknown }>,
) {
  for (const warning of warnings) {
    console.warn("Starter provisioning warning", warning);
  }
}
