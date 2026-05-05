import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(10);
    
  console.log("Latest subscriptions:");
  console.table(data);

  const { data: merchants } = await supabase
    .from("merchants")
    .select("id, email, subscription_plan")
    .limit(5);
  console.log("Merchants:", merchants);
}

run();
