/**
 * Text-to-Speech hook using Kokoro TTS (OpenAI-compatible API).
 * Sends assistant messages to the Kokoro container and plays audio.
 */

import { useState, useCallback, useRef } from "react";

const KOKORO_BASE = "http://localhost:8880";

export interface TTSState {
  isSpeaking: boolean;
  isAvailable: boolean;
  error: string | null;
}

export interface UseTTSOptions {
  voiceId: string;
  autoSpeak?: boolean;
}

/**
 * Hook for text-to-speech using Kokoro's OpenAI-compatible endpoint.
 *
 * Usage:
 *   const tts = useTTS({ voiceId: "af_heart" });
 *   tts.speak("Hello, Igor!");
 */
export function useTTS(options: UseTTSOptions) {
  const [state, setState] = useState<TTSState>({
    isSpeaking: false,
    isAvailable: false,
    error: null,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const voiceIdRef = useRef(options.voiceId);
  voiceIdRef.current = options.voiceId;

  /** Check if Kokoro TTS is available */
  const checkAvailability = useCallback(async (): Promise<boolean> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${KOKORO_BASE}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      const available = res.ok;
      setState((prev) => ({ ...prev, isAvailable: available, error: null }));
      return available;
    } catch {
      setState((prev) => ({ ...prev, isAvailable: false }));
      return false;
    }
  }, []);

  /** Speak text using Kokoro TTS */
  const speak = useCallback(async (text: string, overrideVoiceId?: string) => {
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    abortRef.current?.abort();

    // Strip markdown for cleaner speech
    const cleanText = stripMarkdown(text);
    if (!cleanText.trim()) return;

    setState((prev) => ({ ...prev, isSpeaking: true, error: null }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const activeVoiceId = overrideVoiceId || voiceIdRef.current;
      const res = await fetch(`${KOKORO_BASE}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "kokoro",
          input: cleanText,
          voice: activeVoiceId,
          response_format: "mp3",
          speed: 1.0,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // If voice is invalid (400), fallback to af_heart
        if (res.status === 400 && activeVoiceId !== "af_heart") {
          console.warn(`[tts] Voice "${activeVoiceId}" rejected, falling back to af_heart`);
          const retry = await fetch(`${KOKORO_BASE}/v1/audio/speech`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "kokoro",
              input: cleanText,
              voice: "af_heart",
              response_format: "mp3",
              speed: 1.0,
            }),
            signal: controller.signal,
          });
          if (retry.ok) {
            const blob = await retry.blob();
            const url = URL.createObjectURL(blob);
            objectUrlRef.current = url;
            const audio = new Audio(url);
            audioRef.current = audio;
            audio.onended = () => {
              URL.revokeObjectURL(url);
              objectUrlRef.current = null;
              audioRef.current = null;
              setState((prev) => ({ ...prev, isSpeaking: false }));
            };
            audio.onerror = () => {
              URL.revokeObjectURL(url);
              objectUrlRef.current = null;
              audioRef.current = null;
              setState((prev) => ({ ...prev, isSpeaking: false, error: "Audio playback failed" }));
            };
            await audio.play();
            return;
          }
        }
        throw new Error(`TTS error: ${res.status}`);
      }

      // Create audio blob and play it
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        objectUrlRef.current = null;
        audioRef.current = null;
        setState((prev) => ({ ...prev, isSpeaking: false }));
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        objectUrlRef.current = null;
        audioRef.current = null;
        setState((prev) => ({ ...prev, isSpeaking: false, error: "Audio playback failed" }));
      };

      await audio.play();
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("[tts] Error:", err);
      setState((prev) => ({
        ...prev,
        isSpeaking: false,
        error: `TTS error: ${(err as Error).message}`,
      }));
    }
  }, []);

  /** Stop speaking */
  const stopSpeaking = useCallback(() => {
    abortRef.current?.abort();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    // Revoke any leaked Object URL
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setState((prev) => ({ ...prev, isSpeaking: false }));
  }, []);

  return { ...state, checkAvailability, speak, stopSpeaking };
}

/** Strip common markdown for cleaner TTS output */
function stripMarkdown(text: string): string {
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, "")
    // Remove inline code
    .replace(/`([^`]+)`/g, "$1")
    // Remove bold/italic
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/_{1,3}([^_]+)_{1,3}/g, "$1")
    // Remove headers
    .replace(/^#{1,6}\s+/gm, "")
    // Remove links, keep text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove images
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    // Remove blockquotes
    .replace(/^>\s+/gm, "")
    // Remove horizontal rules
    .replace(/^---+$/gm, "")
    // Remove list markers
    .replace(/^[\s]*[-*+]\s+/gm, "")
    .replace(/^[\s]*\d+\.\s+/gm, "")
    // Remove tool indicators
    .replace(/🔧\s*/g, "")
    // Collapse whitespace
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
