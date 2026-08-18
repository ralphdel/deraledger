type RecoverableAuthUser = {
  user_metadata?: Record<string, unknown> | null;
} | null | undefined;

export function isRecoverableStarterUser(user: RecoverableAuthUser) {
  const plan = normalizeText(user?.user_metadata?.plan)?.toLowerCase();
  const businessName = normalizeText(user?.user_metadata?.business_name);
  return plan === "starter" && Boolean(businessName);
}

export async function requestStarterWorkspaceRecovery(
  fetcher: typeof fetch,
  user: RecoverableAuthUser,
) {
  if (!isRecoverableStarterUser(user)) {
    return { attempted: false as const, repaired: false as const };
  }

  const response = await fetcher("/api/onboarding/provision-starter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  return {
    attempted: true as const,
    repaired: response.ok,
  };
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
