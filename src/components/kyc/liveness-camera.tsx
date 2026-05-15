"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { X, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

const LIVENESS_STEPS = [
  {
    id: "center",
    title: "Center Face",
    instruction: "Position your face inside the oval",
    hint: "Look straight at the camera",
  },
  {
    id: "left",
    title: "Turn Left",
    instruction: "Slowly turn your head to the left",
    hint: "Keep your face in the oval",
  },
  {
    id: "right",
    title: "Turn Right",
    instruction: "Slowly turn your head to the right",
    hint: "Keep your face in the oval",
  },
];

// How long face must be "detected" before auto-capture (ms)
const HOLD_DURATION = 1800;
// Interval between frame samples (ms)
const SAMPLE_INTERVAL = 120;
// Min pixel brightness variance to consider "face present"
const MIN_VARIANCE = 800;

interface LivenessCameraProps {
  onComplete: (images: string[]) => void;
  onCancel: () => void;
  onFallback: (errorReason: string) => void;
}

export function LivenessCamera({ onComplete, onCancel, onFallback }: LivenessCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sampleRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sampleIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [currentStep, setCurrentStep] = useState(0);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  // Detection state: null = scanning, false = no face, true = face detected
  const [faceDetected, setFaceDetected] = useState<boolean | null>(null);
  // Progress 0–100 for the hold ring
  const [holdProgress, setHoldProgress] = useState(0);
  const [justCaptured, setJustCaptured] = useState(false);
  const [stepDone, setStepDone] = useState(false);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
    if (sampleIntervalRef.current) { clearInterval(sampleIntervalRef.current); sampleIntervalRef.current = null; }
  }, []);

  // Lightweight face presence heuristic: sample centre oval pixels, check variance
  const checkFacePresence = useCallback((): boolean => {
    const video = videoRef.current;
    const canvas = sampleRef.current;
    if (!video || !canvas || video.readyState < 2) return false;

    const W = 80, H = 100;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    // Sample the centre of the video (where the face oval is)
    const sx = (video.videoWidth - W) / 2;
    const sy = (video.videoHeight - H) / 2;
    ctx.drawImage(video, sx, sy, W, H, 0, 0, W, H);

    const data = ctx.getImageData(0, 0, W, H).data;
    let sum = 0, sumSq = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Luminance
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sum += lum; sumSq += lum * lum; n++;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    return variance > MIN_VARIANCE;
  }, []);

  const captureFrame = useCallback((step: number, prevImages: string[]): string[] => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return prevImages;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return prevImages;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const b64 = canvas.toDataURL("image/jpeg", 0.82).split(",")[1];
    return [...prevImages, b64];
  }, []);

  const startDetectionLoop = useCallback((step: number, images: string[]) => {
    clearTimers();
    setFaceDetected(null);
    setHoldProgress(0);
    setStepDone(false);

    let holdStart: number | null = null;

    sampleIntervalRef.current = setInterval(() => {
      const present = checkFacePresence();
      setFaceDetected(present);

      if (present) {
        if (holdStart === null) holdStart = Date.now();
        const elapsed = Date.now() - holdStart;
        const progress = Math.min(100, (elapsed / HOLD_DURATION) * 100);
        setHoldProgress(progress);

        if (elapsed >= HOLD_DURATION) {
          clearTimers();
          setStepDone(true);
          setJustCaptured(true);

          const newImages = captureFrame(step, images);

          setTimeout(() => {
            setJustCaptured(false);
            if (step < LIVENESS_STEPS.length - 1) {
              const nextStep = step + 1;
              setCurrentStep(nextStep);
              setCapturedImages(newImages);
              // Small delay between steps for UX
              setTimeout(() => startDetectionLoop(nextStep, newImages), 600);
            } else {
              stopStream();
              onComplete(newImages);
            }
          }, 700);
        }
      } else {
        holdStart = null;
        setHoldProgress(0);
      }
    }, SAMPLE_INTERVAL);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkFacePresence, captureFrame, clearTimers, stopStream, onComplete]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera not supported.");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setIsInitializing(false);
        // Small warm-up delay before starting detection
        setTimeout(() => startDetectionLoop(0, []), 800);
      } catch (err: any) {
        if (!mounted) return;
        setIsInitializing(false);
        const reason = err.name === "NotAllowedError" ? "Camera permission denied." : "No camera detected or supported.";
        setError(reason);
      }
    }

    init();
    return () => {
      mounted = false;
      clearTimers();
      stopStream();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRestart = () => {
    setCurrentStep(0);
    setCapturedImages([]);
    setFaceDetected(null);
    setHoldProgress(0);
    setStepDone(false);
    startDetectionLoop(0, []);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-red-50 border border-red-200 rounded-xl text-center">
        <AlertTriangle className="h-10 w-10 text-red-500 mb-3" />
        <h3 className="font-bold text-red-900 mb-2">Camera Access Failed</h3>
        <p className="text-sm text-red-700 mb-6 max-w-sm">
          {error} We will switch you to manual file upload so you can still complete KYC.
        </p>
        <div className="flex gap-3">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => onFallback(error)}>Use File Upload Instead</Button>
        </div>
      </div>
    );
  }

  const step = LIVENESS_STEPS[currentStep];
  // SVG ring params
  const R = 42, CIRC = 2 * Math.PI * R;
  const strokeDash = CIRC - (holdProgress / 100) * CIRC;

  const detectionLabel = justCaptured
    ? "✓ Captured!"
    : faceDetected === null
    ? "Initializing..."
    : faceDetected
    ? holdProgress > 50 ? "Hold still..." : "Face detected ✓"
    : "Position your face in the oval";

  const detectionColor = justCaptured
    ? "text-emerald-400"
    : faceDetected
    ? "text-emerald-300"
    : "text-neutral-400";

  return (
    <div className="bg-gradient-to-br from-indigo-950 via-purp-950 to-neutral-950 rounded-2xl overflow-hidden border border-purp-800/50 shadow-2xl relative">
      {/* Header */}
      <div className="absolute top-0 inset-x-0 p-4 flex justify-between items-center z-10 bg-gradient-to-b from-black/80 to-transparent">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-r from-purp-600 to-indigo-600 text-white text-[10px] font-bold px-3 py-1.5 rounded-full uppercase tracking-wider">
            Step {currentStep + 1} / {LIVENESS_STEPS.length}
          </div>
          <span className="text-white font-semibold text-sm drop-shadow-md">{step.title}</span>
        </div>
        <button
          onClick={onCancel}
          className="text-white/70 hover:text-white bg-white/10 hover:bg-white/20 backdrop-blur-md p-2 rounded-full transition-all border border-white/10"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Video Feed */}
      <div className="relative aspect-[3/4] sm:aspect-video bg-black flex items-center justify-center overflow-hidden">
        {isInitializing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-purp-300 z-10 bg-indigo-950/70 backdrop-blur-md">
            <div className="w-10 h-10 border-2 border-purp-400 border-t-transparent rounded-full animate-spin mb-3" />
            <span className="text-sm font-medium tracking-wide">Activating secure camera...</span>
          </div>
        )}

        <video
          ref={videoRef}
          className="w-full h-full object-cover scale-x-[-1] transition-opacity duration-700"
          style={{ opacity: isInitializing ? 0 : 1 }}
          playsInline muted autoPlay
        />

        {/* Face oval + auto-progress ring */}
        {!isInitializing && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-8 z-20">
            <div className="relative flex items-center justify-center">
              {/* Dark surround */}
              <div className="w-[240px] h-[300px] rounded-[120px] shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />

              {/* SVG progress ring */}
              <svg
                className="absolute"
                width="280" height="340"
                viewBox="-20 -20 280 340"
                style={{ overflow: "visible" }}
              >
                {/* Base ring */}
                <ellipse
                  cx="120" cy="150" rx="130" ry="162"
                  fill="none"
                  stroke={faceDetected ? "rgba(52,211,153,0.3)" : "rgba(255,255,255,0.15)"}
                  strokeWidth="3"
                />
                {/* Progress ring */}
                {holdProgress > 0 && (
                  <ellipse
                    cx="120" cy="150" rx="130" ry="162"
                    fill="none"
                    stroke="#34d399"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 150}`}
                    strokeDashoffset={`${2 * Math.PI * 150 * (1 - holdProgress / 100)}`}
                    style={{ transition: "stroke-dashoffset 0.1s linear" }}
                    transform="rotate(-90 120 150)"
                  />
                )}
              </svg>

              {/* Capture flash */}
              {justCaptured && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-[240px] h-[300px] rounded-[120px] bg-white/20 animate-ping-once" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Instruction overlay */}
        {!isInitializing && (
          <div className="absolute bottom-4 inset-x-0 z-30 flex flex-col items-center gap-2 px-4">
            <div className="bg-black/60 backdrop-blur-md border border-white/10 rounded-xl px-5 py-3 text-center max-w-xs">
              <p className="text-white text-sm font-bold">{step.instruction}</p>
              <p className="text-neutral-400 text-xs mt-1">{step.hint}</p>
            </div>
            <p className={`text-sm font-semibold transition-colors duration-300 ${detectionColor}`}>
              {detectionLabel}
            </p>
          </div>
        )}

        {/* Hidden canvases */}
        <canvas ref={canvasRef} className="hidden" />
        <canvas ref={sampleRef} className="hidden" />
      </div>

      {/* Footer */}
      <div className="bg-neutral-950/90 backdrop-blur-xl p-5 flex items-center justify-between border-t border-white/5">
        {/* Step dots */}
        <div className="flex gap-2">
          {LIVENESS_STEPS.map((_, idx) => (
            <div
              key={idx}
              className={`h-2 rounded-full transition-all duration-500 ${
                idx < currentStep ? "bg-emerald-500 w-8 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                : idx === currentStep ? "bg-gradient-to-r from-purp-400 to-indigo-400 w-12 shadow-[0_0_10px_rgba(167,139,250,0.5)]"
                : "bg-white/10 w-6"
              }`}
            />
          ))}
        </div>

        {/* Auto-detect indicator */}
        <div className="flex flex-col items-center gap-1">
          <div className={`w-3 h-3 rounded-full transition-colors duration-300 ${
            justCaptured ? "bg-emerald-400 animate-pulse" : faceDetected ? "bg-emerald-500" : "bg-neutral-600"
          }`} />
          <span className="text-neutral-500 text-[10px] uppercase tracking-wider">Auto</span>
        </div>

        {/* Restart */}
        <Button
          variant="ghost"
          size="sm"
          className="text-neutral-400 hover:text-white hover:bg-white/10 rounded-full px-4"
          onClick={handleRestart}
          disabled={isInitializing}
        >
          <RefreshCw className="h-4 w-4 mr-2" /> Restart
        </Button>
      </div>
    </div>
  );
}
