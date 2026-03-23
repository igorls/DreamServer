import { useState } from "react";
import { Sparkles, Star, Moon, Target, Play, Square } from "lucide-react";
import { useTranslation } from "../i18n";
import { useTTS } from "../companion/useTTS";

interface PersonalizeProps {
  gpuName: string;
  onComplete: (name: string, voiceId: string, voiceName: string) => void;
}

const VOICES = [
  { id: "af_heart", key: "nova", Icon: Sparkles },
  { id: "am_adam", key: "atlas", Icon: Target },
  { id: "af_nova", key: "luna", Icon: Moon },
  { id: "am_onyx", key: "sage", Icon: Star },
];

/** Screen 2: Personalization — the only real decision */
export default function Personalize({ gpuName, onComplete }: PersonalizeProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);

  const tts = useTTS({ voiceId: VOICES[selectedIdx].id });
  const [playingId, setPlayingId] = useState<string | null>(null);

  const handlePreview = (e: React.MouseEvent, voiceId: string, voiceName: string) => {
    e.stopPropagation();
    if (tts.isSpeaking && playingId === voiceId) {
      tts.stopSpeaking();
      setPlayingId(null);
    } else {
      setPlayingId(voiceId);
      tts.speak(t("personalize.greetingPreview", { name: voiceName }), voiceId);
    }
  };

  const handleSubmit = () => {
    const userName = name.trim() || "Friend";
    const voice = VOICES[selectedIdx];
    onComplete(userName, voice.id, t(`personalize.voices.${voice.key}.name`));
  };

  return (
    <div className="flex items-center justify-center h-full bg-dream-radial">
      <div className="glass-card p-10 max-w-md w-full mx-4 animate-slide-up">
        {/* GPU badge */}
        <div className="flex items-center gap-2 mb-6 justify-center">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--dream-success)" }} />
          <span className="text-xs" style={{ color: "var(--dream-muted-dim)" }}>
            {gpuName || t("splash.hardwareDetected")}
          </span>
        </div>

        <h2 className="text-2xl font-semibold text-center mb-8" style={{ color: "var(--dream-text)" }}>
          {t("personalize.title")}
        </h2>

        {/* Name */}
        <div className="mb-8">
          <label htmlFor="personalize-name"
                 className="block text-[10px] mb-2 uppercase tracking-[0.15em] font-medium"
                 style={{ color: "var(--dream-muted-dim)" }}>
            {t("personalize.nameLabel")}
          </label>
          <input
            id="personalize-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("personalize.namePlaceholder")}
            className="input-dream"
            autoFocus
          />
        </div>

        {/* Voice picker */}
        <div className="mb-8">
          <label className="block text-[10px] mb-3 uppercase tracking-[0.15em] font-medium"
                 style={{ color: "var(--dream-muted-dim)" }}>
            {t("personalize.voiceLabel")}
          </label>
          <div className="grid grid-cols-4 gap-3">
            {VOICES.map((voice, idx) => {
              const isSelected = idx === selectedIdx;
              const isPlaying = tts.isSpeaking && playingId === voice.id;
              return (
                <button
                  key={voice.id}
                  onClick={() => setSelectedIdx(idx)}
                  className="relative flex flex-col items-center gap-2.5 p-3.5 rounded-xl transition-all duration-200"
                  style={{
                    background: isSelected
                      ? "color-mix(in srgb, var(--dream-accent) 15%, transparent)"
                      : "color-mix(in srgb, var(--dream-text) 3%, transparent)",
                    border: isSelected
                      ? "1px solid color-mix(in srgb, var(--dream-accent) 40%, transparent)"
                      : "1px solid transparent",
                    boxShadow: isSelected
                      ? "0 4px 16px color-mix(in srgb, var(--dream-accent) 10%, transparent)"
                      : "none",
                  }}
                >
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center transition-all duration-200"
                    style={{
                      background: isSelected
                        ? "linear-gradient(135deg, var(--dream-accent), var(--dream-purple))"
                        : "color-mix(in srgb, var(--dream-text) 5%, transparent)",
                      color: isSelected ? "white" : "var(--dream-muted-dim)",
                    }}
                  >
                    <voice.Icon size={18} />
                  </div>
                  <div 
                    onClick={(e) => handlePreview(e, voice.id, t(`personalize.voices.${voice.key}.name`))}
                    className="absolute top-2 right-2 p-1.5 rounded-full transition-colors z-10 hover:scale-110 active:scale-95"
                    style={{ 
                      background: "color-mix(in srgb, var(--dream-text) 10%, transparent)",
                      color: isPlaying ? "var(--dream-accent-light)" : "var(--dream-muted-dim)"
                    }}
                  >
                    {isPlaying ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" className="ml-0.5" />}
                  </div>
                  <span className="text-xs font-medium transition-colors"
                        style={{ color: isSelected ? "var(--dream-text)" : "var(--dream-muted-dim)" }}>
                    {t(`personalize.voices.${voice.key}.name`)}
                  </span>
                  <span className="text-[10px] leading-tight text-center"
                        style={{ color: "var(--dream-muted-dim)" }}>
                    {t(`personalize.voices.${voice.key}.desc`)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <button onClick={handleSubmit} className="btn-primary w-full text-center">
          {t("personalize.submit")}
        </button>
      </div>
    </div>
  );
}
