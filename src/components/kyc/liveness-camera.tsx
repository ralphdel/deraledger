"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { X, Camera, RefreshCw, Check, AlertTriangle, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LivenessCameraProps {
  onComplete: (images: string[]) => void; // Keep as string[] for backwards compatibility, but it will only contain 1 image!
  onCancel: () => void;
  onFallback: (errorReason: string) => void;
}

export function LivenessCamera({ onComplete, onCancel, onFallback }: LivenessCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null); // base64 representation

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startStream = useCallback(async () => {
    setIsInitializing(true);
    setError(null);
    setCapturedImage(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your browser or device does not support camera access.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Wait until metadata is loaded to play
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch((err) => console.log("Play failed:", err));
        };
      }
      setIsInitializing(false);
    } catch (err: any) {
      setIsInitializing(false);
      const reason =
        err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
          ? "Camera permission was denied. Please allow camera access in your settings."
          : err.message || "Failed to initialize camera.";
      setError(reason);
    }
  }, []);

  useEffect(() => {
    startStream();
    return () => {
      stopStream();
    };
  }, [startStream, stopStream]);

  const handleCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw the current video frame onto the canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Capture as JPEG base64 string
    const b64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
    setCapturedImage(b64);
    
    // Stop the camera stream to save resources while previewing
    stopStream();
  };

  const handleRetake = () => {
    setCapturedImage(null);
    startStream();
  };

  const handleConfirm = () => {
    if (capturedImage) {
      stopStream();
      onComplete([capturedImage]); // Pass as array containing 1 string to preserve backward signature
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-red-50/50 border border-red-200 rounded-2xl text-center max-w-md mx-auto">
        <AlertTriangle className="h-10 w-10 text-red-500 mb-3" />
        <h3 className="font-bold text-red-950 mb-2">Camera Access Required</h3>
        <p className="text-xs text-red-800 mb-6 leading-relaxed">
          {error} To continue business onboarding, you can upload a direct selfie file instead.
        </p>
        <div className="flex gap-3 w-full justify-center">
          <Button variant="outline" size="sm" onClick={onCancel} className="text-xs font-bold">
            Cancel
          </Button>
          <Button size="sm" onClick={() => onFallback(error)} className="bg-[#7B2FF7] hover:bg-[#6F2CFF] text-white border-0 text-xs font-bold">
            Use File Upload
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-neutral-900 to-neutral-950 rounded-2xl overflow-hidden border border-neutral-800 shadow-2xl relative w-full max-w-md mx-auto">
      {/* Header */}
      <div className="absolute top-0 inset-x-0 p-4 flex justify-between items-center z-20 bg-gradient-to-b from-black/85 to-transparent">
        <span className="text-white font-bold text-sm tracking-tight flex items-center gap-1.5 drop-shadow-md">
          <Camera className="h-4 w-4 text-[#7B2FF7]" />
          Identity Selfie Verification
        </span>
        <button
          onClick={() => {
            stopStream();
            onCancel();
          }}
          className="text-white/70 hover:text-white bg-white/10 hover:bg-white/20 backdrop-blur-md p-1.5 rounded-full transition-all border border-white/5"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Video / Preview Feed */}
      <div className="relative aspect-[3/4] bg-black flex items-center justify-center overflow-hidden">
        {isInitializing && !capturedImage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-10 bg-neutral-950/80 backdrop-blur-md">
            <RefreshCw className="h-8 w-8 text-[#7B2FF7] animate-spin mb-3" />
            <span className="text-xs font-medium tracking-wide">Activating secure camera...</span>
          </div>
        )}

        {capturedImage ? (
          // Display Preview
          <img
            src={`data:image/jpeg;base64,${capturedImage}`}
            alt="Selfie Preview"
            className="w-full h-full object-cover scale-x-[-1]"
          />
        ) : (
          // Display Video Stream
          <video
            ref={videoRef}
            className="w-full h-full object-cover scale-x-[-1]"
            playsInline
            muted
            autoPlay
          />
        )}

        {/* Circular Face framing guide (only shown when scanning/taking picture) */}
        {!capturedImage && !isInitializing && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-8 z-10">
            <div className="w-[220px] h-[280px] rounded-[110px] shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] border-2 border-dashed border-white/45" />
          </div>
        )}

        {/* Framing Instructions Overlay */}
        {!isInitializing && (
          <div className="absolute bottom-4 inset-x-0 z-10 flex flex-col items-center gap-2 px-4 pointer-events-none">
            <div className="bg-black/60 backdrop-blur-md border border-white/5 rounded-full px-4 py-1.5 text-center">
              <p className="text-white text-[11px] font-bold tracking-wide">
                {capturedImage ? "Verify your selfie preview" : "Center your face in the oval frame"}
              </p>
            </div>
          </div>
        )}

        {/* Hidden Canvas */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Footer Controls */}
      <div className="bg-neutral-950 p-4 border-t border-white/5">
        {capturedImage ? (
          // Review Controls
          <div className="flex gap-3 justify-center">
            <Button
              onClick={handleRetake}
              variant="outline"
              size="sm"
              className="w-full border-neutral-800 text-neutral-300 hover:text-white hover:bg-neutral-900 rounded-xl py-2 font-bold text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-2" /> Retake Photo
            </Button>
            <Button
              onClick={handleConfirm}
              size="sm"
              className="w-full bg-[#7B2FF7] hover:bg-[#6F2CFF] text-white border-0 rounded-xl py-2 font-bold text-xs"
            >
              <Check className="h-3.5 w-3.5 mr-2" /> Confirm & Continue
            </Button>
          </div>
        ) : (
          // Take Photo Controls
          <div className="flex justify-center">
            <button
              onClick={handleCapture}
              disabled={isInitializing}
              className="w-14 h-14 rounded-full bg-white border-4 border-neutral-800 hover:scale-105 active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center shadow-lg"
              title="Capture Photo"
            >
              <div className="w-10 h-10 rounded-full bg-[#7B2FF7] flex items-center justify-center">
                <Camera className="h-5 w-5 text-white" />
              </div>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
