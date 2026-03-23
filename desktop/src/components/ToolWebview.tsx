import { useState, useRef, useCallback } from "react";
import {
  RefreshCw,
  ExternalLink,
  Maximize2,
  Minimize2,
  X,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useTranslation } from "../i18n";

interface ToolWebviewProps {
  url: string;
  name: string;
  onClose: () => void;
}

type LoadState = "loading" | "ready" | "error";

/** Embedded webview panel — renders a tool inside an iframe with chrome controls */
export default function ToolWebview({ url, name, onClose }: ToolWebviewProps) {
  const { t } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleReload = useCallback(() => {
    setLoadState("loading");
    if (iframeRef.current) {
      iframeRef.current.src = url;
    }
  }, [url]);

  const handleOpenExternal = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch {
      window.open(url, "_blank");
    }
  }, [url]);

  return (
    <div className={`flex flex-col h-full ${isFullscreen ? "fixed inset-0 z-50" : ""}`}>
      {/* ── Tool Chrome Bar ──────────────────────────── */}
      <div
        className="flex items-center justify-between h-11 px-4 shrink-0"
        style={{
          background: "var(--dream-surface)",
          borderBottom: "1px solid var(--dream-glass-border)",
        }}
      >
        {/* Left: tool name + status */}
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium" style={{ color: "var(--dream-text)", opacity: 0.8 }}>
            {name}
          </span>
          {loadState === "loading" && (
            <Loader2 size={12} className="animate-spin" style={{ color: "var(--dream-accent-light)" }} />
          )}
          {loadState === "ready" && (
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--dream-success)" }} />
          )}
          {loadState === "error" && (
            <AlertCircle size={12} style={{ color: "#ef4444" }} />
          )}
        </div>

        {/* Center: subtle URL breadcrumb */}
        <div className="flex-1 flex justify-center">
          <span
            className="text-[11px] px-3 py-1 rounded-md max-w-[300px] truncate"
            style={{
              color: "var(--dream-muted-dim)",
              background: "color-mix(in srgb, var(--dream-text) 3%, transparent)",
            }}
          >
            {url}
          </span>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleReload}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150"
            style={{ color: "var(--dream-muted-dim)" }}
            title={t("toolWebview.reload") ?? "Reload"}
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={handleOpenExternal}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150"
            style={{ color: "var(--dream-muted-dim)" }}
            title={t("toolWebview.openExternal") ?? "Open in browser"}
          >
            <ExternalLink size={13} />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150"
            style={{ color: "var(--dream-muted-dim)" }}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <div className="w-px h-4 mx-1" style={{ background: "var(--dream-glass-border)" }} />
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150 hover:bg-red-500/20"
            style={{ color: "var(--dream-muted-dim)" }}
            title="Close"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* ── Content Area ─────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        {/* Loading overlay */}
        {loadState === "loading" && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4"
            style={{ background: "var(--dream-bg)" }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, var(--dream-accent), var(--dream-purple))",
              }}
            >
              <Loader2 size={20} className="animate-spin text-white" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: "var(--dream-text)", opacity: 0.7 }}>
                {t("toolWebview.connecting") ?? `Connecting to ${name}...`}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--dream-muted-dim)" }}>
                {url}
              </p>
            </div>
          </div>
        )}

        {/* Error state */}
        {loadState === "error" && (
          <div
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4"
            style={{ background: "var(--dream-bg)" }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: "color-mix(in srgb, #ef4444 15%, transparent)" }}
            >
              <AlertCircle size={20} style={{ color: "#ef4444" }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: "var(--dream-text)", opacity: 0.7 }}>
                {t("toolWebview.cannotConnect") ?? `Can't connect to ${name}`}
              </p>
              <p className="text-xs mt-1 max-w-xs" style={{ color: "var(--dream-muted-dim)" }}>
                {t("toolWebview.checkRunning") ?? "Make sure the service is running and try again."}
              </p>
              <button
                onClick={handleReload}
                className="mt-4 btn-primary text-sm px-4 py-2"
              >
                {t("toolWebview.tryAgain") ?? "Try Again"}
              </button>
            </div>
          </div>
        )}

        {/* Iframe */}
        <iframe
          ref={iframeRef}
          src={url}
          onLoad={() => setLoadState("ready")}
          onError={() => setLoadState("error")}
          className="w-full h-full border-none"
          style={{
            opacity: loadState === "ready" ? 1 : 0,
            transition: "opacity 0.3s ease",
            background: "#1a1a2e",
          }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          title={name}
        />
      </div>
    </div>
  );
}
