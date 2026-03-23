import {
  Sparkles,
  ChevronRight,
  Settings,
  Activity,
  Loader2
} from "lucide-react";
import { useState, useEffect } from "react";
import { checkDockerServices, backgroundJobs } from "./tools";
import { useTranslation } from "../i18n";
import type { ToolDef } from "./types";

interface ToolSidebarProps {
  voiceName: string;
  tools: ToolDef[];
  activeTool: string;
  showSettings: boolean;
  onToolSelect: (id: string) => void;
  onToggleSettings: () => void;
  onToggleLogs: () => void;
}

/** Left sidebar — avatar, tools list, and footer controls */
export default function ToolSidebar({
  voiceName,
  tools,
  activeTool,
  showSettings,
  onToolSelect,
  onToggleSettings,
  onToggleLogs,
}: ToolSidebarProps) {
  const { t } = useTranslation();

  const [sysStatus, setSysStatus] = useState<Record<string, string>>({
    ollama: "running", // Assumption since chat works
    tts: "available",
    comfyui: "available",
    n8n: "available",
  });

  useEffect(() => {
    let unmounted = false;
    const poll = async () => {
      try {
        const resJson = await checkDockerServices();
        const data = JSON.parse(resJson);
        const map: Record<string, string> = {
          ollama: "running", // default to running since app is running
          tts: "available",
          comfyui: "available",
          n8n: "available",
        };

        if (data.services) {
          for (const s of data.services) {
            const n = (s.name || "").toLowerCase();
            const isUp = (s.state === "running" || s.status === "running") && (!n.includes("exited"));
            
            if (n.includes("ollama")) map.ollama = isUp ? "running" : "available";
            if (n.includes("tts")) map.tts = isUp ? "running" : "available";
            if (n.includes("comfyui") || n.includes("images")) map.comfyui = isUp ? "running" : "available";
            if (n.includes("n8n") || n.includes("workflows")) map.n8n = isUp ? "running" : "available";
          }
        }

        // Override with background jobs
        for (const [svc, job] of backgroundJobs.entries()) {
          const key = svc.toLowerCase();
          if (["up", "pull", "restart"].includes(job.action)) {
             if (key.includes("ollama")) map.ollama = "installing";
             if (key.includes("tts")) map.tts = "installing";
             if (key.includes("comfyui")) map.comfyui = "installing";
             if (key.includes("n8n")) map.n8n = "installing";
          }
        }

        if (!unmounted) setSysStatus(map);
      } catch (e) {
        // ignore
      }
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => { unmounted = true; clearInterval(iv); };
  }, []);

  return (
    <div className="relative z-10 flex flex-col w-60 p-3 shrink-0">
      <nav className="glass-panel flex-1 flex flex-col rounded-2xl p-3" aria-label={t("companion.tools")}>
        {/* Avatar */}
        <div className="flex items-center gap-3 px-2 pt-1 pb-4" style={{ borderBottom: "1px solid var(--dream-glass-border)" }}>
          <div className="relative">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg"
                 style={{ background: "linear-gradient(135deg, var(--dream-accent), var(--dream-purple))" }}>
              <Sparkles size={16} className="text-white" />
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                 style={{ background: "var(--dream-success)", borderColor: "var(--dream-surface)" }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--dream-text)" }}>{voiceName}</p>
            <p className="text-[10px]" style={{ color: "var(--dream-muted-dim)" }}>{t("companion.online")}</p>
          </div>
        </div>

        {/* Tools */}
        <div className="mt-3 flex-1">
          <p className="text-[10px] uppercase tracking-[0.15em] px-2 mb-2 font-medium"
             style={{ color: "var(--dream-muted-dim)" }}>
            {t("companion.tools")}
          </p>
          <div className="space-y-0.5">
            {tools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => onToolSelect(tool.id)}
                className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200"
                style={{
                  background: activeTool === tool.id
                    ? "color-mix(in srgb, var(--dream-text) 8%, transparent)"
                    : "transparent",
                  color: activeTool === tool.id ? "var(--dream-text)" : "var(--dream-muted-dim)",
                }}
              >
                <div style={{ color: activeTool === tool.id ? "var(--dream-accent-light)" : undefined }}>
                  {tool.icon}
                </div>
                <span className="text-[13px] font-medium flex-1 text-left">{t(tool.nameKey)}</span>
                {tool.url && activeTool !== tool.id && (
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--dream-accent)", opacity: 0.5 }} />
                )}
                {activeTool === tool.id && (
                  <ChevronRight size={12} style={{ color: "var(--dream-muted-dim)" }} />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* System Services Status */}
        <div className="mt-2 mb-3">
          <p className="text-[10px] uppercase tracking-[0.15em] px-2 mb-2 font-medium flex items-center gap-1.5"
             style={{ color: "var(--dream-muted-dim)" }}>
            <Activity size={10} /> {t("companion.services")}
          </p>
          <div className="space-y-1.5 px-2">
            {[
              { id: "ollama", nameKey: "companion.llmEngine" },
              { id: "tts", nameKey: "companion.voice" },
              { id: "comfyui", nameKey: "companion.images" },
              { id: "n8n", nameKey: "companion.workflows" },
            ].map((svc) => {
              const status = sysStatus[svc.id] || "available";
              return (
                <div key={svc.id} className="flex items-center justify-between group cursor-default">
                  <span className="text-[11px] font-medium transition-colors" 
                        style={{ color: status === "running" ? "var(--dream-text)" : "var(--dream-muted-dim)" }}>
                    {t(svc.nameKey)}
                  </span>
                  <div className="flex items-center gap-1.5"
                       title={status === "installing" ? t("companion.installing") : undefined}>
                    {status === "installing" ? (
                      <Loader2 size={10} className="animate-spin" style={{ color: "var(--dream-accent)" }} />
                    ) : (
                      <div className="w-1.5 h-1.5 rounded-full shadow-[0_0_4px_rgba(0,0,0,0.5)] transition-colors"
                           style={{
                             background: status === "running" ? "var(--dream-success)"
                               : status === "ready" ? "var(--dream-accent)"
                               : "color-mix(in srgb, var(--dream-text) 15%, transparent)",
                           }} />
                    )}
                    <span className="text-[9px] uppercase tracking-wider hidden group-hover:block transition-all" 
                          style={{ color: "var(--dream-muted-dim)" }}>
                      {t(`companion.${status}`)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 px-1"
             style={{ borderTop: "1px solid var(--dream-glass-border)" }}>
          <button
            onClick={onToggleLogs}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/5 transition-all"
            style={{ color: "var(--dream-muted-dim)" }}
            aria-label="System Logs"
            title="Advanced Logs"
          >
            <Activity size={16} />
          </button>
          <button
            onClick={onToggleSettings}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
            style={{ color: showSettings ? "var(--dream-accent-light)" : "var(--dream-muted-dim)" }}
            aria-label={t("companion.settings")}
          >
            <Settings size={16} />
          </button>
        </div>
      </nav>
    </div>
  );
}
