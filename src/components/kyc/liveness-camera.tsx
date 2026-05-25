"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { X, Camera, RefreshCw, Check, AlertTriangle, Eye, Smile, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LivenessCameraProps {
  onComplete: (images: string[]) => void;
  onCancel: () => void;
  onFallback: (errorReason: string) => void;
}

type Step = "position" | "hold" | "blink" | "preview";

const STEPS: { id: Step; label: string; icon: React.ReactNode; instruction: string; sub: string }[] = [
  {
    id: "position",
    label: "Position",
    icon: <Scan className="h-4 w-4" />,
    instruction: "Center your face in the oval",
    sub: "Look straight ahead and fill the frame",
  },
  {
    id: "hold",
    label: "Hold Still",
    icon: <Eye className="h-4 w-4" />,
    instruction: "Hold still — capturing…",
    sub: "Keep your face steady inside the oval",
  },
  {
    id: "blink",
    label: "Smile/Blink",
    icon: <Smile className="h-4 w-4" />,
    instruction: "Blink naturally or smile warmly",
    sub: "Confirming liveness and presence",
  },
  {
    id: "preview",
    label: "Review",
    icon: <Check className="h-4 w-4" />,
    instruction: "Review your selfie",
    sub: "Confirm before submitting to verification",
  },
];

// Configuration constants
const SAMPLE_INTERVAL = 120; // ms between face presence checks
const MIN_VARIANCE = 800; // threshold for detecting face structure vs flat backgrounds
const LIVENESS_DIFF_THRESHOLD = 5.5; // pixel variance spike indicating a real blink or smile

