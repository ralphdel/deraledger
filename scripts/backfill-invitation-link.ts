/**
 * scripts/backfill-invitation-link.ts
 *
 * Safe one-time backfill: links the existing business_director_verifications row
 * for PETER DOE to its corresponding director_invitation, and corrects the
 * verification_status to "manual_review" because:
 *   - BVN returned "John Doe / John Doe Tim" — does NOT match "PETER DOE"
 *   - Selfie confidence 62.42% was below the 70% threshold
 *   - The sandbox override bypassed selfie check only; name mismatch is still real
 *
 * Usage:
 *   npx tsx scripts/backfill-invitation-link.ts            # dry run (default)
 *   npx tsx scripts/backfill-invitation-link.ts --apply    # applies changes
 */

import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--apply");

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log(`\n[backfill-invitation-link] Mode: ${DRY_RUN ? "DRY RUN" : "APPLY"}\n`);

  // ── Step 1: Find the merchant ──────────────────────────────────────────────
  const TARGET_MERCHANT_ID = "bfd66cab-3de2-4493-ad6f-ffdd9289f376";
  const { data: merchant, error: mErr } = await sb
    .from("merchants")
    .select("id, business_name, trading_name, subscription_plan, merchant_tier, business_registry_snapshot_id")
    .eq("id", TARGET_MERCHANT_ID)
    .maybeSingle();

  if (mErr || !merchant) {
    console.error("Merchant not found:", mErr?.message);
    process.exit(1);
  }
  console.log(`Merchant: ${merchant.trading_name || merchant.business_name} (${merchant.id})`);
  console.log(`Plan: ${merchant.subscription_plan || merchant.merchant_tier}`);
  console.log(`Snapshot ID: ${merchant.business_registry_snapshot_id}\n`);

  // ── Step 2: Find all director invitations for this merchant ───────────────
  const { data: invitations, error: invErr } = await sb
    .from("director_invitations")
    .select("id, selected_director_name, director_email, status, registry_snapshot_id, created_at")
    .eq("merchant_id", TARGET_MERCHANT_ID)
    .order("created_at", { ascending: false });

  if (invErr) {
    console.error("Error fetching invitations:", invErr.message);
    process.exit(1);
  }

  console.log(`Director invitations (${invitations?.length ?? 0}):`);
  for (const inv of invitations || []) {
    console.log(`  - ${inv.id} | ${inv.selected_director_name} | ${inv.director_email} | status: ${inv.status}`);
  }
  console.log();

  // ── Step 3: Check if invitation_id column exists on business_director_verifications ──
  // We'll perform a quick test select of one row to verify column availability
  const { data: testColData, error: testColErr } = await sb
    .from("business_director_verifications")
    .select("*")
    .limit(1);

  const hasInvitationIdColumn = testColData && testColData.length > 0 && ("invitation_id" in testColData[0]);
  console.log(`DB Column Check: business_director_verifications.invitation_id exists? ${hasInvitationIdColumn ? "YES" : "NO"}`);
  if (!hasInvitationIdColumn) {
    console.log("⚠️ WARNING: business_director_verifications.invitation_id column is missing.");
    console.log("Please run the SQL migration script (supabase/verification_subject_migration.sql) in the Supabase SQL Editor first.\n");
  }

  // ── Step 4: Find all business_director_verifications for this merchant ────
  const selectCols = `id, director_name, verification_status, ${hasInvitationIdColumn ? "invitation_id," : ""} manual_review_required, face_match_score, admin_notes, created_at, normalized_response`;
  const { data: verifications, error: vErr } = await sb
    .from("business_director_verifications")
    .select(selectCols)
    .eq("merchant_id", TARGET_MERCHANT_ID)
    .order("created_at", { ascending: false });

  if (vErr) {
    console.error("Error fetching director verifications:", vErr.message);
    process.exit(1);
  }

  console.log(`Director verifications (${verifications?.length ?? 0}):`);
  for (const v of verifications || []) {
    const invId = hasInvitationIdColumn ? (v as any).invitation_id : "N/A (column missing)";
    console.log(`  - ${v.id} | ${v.director_name} | status: ${v.verification_status} | invitation_id: ${invId}`);
  }
  console.log();

  // ── Step 5: Check existing director_verifications rows ─────────────────────
  const { data: dirVerifications, error: dvErr } = await sb
    .from("director_verifications")
    .select("id, invitation_id, director_name, status, created_at")
    .eq("merchant_id", TARGET_MERCHANT_ID);

  if (dvErr) {
    console.error("Error fetching director_verifications:", dvErr.message);
  } else {
    console.log(`director_verifications rows (${dirVerifications?.length ?? 0}):`);
    for (const dv of dirVerifications || []) {
      console.log(`  - ${dv.id} | ${dv.director_name} | status: ${dv.status} | invitation_id: ${dv.invitation_id}`);
    }
    console.log();
  }

  // ── Step 6: Match and correct verifications ──────────────────────────────
  let patchCount = 0;

  for (const ver of verifications || []) {
    const currentInvId = hasInvitationIdColumn ? (ver as any).invitation_id : null;
    if (hasInvitationIdColumn && currentInvId) {
      console.log(`[SKIP] ${ver.id} (${ver.director_name}) — already linked to invitation ${currentInvId}`);
      continue;
    }

    const verName = String(ver.director_name || "").toUpperCase().trim();
    const matchedInvite = (invitations || []).find(inv => {
      const invName = String(inv.selected_director_name || "").toUpperCase().trim();
      const verTokens = verName.split(/\s+/).filter(t => t.length > 2);
      const invTokens = invName.split(/\s+/).filter(t => t.length > 2);
      return verTokens.some(t => invTokens.includes(t));
    });

    if (!matchedInvite) {
      console.log(`[NO MATCH] ${ver.id} (${ver.director_name}) — no invitation matched by name`);
      continue;
    }

    console.log(`[MATCH] Director verification ${ver.id} (${ver.director_name})`);
    console.log(`        → Invitation ${matchedInvite.id} (${matchedInvite.selected_director_name}, ${matchedInvite.director_email})`);

    // Name matching check
    const normResp = ver.normalized_response as any;
    const bvnData = normResp?.data;
    const bvnFirstName = String(bvnData?.firstName || "").trim();
    const bvnLastName = String(bvnData?.lastName || "").trim();
    const bvnReturnedName = [bvnFirstName, bvnLastName].filter(Boolean).join(" ");
    
    // Mismatch occurs because PETER DOE was invited but returned name is John Doe / John Doe Tim
    const nameMismatch = bvnReturnedName && !bvnReturnedName.toUpperCase().includes("PETER");

    const shouldBeManualReview = ver.verification_status === "verified" && (nameMismatch || ver.face_match_score === null || ver.face_match_score < 70);

    const newStatus = shouldBeManualReview ? "manual_review" : ver.verification_status;
    const newManualReview = shouldBeManualReview ? true : ver.manual_review_required;
    const baseNotes = ver.admin_notes ? ver.admin_notes + " | " : "";
    const newNotes = shouldBeManualReview
      ? `${baseNotes}Backfill correction: status changed from 'verified' to 'manual_review'. BVN returned name "${bvnReturnedName}" does not match invited director "${matchedInvite.selected_director_name}". Sandbox selfie bypass accepted confidence ${ver.face_match_score || "62"}% (threshold 70%).`
      : ver.admin_notes;

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would update business_director_verifications:`);
      if (hasInvitationIdColumn) console.log(`    invitation_id: ${matchedInvite.id}`);
      console.log(`    verification_status: ${ver.verification_status} → ${newStatus}`);
      console.log(`    manual_review_required: ${ver.manual_review_required} → ${newManualReview}`);
      console.log(`    admin_notes: ${newNotes}`);
    } else {
      const updates: any = {
        verification_status: newStatus,
        manual_review_required: newManualReview,
        admin_notes: newNotes,
        updated_at: new Date().toISOString(),
      };
      if (hasInvitationIdColumn) {
        updates.invitation_id = matchedInvite.id;
      }
      
      const { error: updateErr } = await sb
        .from("business_director_verifications")
        .update(updates)
        .eq("id", ver.id);

      if (updateErr) {
        console.error(`  [ERROR] Failed to update business_director_verifications ${ver.id}:`, updateErr.message);
      } else {
        console.log(`  [APPLIED] Updated business_director_verifications ${ver.id} successfully.`);
        patchCount++;
      }

      // Also update director_verifications status to manual_review if it exists
      const { error: dvUpdateErr } = await sb
        .from("director_verifications")
        .update({
          status: newStatus,
          updated_at: new Date().toISOString()
        })
        .eq("invitation_id", matchedInvite.id);

      if (dvUpdateErr) {
        console.error(`  [ERROR] Failed to update director_verifications:`, dvUpdateErr.message);
      } else {
        console.log(`  [APPLIED] Updated director_verifications linked to invitation successfully.`);
      }
    }
    console.log();
  }

  console.log(`\n[backfill-invitation-link] Done. ${DRY_RUN ? "DRY RUN — no changes written." : `${patchCount} record(s) updated.`}`);

  if (DRY_RUN) {
    console.log("\nTo apply changes, run:");
    console.log("  npx tsx scripts/backfill-invitation-link.ts --apply\n");
  }
}

main().catch(err => {
  console.error("[FATAL]", err);
  process.exit(1);
});
