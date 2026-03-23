import { useEffect, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../i18n";

const STATUS_ROTATION_MS = 1500;
const GPU_DISPLAY_MS = 1200;
const FADE_OUT_MS = 400;

interface SplashProps {
  onDetected: (gpuName: string, tier: number, dockerOk: boolean) => void;
}

interface GpuResult {
  gpu: {
    name: string;
    vendor: string;
    vram_mb: number;
  };
  recommended_tier: number;
  tier_description: string;
}

interface PrerequisiteStatus {
  git_installed: boolean;
  docker_installed: boolean;
  docker_running: boolean;
  all_met: boolean;
}

/** Screen 1: Auto-detect splash — zero interaction */
export default function Splash({ onDetected }: SplashProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState(t("splash.settingUp"));
  const [detectedGpu, setDetectedGpu] = useState("");
  const [fadeOut, setFadeOut] = useState(false);

  const statusMessages = useMemo(
    () => [
      t("splash.settingUp"),
      t("splash.detectingHardware"),
      t("splash.checkingGpu"),
      t("splash.almostReady"),
    ],
    [t]
  );

  const stars = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        top: Math.random() * 100,
        delay: Math.random() * 4,
        size: 1 + Math.random() * 2,
      })),
    []
  );

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      let msgIdx = 0;
      const timer = setInterval(() => {
        msgIdx = (msgIdx + 1) % statusMessages.length;
        setStatus(statusMessages[msgIdx]);
      }, STATUS_ROTATION_MS);

      let gpuName = "Unknown GPU";
      let tier = 0;
      let dockerOk = false;

      try {
        // Real GPU detection via Tauri backend
        const gpuResult = await invoke<GpuResult>("detect_gpu");
        gpuName = gpuResult.gpu.name || "No GPU detected";
        tier = gpuResult.recommended_tier;

        // Real Docker prerequisite check
        const prereqs = await invoke<PrerequisiteStatus>("check_prerequisites");
        dockerOk = prereqs.docker_installed && prereqs.docker_running;
      } catch (err) {
        console.error("[splash] Backend detection failed, using defaults:", err);
        // Fallback: continue with defaults so the wizard doesn't crash
      }

      if (!cancelled) {
        setDetectedGpu(gpuName);
        setStatus(t("splash.foundGpu", { gpu: gpuName }) + " ✓");
      }

      clearInterval(timer);
      await new Promise((r) => setTimeout(r, GPU_DISPLAY_MS));

      if (!cancelled) {
        setFadeOut(true);
        await new Promise((r) => setTimeout(r, FADE_OUT_MS));
        onDetected(gpuName, tier, dockerOk);
      }
    }

    detect();
    return () => { cancelled = true; };
  }, [onDetected, statusMessages, t]);

  return (
    <div
      className={`relative flex flex-col items-center justify-center h-full bg-dream-radial
                   transition-opacity duration-400 ${fadeOut ? "opacity-0" : "opacity-100"}`}
    >
      {stars.map((star) => (
        <div
          key={star.id}
          className="star"
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            animationDelay: `${star.delay}s`,
          }}
        />
      ))}

      {/* Glowing orb */}
      <div className="relative mb-10">
        <div
          className="w-40 h-40 rounded-full orb-glow flex items-center justify-center"
          style={{
            background:
              "radial-gradient(circle at 40% 40%, var(--dream-accent-light) 0%, var(--dream-accent) 30%, #4f46e5 60%, var(--dream-card) 100%)",
          }}
        >
          <div
            className="w-28 h-28 rounded-full animate-pulse"
            style={{
              animationDuration: "3s",
              background:
                "radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--dream-lavender) 60%, transparent) 0%, color-mix(in srgb, var(--dream-accent) 30%, transparent) 50%, transparent 100%)",
            }}
          />
        </div>

        <div className="absolute inset-0 animate-spin" style={{ animationDuration: "8s" }}>
          <div
            className="absolute w-2 h-2 rounded-full"
            style={{ top: "-4px", left: "50%", transform: "translateX(-50%)", background: "var(--dream-lavender)" }}
          />
        </div>
        <div className="absolute inset-0 animate-spin" style={{ animationDuration: "12s", animationDirection: "reverse" }}>
          <div
            className="absolute w-1.5 h-1.5 rounded-full"
            style={{ bottom: "0", left: "50%", transform: "translateX(-50%)", background: "var(--dream-accent-light)" }}
          />
        </div>
      </div>

      <h1 className="text-3xl font-semibold tracking-tight mb-1 animate-fade-in" style={{ color: "var(--dream-text)" }}>
        {t("app.name")}
      </h1>
      <p className="text-sm mb-12 animate-fade-in" style={{ color: "var(--dream-muted)" }}>
        {t("app.tagline")}
      </p>

      <div className="flex flex-col items-center gap-3 animate-fade-in">
        <p className="text-lg font-light" style={{ color: "var(--dream-text)" }}>{status}</p>
        {!detectedGpu && (
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--dream-accent)" }} />
            <span className="text-xs" style={{ color: "var(--dream-muted-dim)" }}>
              {t("splash.detectingHardware")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
