import { useState, useEffect, useRef, useCallback } from "react";
import { X, Terminal } from "lucide-react";
import { appSystemLogs } from "./tools";

interface LogsOverlayProps {
  onClose: () => void;
}

export default function LogsOverlay({ onClose }: LogsOverlayProps) {
  const [logs, setLogs] = useState(appSystemLogs);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  // Throttle log updates with requestAnimationFrame to prevent render thrashing
  const handleLogsUpdate = useCallback(() => {
    if (rafRef.current !== null) return; // Already scheduled
    rafRef.current = requestAnimationFrame(() => {
      setLogs([...appSystemLogs]);
      rafRef.current = null;
    });
  }, []);

  useEffect(() => {
    window.addEventListener("dream_system_logs_updated", handleLogsUpdate);
    return () => {
      window.removeEventListener("dream_system_logs_updated", handleLogsUpdate);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [handleLogsUpdate]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 animate-fade-in">
      <div className="w-full max-w-4xl h-[85vh] flex flex-col rounded-3xl p-6 animate-slide-up shadow-2xl relative"
           style={{ background: "#0a0a0f", border: "1px solid var(--dream-glass-border)" }}>
        
        <button 
          onClick={onClose}
          className="absolute top-6 right-6 p-2 rounded-full hover:bg-white/10 transition-colors"
          style={{ color: "var(--dream-muted-dim)" }}
        >
          <X size={20} />
        </button>

        <h2 className="text-xl font-medium mb-6 flex items-center gap-3" style={{ color: "var(--dream-text)" }}>
          <Terminal size={22} style={{ color: "var(--dream-accent-light)" }} />
          Advanced System Logs
        </h2>

        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto rounded-xl p-4 font-mono text-[11px] space-y-2 whitespace-pre-wrap break-all"
          style={{ background: "#000000", border: "1px solid rgba(255,255,255,0.1)", color: "var(--dream-muted-dim)" }}
        >
          {logs.length === 0 ? (
            <div className="opacity-50 italic text-center mt-10">Listening for background jobs and errors...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="border-b border-white/5 pb-2">
                <span className="opacity-50 inline-block w-24">[{log.timestamp}]</span>
                <span style={{ 
                  color: log.type === "error" ? "#f87171" 
                       : log.type === "success" ? "#4ade80" 
                       : "var(--dream-text)" 
                }}>
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
