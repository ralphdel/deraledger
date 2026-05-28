"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle, ShieldCheck, XCircle, AlertCircle, Camera, Lock, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { LivenessCamera } from "@/components/kyc/liveness-camera";

type InvitationContext = {
  status: string;
  selectedDirectorName: string;
  businessName: string;
  requesterName?: string | null;
  registeredName?: string | null;
  registrationNumber?: string | null;
  expiresAt: string;
  latestVerification?: {
    id: string;
    status: "pending" | "verified" | "failed" | "manual_review";
    faceMatchScore?: number | null;
    livenessScore?: number | null;
    submittedAt?: string | null;
    updatedAt?: string | null;
  } | null;
};

export default function DirectorApprovalPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [invitation, setInvitation] = useState<InvitationContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [bvn, setBvn] = useState("");
  const [selfieBase64, setSelfieBase64] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [verified, setVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/director-invitations/${token}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.success) throw new Error(data.error || "Invitation not found.");
        setInvitation(data.invitation);
        setVerified(
          data.invitation.status === "verified" ||
          data.invitation.status === "approved" ||
          data.invitation.latestVerification?.status === "verified"
        );
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  const verifyIdentity = async () => {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/director-invitations/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bvn, selfieBase64 }),
      });
      const data = await res.json();
      if (!res.ok && data.status !== "manual_review" && data.status !== "failed") throw new Error(data.error || "Verification failed.");
      if (data.status === "manual_review") {
        setMessage("Identity was submitted for manual review. DeraLedger compliance will review this request.");
        setInvitation((current) => current
          ? {
              ...current,
              latestVerification: {
                id: data.verificationId || "submitted",
                status: "manual_review",
                faceMatchScore: data.faceMatchScore,
                submittedAt: new Date().toISOString(),
              },
            }
          : current);
      } else if (data.status === "failed") {
        setInvitation((current) => current
          ? {
              ...current,
              latestVerification: {
                id: data.verificationId || "submitted",
                status: "failed",
                faceMatchScore: data.faceMatchScore,
                submittedAt: new Date().toISOString(),
              },
            }
          : current);
        setMessage("Identity verification was submitted but could not be completed. Please contact support or wait for compliance review before trying again.");
      } else {
        setVerified(true);
        setInvitation((current) => current
          ? {
              ...current,
              status: "verified",
              latestVerification: {
                id: data.verificationId || "submitted",
                status: "verified",
                faceMatchScore: data.faceMatchScore,
                submittedAt: new Date().toISOString(),
              },
            }
          : current);
        setMessage("Identity verified. You can now approve or reject this workspace request.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (decision: "approved" | "rejected") => {
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/director-invitations/${token}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save your decision.");
      setInvitation((current) => current ? { ...current, status: data.status } : current);
      setMessage(decision === "approved" ? "Approval recorded. The workspace will activate once all verification checks are complete." : "Rejection recorded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your decision.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <main className="min-h-screen grid place-items-center bg-neutral-50 text-sm text-neutral-500">Loading approval request...</main>;
  }

  if (!invitation || error && !invitation) {
    return <main className="min-h-screen grid place-items-center bg-neutral-50 text-sm text-red-600">{error || "Invitation not found."}</main>;
  }

  const locked = ["expired", "cancelled", "approved", "rejected"].includes(invitation.status);
  const latestVerification = invitation.latestVerification || null;
  const verificationSubmitted = Boolean(latestVerification);
  const verificationLocked = verificationSubmitted && latestVerification?.status !== "verified";
  const verificationStatusCopy =
    latestVerification?.status === "manual_review"
      ? "Your identity verification has already been submitted and is waiting for compliance review. For your protection, the BVN and selfie step is locked to prevent duplicate verification charges."
      : latestVerification?.status === "pending"
        ? "Your identity verification has already been submitted and is being processed. For your protection, the BVN and selfie step is locked to prevent duplicate verification charges."
        : latestVerification?.status === "failed"
          ? "Your identity verification was already submitted but could not be completed. The BVN and selfie step is locked to prevent duplicate charges. Please contact support or wait for compliance review."
          : "Your identity has already been verified. The BVN and selfie step is locked to prevent duplicate verification charges.";

  return (
    <main className="min-h-screen bg-neutral-50 px-4 py-8">
      <div className="mx-auto max-w-xl rounded-lg border bg-white shadow-sm">
        <div className="border-b p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-bold text-neutral-950">Director approval</h1>
              <p className="mt-1 text-sm text-neutral-500">{invitation.businessName}</p>
            </div>
            <Badge variant="outline" className="capitalize">{invitation.status.replace(/_/g, " ")}</Badge>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <div className="rounded-lg border bg-neutral-50 p-4 text-sm text-neutral-700">
            <p><strong>{invitation.requesterName || "A requester"}</strong> is setting up this business workspace and needs a listed director to approve live payment activation.</p>
            <div className="mt-3 grid gap-2 text-xs text-neutral-500">
              <span>Director: <strong className="text-neutral-800">{invitation.selectedDirectorName}</strong></span>
              <span>Registry name: <strong className="text-neutral-800">{invitation.registeredName || invitation.businessName}</strong></span>
              <span>Registration number: <strong className="text-neutral-800">{invitation.registrationNumber || "-"}</strong></span>
            </div>
          </div>

          {locked ? (
            <div className="rounded-lg border bg-neutral-50 p-4 text-sm text-neutral-600">
              This invitation is {invitation.status}. No further action is available.
            </div>
          ) : (
            <>
              {!verified && (
                verificationLocked ? (
                  <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                    <div className="flex items-center gap-2 font-bold">
                      {latestVerification?.status === "pending" ? <Clock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                      Verification already submitted
                    </div>
                    <p>{verificationStatusCopy}</p>
                    {latestVerification?.submittedAt && (
                      <p className="text-xs text-amber-700">
                        Submitted: {new Date(latestVerification.submittedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 rounded-lg border p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-neutral-900">
                      <ShieldCheck className="h-4 w-4" />
                      Verify your identity
                    </div>
                    <Input
                      maxLength={11}
                      placeholder="Enter BVN"
                      value={bvn}
                      onChange={(event) => setBvn(event.target.value.replace(/\D/g, ""))}
                      className="font-mono"
                    />
                    {showCamera ? (
                      <LivenessCamera
                        onComplete={(images) => {
                          setSelfieBase64(images[0]);
                          setShowCamera(false);
                        }}
                        onCancel={() => setShowCamera(false)}
                        onFallback={(err) => {
                          setShowCamera(false);
                          setError(`Camera failed: ${err}`);
                        }}
                      />
                    ) : selfieBase64 ? (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700">
                        Selfie captured.
                      </div>
                    ) : (
                      <Button type="button" variant="outline" onClick={() => setShowCamera(true)} className="w-full gap-2">
                        <Camera className="h-4 w-4" />
                        Capture selfie
                      </Button>
                    )}
                    <Button onClick={verifyIdentity} disabled={submitting || bvn.length !== 11 || !selfieBase64} className="w-full bg-neutral-900 text-white hover:bg-neutral-800">
                      {submitting ? "Verifying..." : "Submit identity verification"}
                    </Button>
                  </div>
                )
              )}

              {verified && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                    <div className="flex items-center gap-2 font-bold">
                      <Lock className="h-4 w-4" />
                      Identity verification completed
                    </div>
                    <p className="mt-1 text-xs text-emerald-700">
                      The BVN and selfie step is locked for this invitation to prevent duplicate verification charges.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Button onClick={() => decide("approved")} disabled={submitting} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                      <CheckCircle className="h-4 w-4" />
                      Approve activation
                    </Button>
                    <Button onClick={() => decide("rejected")} disabled={submitting} variant="destructive" className="gap-2">
                      <XCircle className="h-4 w-4" />
                      Reject request
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}

          {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}
          {error && <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}
        </div>
      </div>
    </main>
  );
}
