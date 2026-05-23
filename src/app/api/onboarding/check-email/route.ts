import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const { email } = await request.json();
  if (!email) return NextResponse.json({ exists: false });

  // 1. Check if an active merchant exists with this email
  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (merchant) {
    return NextResponse.json({ exists: true });
  }

  // 2. If no merchant exists, check if there's an orphaned Supabase Auth user
  try {
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const orphan = authUsers?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (orphan) {
      console.log(`Cleaning up orphan auth user: ${orphan.id} for email ${email}`);
      await supabase.auth.admin.deleteUser(orphan.id);
    }
  } catch (e) {
    console.error("Warning: check-email orphan cleanup failed:", e);
  }

  // Since the merchant was deleted, the email is free to use
  return NextResponse.json({ exists: false });
}
