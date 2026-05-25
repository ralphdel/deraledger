"use client";

import React, { useState } from "react";
import { X, Shield, Camera, CheckCircle, Clock, AlertTriangle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { LivenessCamera } from "./liveness-camera";
import { verifyDirectorAction } from "@/lib/actions";

interface DirectorSelfieModalProps {
  merchantId: string;
  businessVerificationId?: string;
  directorName: string;
  directorRole: "director" | "shareholder" | "beneficial_owner" | "signatory" | "proprietor" | "partner" | "trustee";
  onClose: () => void;
  onSuccess: () => void;
}

export default function DirectorSelfieModal({
  merchantId,
  businessVerificationId,
  directorName,
  directorRole,
  onClose,
  onSuccess,
}: DirectorSelfieModalProps) {
  const [bvn, setBvn] = useState("");
  const [isBvnLocked, setIsBvnLocked] = useState(false);
  const [selfieBase64, setSelfieBase64] = useState<string | null>(null);
  
  const [showCamera, setShowCamera] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleBvnLock = () => {
    if (bvn.length === 11) {
      setIsBvnLocked(true);
      setError(null);
    } else {
      setError("BVN must be exactly 11 digits.");
    }
  };

  const handleVerify = async () => {
    if (!bvn || !selfieBase64) {
      setError("Both BVN and Selfie are required for identity check.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await verifyDirectorAction({
        merchantId,
        businessVerificationId,
        directorName,
        directorRole,
        bvn,
        selfieBase64,
      });

      if (result.success || result.status === "manual_review") {
        setSuccess(true);
        setTimeout(() => {
          onSuccess();
          onClose();
        }, 2000);
      } else {
        setError(result.error || "Identity check failed. Please ensure the BVN is correct.");
        setIsBvnLocked(false);
        setSelfieBase64(null);
      }
    } catch (err: any) {
      setError(err?.message || "An unexpected error occurred during verification.");
    } finally {
      setSubmitting(false);
    }
  };

  const roleLabels: Record<string, string> = {
    director: "Director",
    shareholder: "Shareholder",
    beneficial_owner: "Beneficial Owner",
    signatory: "Authorized Signatory",
    proprietor: "Proprietor",
    partner: "Partner",
    trustee: "Trustee",
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl overflow-hidden shadow-2xl border border-neutral-200 w-full max-w-md animate-in zoom-in duration-200">
        
        {/* Header */}
        <div className="p-5 border-b flex justify-between items-center bg-neutral-50">
          <div>
            <h3 className="font-bold text-neutral-900 flex items-center gap-1.5">
              <Shield className="h-5 w-5 text-[#7B2FF7]" />
              Verify Director Identity
            </h3>
            <span className="text-[10px] font-bold bg-[#E9D5FF] text-[#6F2CFF] px-2 py-0.5 rounded uppercase mt-1 inline-block">
              {roleLabels[directorRole] || "Director"}
            </span>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 p-1 rounded-full">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="bg-neutral-50 rounded-xl p-3 border text-xs text-neutral-600 leading-relaxed">
            Verify the legal identity of <strong className="text-neutral-900">{directorName}</strong> by providing their BVN and completing a live selfie match.
          </div>

          {success ? (
            <div className="py-6 flex flex-col items-center justify-center text-center gap-3">
              <CheckCircle className="h-12 w-12 text-emerald-500 animate-bounce" />
              <span className="font-bold text-emerald-800 text-sm">Identity Submitted successfully!</span>
              <p className="text-xs text-emerald-600 max-w-xs leading-relaxed">
                Face match and name lookup logs have been successfully stored. Admin will review the profile shortly.
              </p>
            </div>
          ) : showCamera ? (
            <LivenessCamera
              onComplete={(images) => {
                setSelfieBase64(images[0]);
                setShowCamera(false);
                setError(null);
              }}
              onCancel={() => setShowCamera(false)}
              onFallback={(err) => {
                setShowCamera(false);
                setError(`Camera failed: ${err}`);
              }}
            />
          ) : (
            <div className="space-y-4">
              {/* BVN */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-neutral-500">Bank Verification Number (BVN)</Label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    maxLength={11}
                    placeholder="22XXXXXXXXX"
                    value={bvn}
                    onChange={(e) => setBvn(e.target.value.replace(/\D/g, ""))}
                    disabled={isBvnLocked}
                    className="h-11 border-2 focus:ring-[#7B2FF7] font-mono text-sm"
                  />
                  {!isBvnLocked ? (
                    <Button onClick={handleBvnLock} disabled={bvn.length !== 11} className="bg-[#7B2FF7] hover:bg-[#6F2CFF] h-11 text-white text-xs font-bold">
                      Lock BVN
                    </Button>
                  ) : (
                    <Button onClick={() => setIsBvnLocked(false)} variant="outline" className="h-11 text-xs">
                      Edit
                    </Button>
                  )}
                </div>
              </div>

              {/* Selfie */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase text-neutral-500">Facial Selfie Capture</Label>
                {!isBvnLocked ? (
                  <div className="p-4 bg-neutral-50 border border-dashed rounded-xl text-center text-xs text-neutral-400">
                    Please enter and lock the director's BVN to unlock selfie capture.
                  </div>
                ) : selfieBase64 ? (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                    <span className="text-xs text-emerald-800 font-bold flex items-center gap-1.5">
                      <CheckCircle className="h-4 w-4 text-emerald-500" /> Photo Captured Successfully!
                    </span>
                    <Button onClick={() => setSelfieBase64(null)} variant="ghost" size="xs" className="text-xs text-neutral-500 hover:text-red-600">
                      Reset
                    </Button>
                  </div>
                ) : (
                  <Button onClick={() => setShowCamera(true)} variant="outline" className="w-full h-12 border-2 border-dashed border-neutral-300 hover:border-[#7B2FF7]/50 text-neutral-600 font-bold text-xs flex gap-2">
                    <Camera className="h-4 w-4 text-neutral-400" /> Start Selfie Capture
                  </Button>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-xs text-red-700 flex items-start gap-2 leading-relaxed">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <div className="pt-2">
                <Button
                  onClick={handleVerify}
                  disabled={submitting || !isBvnLocked || !selfieBase64}
                  className="w-full h-11 bg-neutral-900 hover:bg-neutral-800 text-white font-bold text-sm"
                >
                  {submitting ? "Processing Verification..." : "Verify Director Identity"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