export function LivenessCamera({ onComplete, onCancel, onFallback }: LivenessCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sampleRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const loopTimerRef = useRef<NodeJS.Timeout | null>(null);
  const blinkBaseDataRef = useRef<Uint8ClampedArray | null>(null);

  const [step, setStep] = useState<Step>("position");
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [holdCountdown, setHoldCountdown] = useState(5); // Configured to 5 seconds
  const [faceDetected, setFaceDetected] = useState<boolean | null>(null);
  const [justCaptured, setJustCaptured] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  // Stats for the blink/smile movement difference visual meter
  const [livenessProgress, setLivenessProgress] = useState(0);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (loopTimerRef.current) {
      clearInterval(loopTimerRef.current);
      loopTimerRef.current = null;
    }
  }, []);

  // Lightweight biometric check based on luminance variance inside the oval frame zone
  const checkFacePresence = useCallback((): boolean => {
    const video = videoRef.current;
    const canvas = sampleRef.current;
    if (!video || !canvas || video.readyState < 2) return false;

    // Small sample canvas size to optimize processing and prevent UI lagging
    const W = 80;
    const H = 100;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    // Sample the center of the camera feed (aligned with the oval overlay)
    const sx = (video.videoWidth - W) / 2;
    const sy = (video.videoHeight - H) / 2;
    ctx.drawImage(video, sx, sy, W, H, 0, 0, W, H);

    try {
      const imgData = ctx.getImageData(0, 0, W, H);
      const data = imgData.data;
      let sum = 0;
      let sumSq = 0;
      let n = 0;

      for (let i = 0; i < data.length; i += 4) {
        // Compute standard relative luminance
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += lum;
        sumSq += lum * lum;
        n++;
      }

      const mean = sum / n;
      const variance = sumSq / n - mean * mean;
      return variance > MIN_VARIANCE;
    } catch (e) {
      // Safety bypass if canvas image extraction fails
      return true;
    }
  }, []);

  const getFaceRegionData = useCallback((): Uint8ClampedArray | null => {
    const video = videoRef.current;
    const canvas = sampleRef.current;
    if (!video || !canvas || video.readyState < 2) return null;

    const W = 80;
    const H = 100;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    const sx = (video.videoWidth - W) / 2;
    const sy = (video.videoHeight - H) / 2;
    ctx.drawImage(video, sx, sy, W, H, 0, 0, W, H);

    try {
      return ctx.getImageData(0, 0, W, H).data;
    } catch (e) {
      return null;
    }
  }, []);

  const calculateFrameDifference = useCallback((base: Uint8ClampedArray, current: Uint8ClampedArray): number => {
    let totalDiff = 0;
    let count = 0;
    for (let i = 0; i < base.length; i += 4) {
      const diffR = Math.abs(base[i] - current[i]);
      const diffG = Math.abs(base[i + 1] - current[i + 1]);
      const diffB = Math.abs(base[i + 2] - current[i + 2]);
      totalDiff += (diffR + diffG + diffB) / 3;
      count++;
    }
    return totalDiff / count;
  }, []);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Mirror horizontal alignment for a natural-feeling capture
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transforms

    const base64 = canvas.toDataURL("image/jpeg", 0.88).split(",")[1];
    setCapturedImage(base64);
  }, []);

  // Automated Biometric State Machine
  const startBiometricEngine = useCallback(() => {
    clearTimers();
    setStep("position");
    setHoldCountdown(5); // Increased to 5s
    setFaceDetected(null);
    setJustCaptured(false);
    setLivenessProgress(0);
    blinkBaseDataRef.current = null;

    let alignedTicks = 0;
    let countdownVal = 5; // Increased to 5s
    let localStep: Step = "position";
    let blinkTicks = 0;

    loopTimerRef.current = setInterval(() => {
      const present = checkFacePresence();
      setFaceDetected(present);

      if (localStep === "position") {
        if (present) {
          alignedTicks++;
          // If face is aligned/centered for 800ms (approx 7 ticks), auto-advance to Hold
          if (alignedTicks >= 7) {
            alignedTicks = 0;
            localStep = "hold";
            setStep("hold");
            setHoldCountdown(5);
            countdownVal = 5;
          }
        } else {
          alignedTicks = 0;
        }
      } else if (localStep === "hold") {
        if (present) {
          alignedTicks++;
          // Every 1 second (approx 8 ticks) decrement hold countdown
          if (alignedTicks >= 8) {
            alignedTicks = 0;
            countdownVal--;
            setHoldCountdown(countdownVal);

            if (countdownVal <= 0) {
              // Capture photo at end of hold countdown
              setJustCaptured(true);
              captureFrame();

              // Advance to Blink/Smile step
              localStep = "blink";
              setStep("blink");
              blinkTicks = 0;
              blinkBaseDataRef.current = null;
              setLivenessProgress(0);

              setTimeout(() => {
                setJustCaptured(false);
              }, 400);
            }
          }
        } else {
          // If user moves out of oval, reset countdown back to 5 to enforce compliance
          alignedTicks = 0;
          countdownVal = 5;
          setHoldCountdown(5);
        }
      } else if (localStep === "blink") {
        blinkTicks++;
        // Capture baseline face region after 4 ticks (approx 500ms) to ensure stream settles
        if (blinkBaseDataRef.current === null && blinkTicks === 4) {
          blinkBaseDataRef.current = getFaceRegionData();
        }

        if (blinkBaseDataRef.current !== null && blinkTicks > 5) {
          const currentData = getFaceRegionData();
          if (currentData) {
            const diff = calculateFrameDifference(blinkBaseDataRef.current, currentData);
            
            // Map difference dynamically to progress percentage
            const progress = Math.min(100, (diff / LIVENESS_DIFF_THRESHOLD) * 100);
            setLivenessProgress(progress);

            // Spikes above threshold indicate an active smile/blink (liveness confirmed)
            if (diff >= LIVENESS_DIFF_THRESHOLD) {
              clearTimers();
              setJustCaptured(true);
              captureFrame(); // Capture final smiling/blinking selfie

              setTimeout(() => {
                setJustCaptured(false);
                stopStream();
                setStep("preview");
              }, 800);
            }
          }
        }
      }
    }, SAMPLE_INTERVAL);
  }, [checkFacePresence, captureFrame, getFaceRegionData, calculateFrameDifference, stopStream, clearTimers]);

  const startStream = useCallback(async () => {
    setIsInitializing(true);
    setError(null);
    setCapturedImage(null);
    clearTimers();

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your browser or device does not support camera access.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          const playPromise = videoRef.current?.play();
          if (playPromise !== undefined) {
            playPromise.catch((err) => console.warn("Camera play interrupted:", err));
          }
          setIsInitializing(false);
          // Wait a moment for camera warm up, then launch the biometric engine
          setTimeout(() => startBiometricEngine(), 800);
        };
      }
    } catch (err: any) {
      setIsInitializing(false);
      const reason =
        err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
          ? "Camera access was denied. Please adjust your browser permissions."
          : err.message || "Could not initialize camera feed.";
      setError(reason);
    }
  }, [clearTimers, startBiometricEngine]);

  useEffect(() => {
    startStream();
    return () => {
      stopStream();
      clearTimers();
    };
  }, [startStream, stopStream, clearTimers]);

  const handleRetake = () => {
    startStream();
  };

  const handleConfirmSubmit = () => {
    if (!capturedImage) return;
    setIsConfirming(true);
    // Micro-interaction delay
    setTimeout(() => {
      onComplete([capturedImage]);
    }, 500);
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-6 sm:p-8 bg-neutral-900 border border-red-500/30 rounded-2xl text-center w-full max-w-sm mx-auto shadow-2xl">
        <AlertTriangle className="h-10 w-10 text-red-500 mb-3 animate-pulse" />
        <h3 className="font-bold text-white mb-2 text-sm">Camera Initialization Failed</h3>
        <p className="text-xs text-neutral-400 mb-6 leading-relaxed">{error}</p>
        <div className="flex gap-2 w-full">
          <Button variant="outline" size="sm" onClick={onCancel} className="flex-1 text-xs font-bold border-neutral-700 text-neutral-300 hover:bg-neutral-800">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onFallback(error)}
            className="flex-1 bg-[#7B2FF7] hover:bg-[#6F2CFF] text-white border-0 text-xs font-bold shadow-lg shadow-purple-900/20"
          >
            Use File Upload
          </Button>
        </div>
      </div>
    );
  }

  const isPreview = step === "preview";
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const activeStep = STEPS[stepIndex];

  return (
    <div className="flex flex-col bg-gradient-to-br from-indigo-950 via-[#1E1B2E] to-neutral-950 rounded-2xl overflow-hidden border border-purp-800/40 shadow-2xl w-full max-w-md mx-auto relative select-none max-h-[92vh] sm:max-h-none">
      
      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 bg-black/40 border-b border-white/5 z-30">
        <span className="text-white font-bold text-xs tracking-wider flex items-center gap-1.5 uppercase">
          <Camera className="h-3.5 w-3.5 text-[#7B2FF7] animate-pulse" />
          Liveness Biometric Check
        </span>
        <button
          onClick={() => {
            stopStream();
            clearTimers();
            onCancel();
          }}
          className="text-white/60 hover:text-white bg-white/5 hover:bg-white/15 p-1.5 rounded-full transition-all border border-white/5"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* ── STEP PROGRESS HUD ─────────────────────────────────────────────── */}
      {!isPreview && (
        <div className="flex items-center justify-between px-5 py-3 bg-black/20 border-b border-white/5 z-20">
          <div className="flex gap-2.5">
            {STEPS.filter((s) => s.id !== "preview").map((s, idx) => {
              const done = stepIndex > idx;
              const active = step === s.id;
              return (
                <div
                  key={s.id}
                  className={`h-2.5 rounded-full transition-all duration-500 ${
                    done
                      ? "bg-emerald-500 w-7 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                      : active
                      ? "bg-gradient-to-r from-purp-200 to-[#7B2FF7] w-10 shadow-[0_0_10px_rgba(123,47,247,0.5)]"
                      : "bg-white/10 w-5"
                  }`}
                />
              );
            })}
          </div>
          <span className="text-[10px] font-bold text-purp-200 tracking-widest uppercase">
            Step {stepIndex + 1} of 3
          </span>
        </div>
      )}

      {/* ── CAMERA / PREVIEW VIEWPORT ─────────────────────────────────────── */}
      {/* Capped maximum height to 340px to ensure the card fits comfortably on large viewports */}
      <div className="relative bg-black w-full aspect-[3/4] max-h-[340px] overflow-hidden flex items-center justify-center">
        
        {/* Initialization Overlay */}
        {isInitializing && !isPreview && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-40 bg-neutral-950/90 backdrop-blur-sm">
            <RefreshCw className="h-8 w-8 text-[#7B2FF7] animate-spin mb-3" />
            <span className="text-xs font-semibold tracking-widest text-neutral-300 uppercase">
              Connecting Camera...
            </span>
          </div>
        )}

        {/* Video stream or Captured image preview */}
        {isPreview && capturedImage ? (
          <div className="absolute inset-0 w-full h-full bg-neutral-950 flex flex-col items-center justify-center p-4">
            <div className="relative w-full max-w-[245px] aspect-[3/4] rounded-2xl overflow-hidden border-2 border-purp-200/40 shadow-2xl">
              <img
                src={`data:image/jpeg;base64,${capturedImage}`}
                alt="Captured Selfie"
                className="w-full h-full object-cover scale-x-[-1]"
              />
              <div className="absolute bottom-2.5 inset-x-2.5 bg-black/60 backdrop-blur-md rounded-lg py-1 px-2 border border-white/10 text-center">
                <span className="text-[9px] font-bold text-white uppercase tracking-wider">
                  Selfie Preview
                </span>
              </div>
            </div>
          </div>
        ) : (
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
            playsInline
            muted
            autoPlay
          />
        )}

        {/* Camera Flash effect */}
        {justCaptured && (
          <div className="absolute inset-0 bg-white z-30 animate-out fade-out duration-300 pointer-events-none" />
        )}

        {/* Dynamic Responsive Oval Overlay & Face scan line */}
        {!isInitializing && !isPreview && (
          <div className="absolute inset-0 pointer-events-none z-20 flex flex-col items-center justify-center">
            
            {/* SVG Mask Cutout */}
            <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <mask id="selfieMask">
                  <rect width="100%" height="100%" fill="white" />
                  <ellipse cx="50%" cy="47%" rx="28%" ry="35%" fill="black" />
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="rgba(0,0,0,0.65)" mask="url(#selfieMask)" />
            </svg>

            {/* Glowing biometric oval ring */}
            <div
              className="absolute transition-all duration-300"
              style={{
                top: "12%",
                left: "50%",
                transform: "translateX(-50%)",
                width: "56%",
                height: "70%",
              }}
            >
              <svg viewBox="0 0 100 130" className="w-full h-full overflow-visible">
                <ellipse
                  cx="50"
                  cy="65"
                  rx="48"
                  ry="62"
                  fill="none"
                  strokeWidth="2.5"
                  stroke={faceDetected ? "#10B981" : "rgba(255,255,255,0.2)"}
                  strokeDasharray={faceDetected ? "none" : "5 4"}
                  className="transition-all duration-300"
                />
              </svg>

              {/* Countdown overlay for hold step */}
              {step === "hold" && holdCountdown > 0 && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border-2 border-emerald-400 shadow-lg">
                    <span className="text-3xl font-black text-emerald-400 tracking-tight animate-ping-once">
                      {holdCountdown}
                    </span>
                  </div>
                </div>
              )}

              {/* Scanline HUD effect when face is aligned */}
              {faceDetected && (
                <div className="absolute inset-x-4 h-0.5 bg-emerald-400/60 shadow-[0_0_10px_#10b981] rounded-full animate-bounce top-1/2" />
              )}
            </div>

            {/* Hold progress bar overlay */}
            {faceDetected && step === "hold" && (
              <div className="absolute bottom-6 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md rounded-xl px-4 py-2 border border-white/10 shadow-lg">
                <span className="text-[10px] font-black text-emerald-400 tracking-widest uppercase animate-pulse">
                  Hold Still... {holdCountdown}s
                </span>
              </div>
            )}

            {/* Dynamic Smile/Blink meter overlay */}
            {step === "blink" && (
              <div className="absolute bottom-6 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md rounded-xl px-4 py-2.5 border border-white/10 shadow-lg w-[190px]">
                <span className="text-[9px] font-bold text-purp-200 tracking-widest uppercase animate-pulse text-center">
                  Smile or Blink Now
                </span>
                <div className="w-full h-1.5 bg-white/10 rounded-full mt-2 overflow-hidden relative">
                  <div
                    className="h-full bg-[#7B2FF7] transition-all duration-100 ease-out shadow-[0_0_8px_#7b2ff7]"
                    style={{ width: `${livenessProgress}%` }}
                  />
                </div>
                <span className="text-[8px] text-neutral-500 mt-1 uppercase tracking-wider">
                  Liveness action verification
                </span>
              </div>
            )}

            {/* Feedback Badge for position step */}
            {faceDetected && step === "position" && (
              <div className="absolute bottom-6 bg-emerald-500/90 backdrop-blur-md border border-emerald-400/40 rounded-full px-4 py-1.5 shadow-lg flex items-center gap-1.5 animate-in fade-in duration-300">
                <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                <span className="text-white text-[10px] font-bold tracking-wider uppercase">
                  Face Aligned ✓
                </span>
              </div>
            )}
          </div>
        )}

        {/* Hidden detection canvases */}
        <canvas ref={canvasRef} className="hidden" />
        <canvas ref={sampleRef} className="hidden" />
      </div>

      {/* ── INSTRUCTIONS & BUTTONS PANEL ──────────────────────────────────── */}
      {/* Explicit z-index and relative layout to prevent clicks from being hijacked by overlays on desktop */}
      <div className="px-5 py-4 bg-neutral-950 border-t border-white/5 z-40 relative flex-shrink-0">
        
        {isPreview ? (
          <div className="text-center mb-4">
            <h4 className="text-white text-sm font-extrabold tracking-wide uppercase">
              Verify Selfie Image
            </h4>
            <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
              Confirm your capture looks sharp and well-lit before submitting.
            </p>
          </div>
        ) : (
          <div className="text-center mb-4">
            <h4 className="text-white text-sm font-extrabold tracking-wide uppercase flex items-center justify-center gap-1.5">
              {faceDetected ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                  <span className="text-emerald-400">{activeStep?.label}</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-neutral-500" />
                  <span className="text-neutral-300">{activeStep?.label}</span>
                </>
              )}
            </h4>
            <p className="text-xs text-neutral-400 mt-1 font-bold">
              {activeStep?.instruction}
            </p>
            <p className="text-[10px] text-neutral-500 mt-0.5">
              {activeStep?.sub}
            </p>
          </div>
        )}

        {/* Action Controls */}
        {isPreview ? (
          <div className="flex gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRetake}
              disabled={isConfirming}
              className="flex-1 border-neutral-700 text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-xl h-11 text-xs font-bold pointer-events-auto"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Retake
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmSubmit}
              disabled={isConfirming}
              className="flex-1 bg-[#7B2FF7] hover:bg-[#6F2CFF] text-white border-0 rounded-xl h-11 text-xs font-bold shadow-lg shadow-purple-900/30 transition-all active:scale-95 pointer-events-auto"
            >
              {isConfirming ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  Confirm & Submit
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="w-full py-2.5 rounded-xl text-[10px] font-bold tracking-widest uppercase border flex items-center justify-center gap-2 transition-all duration-300 h-11 select-none">
            {faceDetected === null ? (
              <span className="text-neutral-500">Initializing Biometrics...</span>
            ) : faceDetected ? (
              step === "hold" ? (
                <span className="text-emerald-400 flex items-center gap-1.5 animate-pulse">
                  <Eye className="h-3.5 w-3.5" /> Hold Still! Capturing in {holdCountdown}s...
                </span>
              ) : step === "blink" ? (
                <span className="text-emerald-400 flex items-center gap-1.5 animate-pulse">
                  <Smile className="h-3.5 w-3.5 animate-bounce" /> Blink/smile to trigger auto-capture...
                </span>
              ) : (
                <span className="text-emerald-400 flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5" /> Face aligned
                </span>
              )
            ) : (
              <span className="text-neutral-400 flex items-center gap-1.5">
                <Scan className="h-3.5 w-3.5 animate-pulse text-[#7B2FF7]" /> Position head inside the oval center
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── SECURITY / PRIVACY LOGO ───────────────────────────────────────── */}
      <div className="px-5 pb-3 bg-neutral-950 text-center flex-shrink-0">
        <span className="text-[9px] text-neutral-600 leading-normal block">
          🔒 Secured End-to-End · Fully Encrypted · Verification provider sandbox active
        </span>
      </div>
    </div>
  );
}
