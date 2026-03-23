import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";
import type { SetupState } from "../App";

const POLL_INTERVAL_MS = 1500;

interface MagicProgressProps {
  setup: SetupState;
  onComplete: () => void;
}

interface ProgressInfo {
  phase: string;
  percent: number;
  message: string;
  error: string | null;
}

/** Screen 3: Magic progress — real install with atmospheric visualization */
export default function MagicProgress({ setup, onComplete }: MagicProgressProps) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState(t("progress.preparingMind"));
  const [completed, setCompleted] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);

  const radius = 90;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference - (progress / 100) * circumference;

  /** Poll the backend for install progress */
  const pollProgress = useCallback(async () => {
    try {
      const info = await invoke<ProgressInfo>("get_install_progress");

      if (info.error) {
        setError(info.error);
        if (pollRef.current) clearInterval(pollRef.current);
        return;
      }

      // Smooth progress updates — never go backwards
      setProgress((prev) => Math.max(prev, info.percent));
      setMessage(info.message || t("progress.almostThere"));

      // Track completed phases
      if (info.phase && info.percent > 0) {
        setCompleted((prev) => {
          const entry = `${info.message} ✓`;
          if (prev.includes(entry)) return prev;
          // Keep only last 4 completed items for UI cleanliness
          const next = [...prev, entry];
          return next.length > 4 ? next.slice(-4) : next;
        });
      }

      // Installation complete
      if (info.phase === "Complete" || info.percent >= 100) {
        if (pollRef.current) clearInterval(pollRef.current);
        setProgress(100);
        setMessage(t("progress.almostThere"));
        // Short delay for the completion animation
        setTimeout(() => onComplete(), 800);
      }
    } catch (err) {
      console.error("[progress] Poll failed:", err);
    }
  }, [onComplete, t]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    // Initial completed items
    const initial: string[] = [];
    if (setup.gpuName) initial.push(t("progress.foundGpu", { gpu: setup.gpuName }));
    initial.push(t("progress.voiceSelected", { voice: setup.voiceName }));
    setCompleted(initial);

    async function startInstall() {
      try {
        // Kick off the real installation in the background
        // This returns when complete, but we poll for progress
        invoke("start_install", {
          tier: setup.gpuTier,
          features: ["all"],
        }).catch((err: unknown) => {
          console.error("[progress] Install command failed:", err);
          setError(String(err));
        });

        // Start polling for progress updates
        pollRef.current = setInterval(pollProgress, POLL_INTERVAL_MS);
        // Immediate first poll
        pollProgress();
      } catch (err) {
        console.error("[progress] Failed to start install:", err);
        setError(String(err));
      }
    }

    startInstall();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full bg-dream-radial">
      {/* Progress ring */}
      <div className="relative mb-10">
        <svg width="220" height="220" className="transform -rotate-90">
          <defs>
            <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="var(--dream-accent)" />
              <stop offset="100%" stopColor="var(--dream-lavender)" />
            </linearGradient>
          </defs>
          <circle
            cx="110" cy="110" r={radius}
            fill="none" className="progress-ring-bg" strokeWidth="3"
          />
          <circle
            cx="110" cy="110" r={radius}
            fill="none" className="progress-ring-fill"
            strokeWidth="3" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
        </svg>

        {/* Center orb */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="w-28 h-28 rounded-full orb-glow"
            style={{
              background:
                "radial-gradient(circle at 40% 40%, var(--dream-accent-light) 0%, var(--dream-accent) 30%, #4f46e5 60%, var(--dream-card) 100%)",
            }}
          >
            <div className="relative w-full h-full">
              {Array.from({ length: 8 }).map((_, i) => {
                const angle = (i * 360) / 8;
                const r = 35 + (i % 3) * 5;
                const x = 56 + r * Math.cos((angle * Math.PI) / 180);
                const y = 56 + r * Math.sin((angle * Math.PI) / 180);
                return (
                  <div
                    key={i}
                    className="absolute w-1 h-1 bg-white/60 rounded-full animate-pulse"
                    style={{ left: `${x}px`, top: `${y}px`, animationDelay: `${i * 0.3}s` }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-light mt-16" style={{ color: "var(--dream-muted-dim)" }}>
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      {/* Completed */}
      <div className="flex flex-col items-center gap-1 mb-4 min-h-[60px]">
        {completed.map((item) => (
          <p key={item} className="text-xs animate-fade-in" style={{ color: "var(--dream-success)" }}>
            ✓ {item}
          </p>
        ))}
      </div>

      {/* Current status */}
      {error ? (
        <div className="text-center">
          <p className="text-sm font-medium" style={{ color: "#ef4444" }}>
            Installation error
          </p>
          <p className="text-xs mt-2 max-w-sm" style={{ color: "var(--dream-muted-dim)" }}>
            {error}
          </p>
        </div>
      ) : (
        <>
          <p className="text-lg font-light animate-pulse" style={{ animationDuration: "3s", color: "var(--dream-text)" }}>
            {message}
          </p>
          <p className="text-xs mt-4" style={{ color: "var(--dream-muted-dim)" }}>
            {t("progress.timeEstimate")}
          </p>
        </>
      )}
    </div>
  );
}
