"use client";

import React, { useEffect, useRef, useState } from "react";
import { Camera, X, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const LIVENESS_STEPS = [
  { id: "straight", title: "Straight Face", instruction: "Look directly at the camera with a neutral expression." },
  { id: "smile", title: "Smile", instruction: "Smile widely showing your teeth." },
  { id: "mouth_open", title: "Open Mouth", instruction: "Open your mouth slightly." }
];

interface LivenessCameraProps {
  onComplete: (images: string[]) => void;
  onCancel: () => void;
  onFallback: (errorReason: string) => void;
}

export function LivenessCamera({ onComplete, onCancel, onFallback }: LivenessCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Initialize camera
  useEffect(() => {
    let activeStream: MediaStream | null = null;

    async function setupCamera() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Your browser does not support camera access.");
        }

        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        
        activeStream = mediaStream;
        setStream(mediaStream);
        
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          const playPromise = videoRef.current.play();
          if (playPromise !== undefined) {
            playPromise.catch((e) => {
              console.warn("Video play interrupted by load request:", e);
            });
          }
        }
        setIsInitializing(false);
      } catch (err: any) {
        console.error("Camera access error:", err);
        setIsInitializing(false);
        const reason = err.name === "NotAllowedError" 
          ? "Camera permission denied." 
          : "No camera detected or supported.";
        setError(reason);
      }
    }

    setupCamera();

    // Cleanup on unmount
    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // Draw the current video frame onto the canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Extract base64 image (JPEG, 80% quality)
    const base64Data = canvas.toDataURL("image/jpeg", 0.8);
    // Strip the "data:image/jpeg;base64," prefix for consistency with backend expectations
    const base64Clean = base64Data.split(",")[1];
    
    const newImages = [...capturedImages, base64Clean];
    setCapturedImages(newImages);
    
    if (currentStep < LIVENESS_STEPS.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      // Finished all steps
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      onComplete(newImages);
    }
  };

  const handleRetry = () => {
    // Retry the entire sequence if they want
    setCapturedImages([]);
    setCurrentStep(0);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-red-50 border border-red-200 rounded-xl text-center">
        <AlertTriangle className="h-10 w-10 text-red-500 mb-3" />
        <h3 className="font-bold text-red-900 mb-2">Camera Access Failed</h3>
        <p className="text-sm text-red-700 mb-6 max-w-sm">
          {error} We will switch you back to the manual file upload method so you can still complete KYC.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onFallback(error)}>Use File Upload Instead</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-indigo-950 via-purp-950 to-neutral-950 rounded-2xl overflow-hidden border border-purp-800/50 shadow-2xl relative shadow-purp-900/20">
      {/* Header */}
      <div className="absolute top-0 inset-x-0 p-4 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-r from-purp-600 to-indigo-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider shadow-lg">
            Step {currentStep + 1} / 3
          </div>
          <span className="text-white font-semibold text-sm drop-shadow-md">
            {LIVENESS_STEPS[currentStep]?.title}
          </span>
        </div>
        <button onClick={onCancel} className="text-white/70 hover:text-white bg-white/10 hover:bg-white/20 backdrop-blur-md p-2 rounded-full transition-all duration-200 border border-white/10">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Video Feed */}
      <div className="relative aspect-[3/4] sm:aspect-video bg-black flex items-center justify-center overflow-hidden">
        {isInitializing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-purp-300 z-10 bg-indigo-950/50 backdrop-blur-md">
            <Camera className="h-10 w-10 animate-bounce mb-3 text-purp-400" />
            <span className="text-sm font-medium tracking-wide">Initializing secure camera...</span>
          </div>
        )}
        
        <video 
          ref={videoRef}
          className="w-full h-full object-cover transform scale-x-[-1] transition-opacity duration-700 ease-in-out" // Mirror the video for natural feel
          style={{ opacity: isInitializing ? 0 : 1 }}
          playsInline
          muted
          autoPlay
        />
        
        {/* Face Guide Overlay */}
        {!isInitializing && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-8 z-20">
            <div className="w-full max-w-[280px] aspect-[3/4] rounded-[120px] shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] transition-all duration-500 relative border-2 border-white/20 backdrop-blur-[2px]">
              {/* Scanline animation effect */}
              <div className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-purp-400 to-transparent opacity-50 animate-scanline" />
              
              <div className="absolute -bottom-20 inset-x-0 text-center">
                <div className="inline-block bg-black/60 backdrop-blur-md border border-white/10 rounded-xl px-4 py-3 shadow-xl">
                  <p className="text-white text-base font-bold drop-shadow-md">
                    {LIVENESS_STEPS[currentStep]?.instruction}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Hidden Canvas for capturing frames */}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Footer Controls */}
      <div className="bg-neutral-950/90 backdrop-blur-xl p-6 flex items-center justify-between border-t border-white/5 z-30 relative">
        <div className="flex gap-2">
          {LIVENESS_STEPS.map((_, idx) => (
            <div 
              key={idx} 
              className={`h-2 rounded-full transition-all duration-500 ${
                idx < currentStep ? 'bg-emerald-500 w-8 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 
                idx === currentStep ? 'bg-gradient-to-r from-purp-400 to-indigo-400 w-12 shadow-[0_0_10px_rgba(167,139,250,0.5)]' : 'bg-white/10 w-6'
              }`} 
            />
          ))}
        </div>
        
        <Button 
          onClick={handleCapture} 
          disabled={isInitializing}
          size="lg"
          className="relative group rounded-full w-20 h-20 p-0 bg-white hover:bg-neutral-200 border-4 border-purp-200 text-purp-900 transition-all duration-200 active:scale-95 shadow-[0_0_25px_rgba(255,255,255,0.4)]"
        >
          {/* Inner pulse ring */}
          <div className="absolute inset-0 rounded-full border-4 border-purp-500 opacity-0 group-hover:opacity-100 group-hover:animate-ping" />
          <Camera className="h-8 w-8" />
          <span className="sr-only">Capture</span>
        </Button>
        
        <Button 
          variant="ghost" 
          size="sm" 
          className="text-neutral-400 hover:text-white hover:bg-white/10 backdrop-blur-sm rounded-full px-4"
          onClick={handleRetry}
          disabled={currentStep === 0 || isInitializing}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Restart
        </Button>
      </div>
    </div>
  );
}
