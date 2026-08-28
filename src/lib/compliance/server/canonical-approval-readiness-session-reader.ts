import "server-only";

import { createClient } from "../../supabase/server";

type MinimalServerSessionUser = {
  id: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
};

type CookieBoundAuthClient = {
  auth: {
    getUser(): Promise<{ data: { user: unknown | null }; error: unknown | null }>;
  };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toMinimalServerSessionUser(value: unknown): MinimalServerSessionUser | null {
  if (!isRecord(value) || typeof value.id !== "string" || !UUID.test(value.id.trim())) return null;
  if (!isRecord(value.app_metadata) || !isRecord(value.user_metadata)) return null;
  return {
    id: value.id.trim(),
    app_metadata: { ...value.app_metadata },
    user_metadata: { ...value.user_metadata },
  };
}

/**
 * Provides the resolver's sole concrete session seam. This module only reads
 * the cookie-bound Auth user; reviewer authority remains the resolver's job.
 */
export function createCanonicalApprovalReadinessSessionReader(): {
  readAuthenticatedServerSessionUser(): Promise<MinimalServerSessionUser | null>;
} {
  return {
    async readAuthenticatedServerSessionUser(): Promise<MinimalServerSessionUser | null> {
      try {
        const client = await createClient() as unknown as CookieBoundAuthClient;
        const response = await client.auth.getUser();
        if (response.error) return null;
        return toMinimalServerSessionUser(response.data.user);
      } catch {
        return null;
      }
    },
  };
}
