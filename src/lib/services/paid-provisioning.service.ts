import type { SupabaseClient } from "@supabase/supabase-js";

export class PaidProvisioningError extends Error {
  constructor(
    public readonly stage: "role_lookup" | "membership_lookup" | "membership_write",
    message: string,
  ) {
    super(message);
    this.name = "PaidProvisioningError";
  }
}

export async function ensurePaidCreatorMembership(
  supabase: SupabaseClient,
  input: { merchantId: string; userId: string },
) {
  const { data: role, error: roleError } = await supabase
    .from("roles")
    .select("id")
    .eq("name", "admin")
    .eq("is_system_role", true)
    .limit(1)
    .maybeSingle();

  if (roleError || !role?.id) {
    throw new PaidProvisioningError(
      "role_lookup",
      "Paid workspace creator role could not be resolved.",
    );
  }

  const { data: membership, error: membershipError } = await supabase
    .from("merchant_team")
    .select("id")
    .eq("merchant_id", input.merchantId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (membershipError) {
    throw new PaidProvisioningError(
      "membership_lookup",
      "Paid workspace membership could not be verified.",
    );
  }

  const values = {
    role_id: role.id,
    is_active: true,
    must_change_password: true,
  };

  const write = membership?.id
    ? await supabase.from("merchant_team").update(values).eq("id", membership.id)
    : await supabase.from("merchant_team").insert({
        merchant_id: input.merchantId,
        user_id: input.userId,
        ...values,
      });

  if (write.error) {
    throw new PaidProvisioningError(
      "membership_write",
      "Paid workspace membership could not be provisioned.",
    );
  }

  return { roleId: role.id, membershipId: membership?.id || null };
}
