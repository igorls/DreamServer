import { Mic, Send } from "lucide-react";
import { useTranslation } from "../i18n";

interface ChatInputProps {
  input: string;
  voiceName: string;
  disabled?: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
}

/** Chat input bar with send and voice buttons */
export default function ChatInput({ input, voiceName, disabled, onInputChange, onSend }: ChatInputProps) {
  const { t } = useTranslation();

  return (
    <div className="px-6 pb-5 pt-2">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-2 rounded-2xl px-4 py-3 transition-all duration-300"
             style={{
               background: "color-mix(in srgb, var(--dream-text) 4%, transparent)",
               border: "1px solid var(--dream-glass-border)",
               backdropFilter: "blur(20px)",
             }}>
          <input
            type="text"
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !disabled && onSend()}
            placeholder={t("companion.messagePlaceholder", { voice: voiceName })}
            className="flex-1 bg-transparent border-none outline-none text-[13.5px]"
            style={{ color: "var(--dream-text)" }}
            aria-label={t("companion.messagePlaceholder", { voice: voiceName })}
            disabled={disabled}
          />
          <button
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200"
            style={{ color: "var(--dream-muted-dim)" }}
            title={t("companion.voiceInput")}
            aria-label={t("companion.voiceInput")}
          >
            <Mic size={16} />
          </button>
          <button
            onClick={onSend}
            disabled={!input.trim() || disabled}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200"
            style={{
              background: "var(--dream-accent)",
              color: "white",
              opacity: input.trim() ? 0.9 : 0.2,
            }}
            aria-label={t("companion.send")}
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
