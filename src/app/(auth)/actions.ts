"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { sendPasswordResetEmail } from "@/lib/brevo";

export async function loginUser(formData: FormData) {
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

  if (workspaceCode && workspaceCode.trim() !== "") {
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
      .select("id, must_change_password")
      .eq("user_id", data.user.id)
      .eq("merchant_id", merchantId)
      .single();
      
    if (teamError || !teamData) {
      await supabase.auth.signOut();
      return { success: false, error: "You do not have access to this business workspace." };
    }
    
    // Check if the user needs to change their password
    if (teamData.must_change_password) {
      // Don't set the workspace cookie yet, force them to set a password first
      return { success: true, mustChangePassword: true };
    }
    
    // 3. Set the cookie using the raw UUID so the rest of the app doesn't break
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://purpledger.vercel.app";
  const supabase = await createClient();

  // Generate Supabase reset link (secure token based)
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/reset-password`,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  // Supabase will send its default email if enabled, but we also send our branded one
  await sendPasswordResetEmail(email, `${appUrl}/reset-password`);

  return { success: true };
}
