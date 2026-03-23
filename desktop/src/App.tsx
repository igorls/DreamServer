import { useState, useEffect, lazy, Suspense, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import TitleBar from "./components/TitleBar";

const Splash = lazy(() => import("./wizard/Splash"));
const DockerRequired = lazy(() => import("./wizard/DockerRequired"));
const Personalize = lazy(() => import("./wizard/Personalize"));
const MagicProgress = lazy(() => import("./wizard/MagicProgress"));
const CompanionShell = lazy(() => import("./CompanionShell"));

export type AppMode = "wizard" | "companion";
export type WizardStep = "splash" | "docker" | "personalize" | "progress";

export interface SetupState {
  userName: string;
  voiceId: string;
  voiceName: string;
  gpuName: string;
  gpuTier: number;
  dockerReady: boolean;
}

const DEFAULT_SETUP: SetupState = {
  userName: "",
  voiceId: "af_heart",
  voiceName: "Nova",
  gpuName: "",
  gpuTier: 0,
  dockerReady: false,
};

export default function App() {
  const [mode, setMode] = useState<AppMode | null>(null); // null = loading
  const [wizardStep, setWizardStep] = useState<WizardStep>("splash");
  const [setup, setSetup] = useState<SetupState>(DEFAULT_SETUP);

  // Load saved config on launch
  useEffect(() => {
    async function loadConfig() {
      try {
        const store = await load("config.json");
        const saved = await store.get<SetupState>("setup");
        if (saved?.userName) {
          // User completed wizard before — go straight to companion
          setSetup(saved);
          setMode("companion");
        } else {
          setMode("wizard");
        }
      } catch {
        // First launch or store unavailable — start wizard
        setMode("wizard");
      }
    }
    loadConfig();
  }, []);

  const updateSetup = (partial: Partial<SetupState>) =>
    setSetup((prev) => ({ ...prev, ...partial }));

  // Save config and transition to companion
  const completeWizard = useCallback(async () => {
    try {
      const store = await load("config.json");
      await store.set("setup", setup);
      await store.save();
    } catch (e) {
      console.error("[config] Failed to save:", e);
    }
    setMode("companion");
  }, [setup]);

  // Show nothing while loading config (prevents flash)
  if (mode === null) {
    return (
      <main className="flex flex-col h-screen bg-dream-bg overflow-hidden">
        <TitleBar />
      </main>
    );
  }

  return (
    <main className="flex flex-col h-screen bg-dream-bg overflow-hidden">
      <TitleBar />

      <div className="flex-1 overflow-hidden">
        <Suspense fallback={null}>
          {mode === "wizard" && (
            <>
              {wizardStep === "splash" && (
                <Splash
                  onDetected={(gpu: string, tier: number, dockerOk: boolean) => {
                    updateSetup({
                      gpuName: gpu,
                      gpuTier: tier,
                      dockerReady: dockerOk,
                    });
                    if (!dockerOk) {
                      setWizardStep("docker");
                    } else {
                      setWizardStep("personalize");
                    }
                  }}
                />
              )}
              {wizardStep === "docker" && (
                <DockerRequired
                  onReady={() => {
                    updateSetup({ dockerReady: true });
                    setWizardStep("personalize");
                  }}
                />
              )}
              {wizardStep === "personalize" && (
                <Personalize
                  gpuName={setup.gpuName}
                  onComplete={(name: string, voiceId: string, voiceName: string) => {
                    updateSetup({ userName: name, voiceId, voiceName });
                    setWizardStep("progress");
                  }}
                />
              )}
              {wizardStep === "progress" && (
                <MagicProgress
                  setup={setup}
                  onComplete={completeWizard}
                />
              )}
            </>
          )}

          {mode === "companion" && (
            <CompanionShell setup={setup} onUpdateSetup={updateSetup} />
          )}
        </Suspense>
      </div>
    </main>
  );
}
