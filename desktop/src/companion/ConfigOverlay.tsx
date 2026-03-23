import { useState } from "react";
import { X, User, Mic, Globe, Moon, Check, Play, Square } from "lucide-react";
import { useTranslation, LOCALE_LABELS, type Locale } from "../i18n";
import { useTheme, type ThemeId } from "../theme";
import type { SetupState } from "../App";
import { useTTS } from "./useTTS";

import { Sparkles, Target, Star } from "lucide-react";

// Reuse the same voices from Personalization
const VOICES = [
  { id: "af_heart", key: "nova", Icon: Sparkles },
  { id: "am_adam", key: "atlas", Icon: Target },
  { id: "af_nova", key: "luna", Icon: Moon },
  { id: "am_onyx", key: "sage", Icon: Star },
];

interface ConfigOverlayProps {
  setup: SetupState;
  onSave: (partial: Partial<SetupState>) => void;
  onClose: () => void;
}

export default function ConfigOverlay({ setup, onSave, onClose }: ConfigOverlayProps) {
  const { t, locale, setLocale } = useTranslation();
  const { theme, setTheme, themes } = useTheme();

  const [userName, setUserName] = useState(setup.userName);
  const [voiceId, setVoiceId] = useState(setup.voiceId);

  const tts = useTTS({ voiceId });
  const [playingId, setPlayingId] = useState<string | null>(null);

  const handlePreview = (e: React.MouseEvent, vId: string, voiceName: string) => {
    e.stopPropagation();
    if (tts.isSpeaking && playingId === vId) {
      tts.stopSpeaking();
      setPlayingId(null);
    } else {
      setPlayingId(vId);
      tts.speak(t("personalize.greetingPreview", { name: voiceName }), vId);
    }
  };

  const handleSave = () => {
    const selectedVoice = VOICES.find((v) => v.id === voiceId);
    onSave({
      userName: userName.trim() || "Friend",
      voiceId,
      voiceName: selectedVoice ? t(`personalize.voices.${selectedVoice.key}.name`) : setup.voiceName,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-md animate-fade-in">
      <div className="glass-card w-full max-w-2xl max-h-full overflow-y-auto rounded-3xl p-8 animate-slide-up shadow-2xl relative"
           style={{ border: "1px solid var(--dream-glass-border)" }}>
        
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-white/10"
          style={{ color: "var(--dream-muted)" }}
        >
          <X size={18} />
        </button>

        <h2 className="text-2xl font-semibold mb-8" style={{ color: "var(--dream-text)" }}>
          {t("companion.settings")}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Left Column: Personalization */}
          <div className="space-y-8">
            <div>
              <h3 className="text-[11px] uppercase tracking-[0.1em] mb-4 font-semibold flex items-center gap-2"
                  style={{ color: "var(--dream-muted-dim)" }}>
                <User size={14} /> Profile
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] mb-2 font-medium" style={{ color: "var(--dream-muted)" }}>
                    {t("personalize.nameLabel")}
                  </label>
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="input-dream w-full"
                    placeholder={t("personalize.namePlaceholder")}
                  />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-[11px] uppercase tracking-[0.1em] mb-4 font-semibold flex items-center gap-2"
                  style={{ color: "var(--dream-muted-dim)" }}>
                <Mic size={14} /> Voice & Persona
              </h3>
              
              <div className="grid grid-cols-2 gap-3">
                {VOICES.map((voice) => {
                  const isSelected = voice.id === voiceId;
                  const isPlaying = tts.isSpeaking && playingId === voice.id;
                  return (
                    <button
                      key={voice.id}
                      onClick={() => setVoiceId(voice.id)}
                      className="relative flex flex-col items-center gap-2 p-3 rounded-xl transition-all duration-200"
                      style={{
                        background: isSelected
                          ? "color-mix(in srgb, var(--dream-accent) 15%, transparent)"
                          : "color-mix(in srgb, var(--dream-text) 3%, transparent)",
                        border: isSelected
                          ? "1px solid color-mix(in srgb, var(--dream-accent) 40%, transparent)"
                          : "1px solid transparent",
                      }}
                    >
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg"
                           style={{
                             background: isSelected 
                               ? "linear-gradient(135deg, var(--dream-accent), var(--dream-purple))"
                               : "color-mix(in srgb, var(--dream-text) 5%, transparent)",
                             color: isSelected ? "white" : "var(--dream-muted-dim)",
                           }}>
                        <voice.Icon size={14} />
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
                      <span className="text-xs font-medium" style={{ color: isSelected ? "var(--dream-text)" : "var(--dream-muted)" }}>
                        {t(`personalize.voices.${voice.key}.name`)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: App Settings */}
          <div className="space-y-8">
            <div>
              <h3 className="text-[11px] uppercase tracking-[0.1em] mb-4 font-semibold flex items-center gap-2"
                  style={{ color: "var(--dream-muted-dim)" }}>
                <Globe size={14} /> {t("companion.language")}
              </h3>
              
              <div className="grid grid-cols-2 gap-3">
                {(Object.keys(LOCALE_LABELS) as Locale[]).map((l) => (
                  <button
                    key={l}
                    onClick={() => setLocale(l)}
                    className="flex justify-between items-center px-4 py-3 rounded-xl transition-all text-sm font-medium border"
                    style={{
                      borderColor: locale === l ? "var(--dream-accent)" : "transparent",
                      background: locale === l 
                        ? "color-mix(in srgb, var(--dream-accent) 10%, transparent)" 
                        : "color-mix(in srgb, var(--dream-text) 3%, transparent)",
                      color: locale === l ? "var(--dream-accent-light)" : "var(--dream-muted)",
                    }}
                  >
                    <span>{LOCALE_LABELS[l]}</span>
                    {locale === l && <Check size={14} />}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-[11px] uppercase tracking-[0.1em] mb-4 font-semibold flex items-center gap-2"
                  style={{ color: "var(--dream-muted-dim)" }}>
                <Moon size={14} /> {t("companion.theme")}
              </h3>
              
              <div className="grid grid-cols-2 gap-3">
                {themes.map((tid) => (
                  <button
                    key={tid}
                    onClick={() => setTheme(tid as ThemeId)}
                    className="flex justify-between items-center px-4 py-3 rounded-xl transition-all text-sm font-medium border"
                    style={{
                      borderColor: theme === tid ? "var(--dream-accent)" : "transparent",
                      background: theme === tid 
                        ? "color-mix(in srgb, var(--dream-accent) 10%, transparent)" 
                        : "color-mix(in srgb, var(--dream-text) 3%, transparent)",
                      color: theme === tid ? "var(--dream-accent-light)" : "var(--dream-muted)",
                    }}
                  >
                    <span className="capitalize">{t(`theme.${tid}`)}</span>
                    {theme === tid && <Check size={14} />}
                  </button>
                ))}
              </div>
            </div>
          </div>

        </div>

        <div className="mt-10 flex justify-end">
          <button 
            onClick={handleSave}
            className="btn-primary px-8 py-2.5 rounded-xl shadow-lg hover:shadow-xl transition-all"
            style={{ 
              background: "linear-gradient(135deg, var(--dream-accent), var(--dream-purple))",
              color: "white"
            }}
          >
            Save Changes
          </button>
        </div>

      </div>
    </div>
  );
}
