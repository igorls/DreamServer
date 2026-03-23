import { useRef, useEffect } from "react";
import { Sparkles, Wrench, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── Message types ────────────────────────────────────────

export interface TextMessage {
  id: string;
  type: "text";
  role: "user" | "assistant";
  content: string;
}

export interface ToolMessage {
  id: string;
  type: "tool";
  toolName: string;
  toolArgs: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: string;
  error?: string;
}

export type Message = TextMessage | ToolMessage;

// ── Human-readable names for tools ───────────────────────

const TOOL_LABELS: Record<string, string> = {
  get_system_info: "Checking system info",
  list_ollama_models: "Listing models",
  get_running_models: "Checking running models",
  pull_model: "Downloading model",
  check_docker_services: "Checking services",
  open_tool: "Opening tool",
  manage_docker_service: "Managing service",
  list_comfyui_models: "Listing image models",
  generate_image: "Generating image",
  list_n8n_workflows: "Listing workflows",
  create_n8n_workflow: "Creating workflow",
  execute_n8n_workflow: "Running workflow",
  list_service_catalog: "Reading service catalog",
  check_service_health: "Checking service health",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

function formatArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length > 0 ? parts.join(", ") : "";
}

// ── Tool bubble component ────────────────────────────────

function ToolBubble({ msg }: { msg: ToolMessage }) {
  const statusIcon = msg.status === "running"
    ? <Loader2 size={12} className="animate-spin" />
    : msg.status === "done"
      ? <CheckCircle2 size={12} />
      : <XCircle size={12} />;

  const statusColor = msg.status === "running"
    ? "var(--dream-accent)"
    : msg.status === "done"
      ? "#4ade80"
      : "#f87171";

  const argsStr = formatArgs(msg.toolArgs);

  return (
    <div className="flex justify-start">
      <div className="w-7 h-7 rounded-lg flex items-center justify-center mr-3 mt-1 shrink-0"
           style={{ background: `color-mix(in srgb, ${statusColor} 20%, transparent)` }}>
        <Wrench size={12} style={{ color: statusColor }} />
      </div>
      <div
        className="max-w-[75%] rounded-xl px-3 py-2 text-[12px]"
        style={{
          background: "color-mix(in srgb, var(--dream-text) 3%, transparent)",
          border: `1px solid color-mix(in srgb, ${statusColor} 20%, transparent)`,
          borderRadius: "0.75rem 0.75rem 0.75rem 0.25rem",
        }}
      >
        <div className="flex items-center gap-2" style={{ color: statusColor }}>
          {statusIcon}
          <span className="font-medium">{toolLabel(msg.toolName)}</span>
          {argsStr && (
            <span className="opacity-50 font-mono text-[10px]">{argsStr}</span>
          )}
        </div>
        {msg.status === "done" && msg.result && (
          <details className="mt-1.5 text-[10px] font-mono opacity-50 cursor-pointer">
            <summary className="hover:opacity-100 transition-opacity select-none tracking-wide">Output Details</summary>
            <div className="mt-1.5 max-h-32 overflow-y-auto pl-2 border-l border-white/10 whitespace-pre-wrap break-all"
                 style={{ color: "var(--dream-muted-dim)" }}>
              {msg.result}
            </div>
          </details>
        )}
        {msg.status === "error" && msg.error && (
          <div className="mt-1.5 text-[11px] opacity-70" style={{ color: "#f87171" }}>
            {msg.error}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main chat list ───────────────────────────────────────

interface ChatMessageListProps {
  messages: Message[];
}

export default function ChatMessageList({ messages }: ChatMessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6" style={{ willChange: "transform", contain: "content" }}>
      <div className="max-w-2xl mx-auto space-y-5">
        {messages.map((msg) => {
          // Tool execution bubble
          if (msg.type === "tool") {
            return <ToolBubble key={msg.id} msg={msg} />;
          }

          // Regular text message
          if (!msg.content.trim()) return null;

          return (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-lg flex items-center justify-center mr-3 mt-1 shrink-0"
                     style={{ background: "linear-gradient(135deg, color-mix(in srgb, var(--dream-accent) 30%, transparent), color-mix(in srgb, var(--dream-purple) 30%, transparent))" }}>
                  <Sparkles size={12} style={{ color: "var(--dream-accent-light)" }} />
                </div>
              )}
              <div
                className="max-w-[75%] rounded-2xl px-4 py-3 text-[13.5px] leading-[1.65]"
                style={{
                  background: msg.role === "user"
                    ? "var(--dream-accent)"
                    : "color-mix(in srgb, var(--dream-text) 5%, transparent)",
                  color: msg.role === "user" ? "white" : "var(--dream-text)",
                  opacity: msg.role === "user" ? 1 : 0.85,
                  border: msg.role === "assistant" ? "1px solid var(--dream-glass-border)" : "none",
                  borderRadius: msg.role === "user" ? "1rem 1rem 0.5rem 1rem" : "1rem 1rem 1rem 0.5rem",
                }}
              >
                {msg.role === "assistant" ? (
                  <div className="chat-markdown">
                    <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                  </div>
                ) : (
                  msg.content.split("\n").map((line, j) => (
                    <p key={j} className={j > 0 ? "mt-2" : ""}>{line}</p>
                  ))
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
