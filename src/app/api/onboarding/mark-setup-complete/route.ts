import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: merchant } = await supabase
      .from("merchants")
      .select("id, email")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let query = supabase
      .from("payment_records")
      .update({
        processing_status: "active",
        account_setup_status: "active",
        setup_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("payment_purpose", "plan_subscription")
      .in("account_setup_status", ["paid_pending_setup", "active_pending_password", "account_setup_completed"]);

    if (merchant?.id) {
      query = query.eq("merchant_id", merchant.id);
    } else {
      query = query.eq("customer_email", user.email || "");
    }

    const { error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update setup status." },
      { status: 500 }
    );
  }
}
