import { useState, useCallback, useEffect, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import {
  MessageCircle,
  Palette,
  Zap,
  Search,
  ChevronDown,
  StopCircle,
  WifiOff,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTranslation } from "./i18n";
import ToolWebview from "./components/ToolWebview";
import ChatMessageList from "./companion/ChatMessageList";
import ChatInput from "./companion/ChatInput";
import ToolSidebar from "./companion/ToolSidebar";
import ConfigOverlay from "./companion/ConfigOverlay";
import LogsOverlay from "./companion/LogsOverlay";
import { useChat } from "./companion/useChat";
import { useTTS } from "./companion/useTTS";
import type { ToolDef } from "./companion/types";
import type { SetupState } from "./App";

interface CompanionShellProps {
  setup: SetupState;
  onUpdateSetup: (partial: Partial<SetupState>) => void;
}

/** Main companion — orchestrates chat, tools, and system panel */
export default function CompanionShell({ setup, onUpdateSetup }: CompanionShellProps) {
  const { t } = useTranslation();

  const greeting = t("companion.greeting", {
    name: setup.userName ? ` ${setup.userName}` : "",
    voice: setup.voiceName,
  });

  const [input, setInput] = useState("");
  const [activeTool, setActiveTool] = useState("chat");
  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [modelFilter, setModelFilter] = useState("");
  const modelPickerRef = useRef<HTMLDivElement>(null);

  /** Track which tool webviews have been opened (so their iframes persist) */
  const [openedTools, setOpenedTools] = useState<Set<string>>(new Set());

  /** Open a tool by ID — used by both sidebar clicks and AI agent */
  const handleToolSelect = useCallback((id: string) => {
    setActiveTool(id);
    const allTools = [
      { id: "images", url: "http://localhost:8188" },
      { id: "workflows", url: "http://localhost:5679" },
      { id: "research", url: "http://localhost:3000" },
    ];
    const tool = allTools.find((td) => td.id === id);
    if (tool?.url) {
      setOpenedTools((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
  }, []);

  const chat = useChat(greeting, {
    voiceId: setup.voiceId,
    userName: setup.userName,
    onOpenTool: handleToolSelect,
  });

  const tts = useTTS({ voiceId: setup.voiceId });
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const lastSpokenRef = useRef<string | null>(null);

  // Load persisted voice preference
  useEffect(() => {
    load("config.json").then(async (store) => {
      const saved = await store.get<boolean>("voiceEnabled");
      if (saved === false) setVoiceEnabled(false);
    }).catch(() => { /* first launch */ });
  }, []);

  // Close model picker on click outside
  useEffect(() => {
    if (!showModelPicker) return;
    const handler = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showModelPicker]);

  /** Format bytes to human-readable size */
  function formatSize(bytes: number): string {
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)}MB`;
    return `${bytes}B`;
  }

  // Auto-detect Ollama/llama-server + check TTS on mount
  useEffect(() => {
    chat.connect();
    tts.checkAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-speak new assistant messages
  useEffect(() => {
    if (!voiceEnabled || !tts.isAvailable || chat.isStreaming) return;
    const lastMsg = chat.messages[chat.messages.length - 1];
    if (
      lastMsg &&
      lastMsg.type === "text" &&
      lastMsg.role === "assistant" &&
      lastMsg.content &&
      lastMsg.content !== lastSpokenRef.current
    ) {
      lastSpokenRef.current = lastMsg.content;
      tts.speak(lastMsg.content);
    }
  }, [chat.messages, chat.isStreaming, voiceEnabled, tts]);

  const tools: ToolDef[] = [
    { id: "chat", nameKey: "companion.chat", descKey: "companion.chatDesc", icon: <MessageCircle size={18} />, status: "active" },
    { id: "images", nameKey: "companion.images", descKey: "companion.imagesDesc", icon: <Palette size={18} />, url: "http://localhost:8188", status: "available" },
    { id: "workflows", nameKey: "companion.workflows", descKey: "companion.workflowsDesc", icon: <Zap size={18} />, url: "http://localhost:5679", status: "available" },
    { id: "research", nameKey: "companion.research", descKey: "companion.researchDesc", icon: <Search size={18} />, url: "http://localhost:3000", status: "available" },
  ];

  const webviewTools = tools.filter((td) => td.url);


  const handleToolClose = useCallback((id: string) => {
    setActiveTool("chat");
    setOpenedTools((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const handleSend = () => {
    if (!input.trim() || chat.isStreaming) return;
    chat.send(input.trim());
    setInput("");
  };

  const isChatVisible = activeTool === "chat";

  // Filter to chat-suitable models (exclude embeddings, OCR, etc.)
  const chatModels = chat.availableModels.filter(
    (m) => !m.name.includes("embed") && !m.name.includes("ocr")
  );

  return (
    <div className="flex h-full relative overflow-hidden">
      <div className="absolute inset-0 bg-dream-gradient pointer-events-none" />

      <ToolSidebar
        voiceName={setup.voiceName}
        tools={tools}
        activeTool={activeTool}
        showSettings={showSettings}
        onToolSelect={handleToolSelect}
        onToggleSettings={() => setShowSettings(!showSettings)}
        onToggleLogs={() => setShowLogs(!showLogs)}
      />

      {/* Settings & Logs Overlays */}
      {showSettings && (
        <ConfigOverlay 
          setup={setup} 
          onSave={async (partial) => {
            onUpdateSetup(partial);
            // Persist to Tauri store so settings survive app restart
            try {
              const store = await load("config.json");
              const current = await store.get<SetupState>("setup") ?? setup;
              await store.set("setup", { ...current, ...partial });
              await store.save();
            } catch (e) {
              console.error("[config] Failed to persist settings:", e);
            }
          }} 
          onClose={() => setShowSettings(false)} 
        />
      )}
      {showLogs && (
        <LogsOverlay onClose={() => setShowLogs(false)} />
      )}

      {/* Central: chat + all opened webviews (hidden via CSS to persist state) */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0 py-3 pr-3">
        <div className="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden relative">
          {/* Chat — always mounted, hidden when a webview is active */}
          <div className="flex flex-col h-full" style={{ display: isChatVisible ? "flex" : "none" }}>
            {/* ── Chat Header ──────────────────────────── */}
            <div className="flex items-center justify-between px-6 h-14 shrink-0"
                 style={{ borderBottom: "1px solid var(--dream-glass-border)" }}>
              <div className="flex items-center gap-3">
                <MessageCircle size={16} style={{ color: "var(--dream-accent-light)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--dream-text)", opacity: 0.7 }}>
                  {t("companion.chat")}
                </span>
                {chat.messages.length > 1 && (
                  <button
                    onClick={() => chat.clear(greeting)}
                    className="w-6 h-6 flex items-center justify-center rounded-md transition-all"
                    style={{ color: "var(--dream-muted-dim)" }}
                    title="New chat"
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
                {/* Voice toggle */}
                <button
                  onClick={() => {
                    if (tts.isSpeaking) tts.stopSpeaking();
                    setVoiceEnabled((v) => {
                      const next = !v;
                      // When disabling, sync the ref so re-enabling won't replay the last message
                      if (!next) {
                        const lastMsg = chat.messages[chat.messages.length - 1];
                        if (lastMsg && lastMsg.type === "text" && lastMsg.role === "assistant") {
                          lastSpokenRef.current = lastMsg.content;
                        }
                      }
                      load("config.json").then(async (store) => {
                        await store.set("voiceEnabled", next);
                        await store.save();
                      }).catch(() => {});
                      return next;
                    });
                  }}
                  className="w-6 h-6 flex items-center justify-center rounded-md transition-all"
                  style={{
                    color: voiceEnabled && tts.isAvailable
                      ? "var(--dream-accent-light)"
                      : "var(--dream-muted-dim)",
                  }}
                  title={voiceEnabled ? "Mute voice" : "Enable voice"}
                >
                  {voiceEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
                </button>
              </div>

              {/* Connection status + model selector */}
              <div className="flex items-center gap-3">
                {/* Model picker */}
                {chat.isConnected && chat.model && (
                  <div className="relative" ref={modelPickerRef}>
                    <button
                      onClick={() => { setShowModelPicker(!showModelPicker); setModelFilter(""); }}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] transition-all"
                      style={{
                        color: "var(--dream-muted)",
                        background: showModelPicker
                          ? "color-mix(in srgb, var(--dream-text) 8%, transparent)"
                          : "transparent",
                      }}
                    >
                      <span className="max-w-[120px] truncate">{chat.model}</span>
                      <ChevronDown size={10} style={{ transform: showModelPicker ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                    </button>

                    {showModelPicker && (
                      <div
                        className="absolute right-0 top-full mt-1 w-64 rounded-xl z-50 shadow-xl"
                        style={{
                          background: "var(--dream-surface)",
                          border: "1px solid var(--dream-glass-border)",
                          backdropFilter: "blur(20px)",
                        }}
                      >
                        {/* Search filter */}
                        {chatModels.length > 5 && (
                          <div className="px-2 pt-2 pb-1">
                            <input
                              type="text"
                              value={modelFilter}
                              onChange={(e) => setModelFilter(e.target.value)}
                              placeholder="Search models…"
                              autoFocus
                              className="w-full px-2.5 py-1.5 rounded-lg text-[11px] outline-none"
                              style={{
                                background: "color-mix(in srgb, var(--dream-text) 5%, transparent)",
                                border: "1px solid var(--dream-glass-border)",
                                color: "var(--dream-text)",
                              }}
                            />
                          </div>
                        )}

                        {/* Model list */}
                        <div className="overflow-y-auto py-1" style={{ maxHeight: "240px" }}>
                          {chatModels
                            .filter((m) => !modelFilter || m.name.toLowerCase().includes(modelFilter.toLowerCase()))
                            .map((m) => (
                              <button
                                key={m.name}
                                onClick={() => { chat.setModel(m.name); setShowModelPicker(false); }}
                                className="w-full text-left px-3 py-1.5 text-[12px] transition-all flex items-center justify-between gap-2"
                                style={{
                                  color: m.name === chat.model ? "var(--dream-accent-light)" : "var(--dream-muted)",
                                  background: m.name === chat.model
                                    ? "color-mix(in srgb, var(--dream-accent) 10%, transparent)"
                                    : "transparent",
                                }}
                              >
                                <span className="truncate">{m.name}</span>
                                <span className="text-[9px] shrink-0" style={{ color: "var(--dream-muted-dim)" }}>
                                  {m.details.parameter_size || formatSize(m.size)}
                                </span>
                              </button>
                            ))}
                          {chatModels.filter((m) => !modelFilter || m.name.toLowerCase().includes(modelFilter.toLowerCase())).length === 0 && (
                            <div className="px-3 py-2 text-[11px]" style={{ color: "var(--dream-muted-dim)" }}>No models found</div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Status indicator */}
                {chat.isConnected ? (
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{
                      background: chat.isStreaming ? "var(--dream-accent)" : "var(--dream-success)",
                      animation: chat.isStreaming ? "pulse 1.5s infinite" : "none",
                    }} />
                    <span className="text-[11px]" style={{ color: "var(--dream-muted-dim)" }}>
                      {chat.isStreaming ? t("companion.thinking") ?? "Thinking..." : chat.backendName}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <WifiOff size={12} style={{ color: "var(--dream-muted-dim)" }} />
                    <span className="text-[11px]" style={{ color: "var(--dream-muted-dim)" }}>
                      Offline
                    </span>
                    <button
                      onClick={() => chat.connect()}
                      className="text-[10px] px-2 py-0.5 rounded-md"
                      style={{
                        color: "var(--dream-accent-light)",
                        border: "1px solid var(--dream-glass-border)",
                      }}
                    >
                      Reconnect
                    </button>
                  </div>
                )}

                {/* Stop button during streaming */}
                {chat.isStreaming && (
                  <button
                    onClick={chat.stop}
                    className="w-7 h-7 flex items-center justify-center rounded-lg transition-all"
                    style={{ color: "var(--dream-muted-dim)" }}
                    title="Stop"
                  >
                    <StopCircle size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Error bar */}
            {chat.error && (
              <div className="px-6 py-2 text-[12px] flex items-center justify-between"
                   style={{
                     background: "color-mix(in srgb, #ef4444 8%, transparent)",
                     color: "#fca5a5",
                     borderBottom: "1px solid color-mix(in srgb, #ef4444 20%, transparent)",
                   }}>
                <span>{chat.error}</span>
                <button
                  onClick={() => chat.connect()}
                  className="text-[11px] px-3 py-1 rounded-md"
                  style={{ background: "color-mix(in srgb, var(--dream-text) 5%, transparent)" }}
                >
                  Retry
                </button>
              </div>
            )}

            <ChatMessageList messages={chat.messages} />
            <ChatInput
              input={input}
              voiceName={setup.voiceName}
              disabled={chat.isStreaming}
              onInputChange={setInput}
              onSend={handleSend}
            />
          </div>

          {/* Webviews — each stays mounted once opened, shown/hidden via CSS */}
          {webviewTools.map((tool) => {
            if (!openedTools.has(tool.id)) return null;
            return (
              <div
                key={tool.id}
                className="flex flex-col h-full absolute inset-0"
                style={{ display: activeTool === tool.id ? "flex" : "none" }}
              >
                <ToolWebview
                  url={tool.url!}
                  name={t(tool.nameKey)}
                  onClose={() => handleToolClose(tool.id)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
