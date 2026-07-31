"use server";

export async function verifyAdminPassword() {
  // Deprecated: admin passwords must not be passed as Server Action arguments,
  // because development action traces can include serialized arguments.
  // Use POST /api/admin-login instead.
  return false;
}
