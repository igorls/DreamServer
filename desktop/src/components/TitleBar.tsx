import { useState, useCallback } from "react";
import { Minus, Square, X, Copy } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "../i18n";

/** Custom titlebar — frameless window with drag support via startDragging() */
export default function TitleBar() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMinimize = () => getCurrentWindow().minimize();

  const handleMaximize = async () => {
    const win = getCurrentWindow();
    const maximized = await win.isMaximized();
    if (maximized) {
      win.unmaximize();
      setIsMaximized(false);
    } else {
      win.maximize();
      setIsMaximized(true);
    }
  };

  const handleClose = () => getCurrentWindow().close();

  /** Start dragging the window on mouse down — the correct Tauri v2 approach for Linux */
  const handleDragStart = useCallback(async (e: React.MouseEvent) => {
    // Only drag on left click, and not when clicking buttons
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;

    try {
      await getCurrentWindow().startDragging();
    } catch {
      // Silently fail in browser-only mode
    }
  }, []);

  return (
    <header
      onMouseDown={handleDragStart}
      className="flex items-center justify-between h-9 px-4
                 select-none shrink-0 cursor-default"
      style={{
        background: "var(--dream-surface)",
        borderBottom: "1px solid var(--dream-glass-border)",
      }}
    >
      {/* Left: app name */}
      <div className="flex items-center gap-2 pointer-events-none">
        <div className="w-[6px] h-[6px] rounded-full opacity-80"
             style={{ background: "var(--dream-accent)" }} />
        <span className="text-[11px] font-medium tracking-wider uppercase"
              style={{ color: "var(--dream-muted-dim)" }}>
          {t("app.name")}
        </span>
      </div>

      {/* Right: window controls */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={handleMinimize}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150"
          style={{ color: "var(--dream-muted-dim)" }}
          aria-label="Minimize"
        >
          <Minus size={12} strokeWidth={2} />
        </button>
        <button
          onClick={handleMaximize}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150"
          style={{ color: "var(--dream-muted-dim)" }}
          aria-label="Maximize"
        >
          {isMaximized ? <Copy size={10} strokeWidth={2} /> : <Square size={10} strokeWidth={2} />}
        </button>
        <button
          onClick={handleClose}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150
                     hover:bg-red-500/60 hover:text-white"
          style={{ color: "var(--dream-muted-dim)" }}
          aria-label="Close"
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
    </header>
  );
}
