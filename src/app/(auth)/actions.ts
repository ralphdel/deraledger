"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { sendPasswordResetEmail } from "@/lib/brevo";

export async function loginUser(formData: FormData) {
  try {
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const workspaceCode = formData.get("workspace_code") as string;
    
    if (!email || !password) {
      return { success: false, error: "Email and password are required" };
    }

    const supabase = await createClient();
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    if (typeof workspaceCode === "string" && workspaceCode.trim() !== "") {
      const formattedCode = workspaceCode.trim().toUpperCase();
      
      // 1. Find the UUID of the merchant by workspace_code
      const { data: merchantData, error: merchantError } = await supabase
        .from("merchants")
        .select("id")
        .eq("workspace_code", formattedCode)
        .single();
        
      if (merchantError || !merchantData) {
        await supabase.auth.signOut();
        return { success: false, error: "Invalid Workspace Code." };
      }
      
      const merchantId = merchantData.id;

      // 2. Verify team access using the resolved UUID
      const { data: teamData, error: teamError } = await supabase
        .from("merchant_team")
        .select("id, must_change_password, roles(name)")
        .eq("user_id", data.user.id)
        .eq("merchant_id", merchantId)
        .single();
        
      if (teamError || !teamData) {
        await supabase.auth.signOut();
        return { success: false, error: "You do not have access to this business workspace." };
      }
      
      // 3. Check Subscription Status (Feature Locking)
      const { data: subData } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("merchant_id", merchantId)
        .neq("status", "cancelled")
        .single();
        
      if (subData?.status === "expired" && (teamData as any).roles?.name !== "owner") {
        await supabase.auth.signOut();
        return { success: false, error: "Team member access is suspended due to an expired subscription. Please ask the account owner to renew." };
      }
      
      // Check if the user needs to change their password
      if (teamData.must_change_password) {
        // Don't set the workspace cookie yet, force them to set a password first
        return { success: true, mustChangePassword: true, workspace: formattedCode };
      }
      
      // 4. Set the cookie using the raw UUID so the rest of the app doesn't break
      (await cookies()).set("purpledger_workspace_id", merchantId, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 7,
        path: "/",
      });
    } else {
      (await cookies()).delete("purpledger_workspace_id");
    }
    
    revalidatePath("/", "layout");
    return { success: true };
  } catch (err: any) {
    console.error("Server Action loginUser error:", err);
    return { success: false, error: err.message || "An unexpected server error occurred." };
  }
}

export async function registerUser(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const businessName = formData.get("businessName") as string;
  const phone = formData.get("phone") as string;

  if (!email || !password || !businessName) {
    return { success: false, error: "Please fill out all required fields" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        business_name: businessName,
        phone: phone || null,
      },
      // Note: By default in test environments email_confirm might be disabled on Supabase dashboard,
      // but if it's on, the user won't be able to log in until clicking the email link.
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }
  
  revalidatePath("/", "layout");
  return { success: true };
}

export async function logoutUser() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete("purpledger_workspace_id");
  revalidatePath("/", "layout");
}

export async function forgotPasswordAction(email: string) {
  if (!email) return { success: false, error: "Email is required" };

  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const appUrl = configuredUrl || (process.env.NODE_ENV === "production" ? "https://purpledger.vercel.app" : "http://localhost:3000");
  
  // Use service role client to securely generate the reset link without triggering Supabase's rate-limited email
  const { createClient: createSupabaseClient } = await import("@supabase/supabase-js");
  const adminClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo: `${appUrl}/reset-password`,
    }
  });

  if (error) {
    // We swallow "User not found" errors in production to prevent email enumeration,
    // but log it server-side.
    console.error("Link generation error:", error.message);
    return { success: false, error: "If an account exists, a reset link has been sent." };
  }

  // The link generated by Supabase contains the secure token
  const actionLink = data.properties.action_link;

  // Send the branded email via Brevo
  const emailResult = await sendPasswordResetEmail(email, actionLink);
  
  if (!emailResult.success) {
    console.error("Brevo Email Error:", emailResult.error);
    return { success: false, error: "Failed to send the email. Please try again later." };
  }

  return { success: true };
}

export async function completePasswordResetAction(password: string, fullName: string, workspaceCode?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated." };

  const { error: updateError } = await supabase.auth.updateUser({ 
    password,
    data: { full_name: fullName }
  });
  if (updateError) return { success: false, error: updateError.message };

  // Use service role client to bypass RLS
  const { createClient: createSupabaseClient } = await import("@supabase/supabase-js");
  const adminClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error: teamError } = await adminClient
    .from("merchant_team")
    .update({ must_change_password: false, is_active: true })
    .eq("user_id", user.id)
    .eq("must_change_password", true);
    
  if (teamError) {
    console.error("Failed to clear must_change_password flag:", teamError);
  }

  if (workspaceCode && workspaceCode.trim() !== "") {
    const formattedCode = workspaceCode.trim().toUpperCase();
    const { data: merchantData } = await adminClient
      .from("merchants")
      .select("id")
      .eq("workspace_code", formattedCode)
      .single();

    if (merchantData) {
      (await cookies()).set("purpledger_workspace_id", merchantData.id, {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 7,
        path: "/",
      });
    }
  }

  revalidatePath("/", "layout");
  return { success: true };
}
